import "dotenv/config";
import express from "express";
import cors from "cors";
import http from "http";
import { WebSocketServer, WebSocket } from "ws";
import { TxLine, Fixture } from "./txline";
import { chain } from "./chain";

const PORT = Number(process.env.PORT ?? 4000);

const state = {
  fixtures: new Map<number, Fixture>(),
  odds: new Map<number, any>(),
  scores: new Map<number, any>(),
  markets: new Map<number, string>(),
  resolved: new Set<number>(),
  // final results for past fixtures, fetched once from the TxLINE score
  // snapshot and cached: fixtureId -> { score: [s1, s2] | null, finished }
  results: new Map<number, { score: [number, number] | null; finished: boolean }>(),
};

function requireEnv(k: string): string {
  const v = process.env[k];
  if (!v) { console.error(`Missing env ${k}`); process.exit(1); }
  return v;
}
const tx = new TxLine(requireEnv("TXLINE_API_TOKEN"));

const fid = (msg: any): number | undefined => msg?.FixtureId;

function isFullMatch1X2(o: any): boolean {
  return o?.SuperOddsType === "1X2_PARTICIPANT_RESULT" && (o?.MarketPeriod ?? null) === null;
}

function pctToProbBps(o: any): number[] | null {
  const pct = o?.Pct;
  if (!Array.isArray(pct) || pct.length !== 3) return null;
  const nums = pct.map((p: string) => Number(p));
  if (!nums.every((n) => Number.isFinite(n) && n > 0)) return null;
  const sum = nums[0] + nums[1] + nums[2];
  const bps = nums.map((n) => Math.round((n / sum) * 10000));
  bps[0] += 10000 - (bps[0] + bps[1] + bps[2]);
  return bps;
}

function latest1X2(odds: any[]): any | null {
  const ml = odds.filter(isFullMatch1X2);
  return ml.length ? ml[ml.length - 1] : null;
}

function isFinal(msg: any): boolean {
  const action = String(msg?.Action ?? "").toLowerCase();
  const gs = String(msg?.GameState ?? "").toLowerCase();
  return action === "game_finalised" || ["finished", "ended", "final", "fulltime", "ft"].includes(gs);
}

function extractScore(msg: any): [number, number] | null {
  const spots = [msg?.Stats, msg?.Data, msg];
  for (const s of spots) {
    if (!s) continue;
    const s1 = s.Score1 ?? s.score1 ?? s.Goals1 ?? s.goals1 ?? s.HomeScore ?? s.Home;
    const s2 = s.Score2 ?? s.score2 ?? s.Goals2 ?? s.goals2 ?? s.AwayScore ?? s.Away;
    if (s1 !== undefined && s2 !== undefined) return [Number(s1), Number(s2)];
    if (Array.isArray(s.Score) && s.Score.length === 2) return [Number(s.Score[0]), Number(s.Score[1])];
  }
  return null;
}

function winnerFromScore(msg: any): number | null {
  const sc = extractScore(msg);
  if (!sc) return null;
  const [s1, s2] = sc;
  if (s1 > s2) return 0;
  if (s1 === s2) return 1;
  return 2;
}

const app = express();
app.use(cors());
const server = http.createServer(app);
const wss = new WebSocketServer({ server, path: "/ws" });
function broadcast(type: string, payload: any) {
  const msg = JSON.stringify({ type, payload });
  wss.clients.forEach((c) => c.readyState === WebSocket.OPEN && c.send(msg));
}

app.get("/health", (_q, res) => res.json({ ok: true }));
app.get("/fixtures", (_q, res) => res.json([...state.fixtures.values()]));
app.get("/markets", (_q, res) =>
  res.json(
    [...state.markets.entries()].map(([fixtureId, market]) => ({
      fixtureId,
      market,
      fixture: state.fixtures.get(fixtureId),
      odds: state.odds.get(fixtureId) ?? null,
      score: state.scores.get(fixtureId) ?? null,
      resolved: state.resolved.has(fixtureId),
    })),
  ),
);
app.get("/schedule", (_q, res) =>
  res.json(
    [...state.fixtures.values()]
      .map((f) => {
        const id = f.FixtureId;
        const live = state.scores.get(id) ?? null;
        const result = state.results.get(id) ?? null;
        return {
          fixtureId: id,
          fixture: f,
          market: state.markets.get(id) ?? null,
          odds: state.odds.get(id) ?? null,
          score: live,
          result: result?.score ?? null,
          finished: (result?.finished ?? false) || state.resolved.has(id),
          resolved: state.resolved.has(id),
        };
      })
      .sort((a, b) => Number(a.fixture.StartTime) - Number(b.fixture.StartTime)),
  ),
);
app.get("/odds/:fixtureId", async (req, res) => {
  try { res.json(await tx.odds(Number(req.params.fixtureId))); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});
app.get("/scores/:fixtureId", async (req, res) => {
  try { res.json(await tx.scores(Number(req.params.fixtureId))); }
  catch (e: any) { res.status(500).json({ error: e.message }); }
});

async function tryCreateMarketForFixture(fixtureId: number) {
  if (state.markets.has(fixtureId)) return;
  const f = state.fixtures.get(fixtureId);
  if (!f) return;
  if (f.GameState === 6) return;
  const startMs = Number(f.StartTime);
  if (startMs < Date.now()) return;
  try {
    const odds = await tx.odds(fixtureId);
    const entry = latest1X2(odds);
    if (!entry) { console.log(`[market] no full-match 1X2 yet for ${fixtureId}`); return; }
    const probBps = pctToProbBps(entry);
    if (!probBps) return;
    const title = `${f.Participant1} vs ${f.Participant2}`;
    const marketPk = await chain.createMarket(fixtureId, title, probBps, Math.floor(startMs / 1000));
    state.markets.set(fixtureId, marketPk);
    state.odds.set(fixtureId, entry);
    console.log(`[market] created ${title} (${probBps.map((b) => (b / 100).toFixed(1) + "%").join("/")}) -> ${marketPk}`);
    broadcast("market_created", { fixtureId, market: marketPk, title });
  } catch (e: any) {
    console.warn(`[market] create failed for ${fixtureId}: ${e.message}`);
  }
}

async function syncFixturesAndMarkets() {
  try {
    const fixtures = await tx.fixtures();
    console.log(`[sync] ${fixtures.length} fixtures from TxLINE`);
    for (const f of fixtures) {
      state.fixtures.set(f.FixtureId, f);
      await tryCreateMarketForFixture(f.FixtureId);
    }
  } catch (e: any) {
    console.error(`[sync] failed: ${e.message}`);
  }
}

/**
 * Restore state from the chain on boot. Markets (and their resolved status)
 * live on-chain forever, so a server restart — e.g. the host spinning the
 * process down — no longer forgets past markets. Fixtures that have dropped
 * out of the TxLINE snapshot are reconstructed from the market's title and
 * close timestamp so finished games keep showing on the site.
 */
async function restoreFromChain() {
  try {
    const markets = await chain.allMarkets();
    for (const m of markets) {
      state.markets.set(m.fixtureId, m.market);
      if (m.resolved) state.resolved.add(m.fixtureId);
      if (!state.fixtures.has(m.fixtureId)) {
        const [p1, p2] = m.title.split(" vs ");
        state.fixtures.set(m.fixtureId, {
          FixtureId: m.fixtureId,
          Participant1: p1 ?? m.title,
          Participant2: p2 ?? "",
          Participant1IsHome: true,
          StartTime: m.closeTs * 1000,
        });
      }
    }
    console.log(`[restore] ${markets.length} markets loaded from chain (${state.resolved.size} resolved)`);
  } catch (e: any) {
    console.error(`[restore] failed: ${e.message}`);
  }
}

const FINISHED_AFTER_MS = 4 * 3600_000; // a football match is long over 4h after kickoff

/**
 * Backfill final results for fixtures that already kicked off, from the TxLINE
 * score snapshot (falling back to the historical endpoint). Runs on its own
 * interval, a few fixtures per pass, and never refetches a fixture once its
 * result is final — the live score stream and keeper are untouched by this.
 */
async function syncResults() {
  const now = Date.now();
  const pending = [...state.fixtures.values()]
    .filter((f) => Number(f.StartTime) < now && !state.results.get(f.FixtureId)?.finished)
    .slice(0, 10);
  for (const f of pending) {
    const id = f.FixtureId;
    let msgs: any[] = [];
    try { msgs = await tx.scores(id); } catch {}
    if (!Array.isArray(msgs) || msgs.length === 0) {
      try { msgs = await tx.historicalScores(id); } catch {}
    }
    const last = Array.isArray(msgs) && msgs.length ? msgs[msgs.length - 1] : null;
    const score = last ? extractScore(last) : null;
    const longOver = Number(f.StartTime) + FINISHED_AFTER_MS < now;
    const finished = (last ? isFinal(last) : false) || longOver;
    if (score || finished) state.results.set(id, { score, finished });
  }
}

async function main() {
  await tx.init();
  await chain.init();

  await restoreFromChain();
  await syncFixturesAndMarkets();
  setInterval(syncFixturesAndMarkets, 5 * 60000);
  syncResults();
  setInterval(syncResults, 2 * 60000);

  tx.stream("odds", (_ev, data) => {
    const id = fid(data);
    if (!id) return;
    if (isFullMatch1X2(data)) {
      state.odds.set(id, data);
      broadcast("odds", { fixtureId: id, data });
    }
    tryCreateMarketForFixture(id);
  });

  tx.stream("scores", async (_ev, data) => {
    const id = fid(data);
    if (!id) return;
    state.scores.set(id, data);
    broadcast("score", { fixtureId: id, data });

    if (isFinal(data) && state.markets.has(id) && !state.resolved.has(id)) {
      console.log(`[keeper] FINAL detected for ${id}, raw message:`);
      console.log(JSON.stringify(data, null, 2));
      const winner = winnerFromScore(data);
      if (winner === null) {
        console.error(`[keeper] could not extract score from final message for ${id}`);
        return;
      }
      const seq = Number(data?.Seq ?? 0);
      try {
        const sig = await chain.resolve(id, winner, seq);
        state.resolved.add(id);
        console.log(`[keeper] resolved fixture ${id} winner=${winner} tx=${sig}`);
        broadcast("resolved", { fixtureId: id, winner, tx: sig });
      } catch (e: any) {
        console.error(`[keeper] resolve failed for ${id}: ${e.message}`);
      }
    }
  });

  server.listen(PORT, () => console.log(`OddsChain server on :${PORT} (REST + /ws)`));
}

main().catch((e) => { console.error(e); process.exit(1); });
