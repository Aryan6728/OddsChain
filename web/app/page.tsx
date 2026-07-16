"use client";
import Link from "next/link";
import { useMarkets, impliedPrices, cents, homeAway, liveScore, MarketRow } from "@/lib/api";

const LABELS = ["Home", "Draw", "Away"] as const;
const BTN = ["btn-yes", "btn-draw", "btn-no"] as const;

function LiveScore({ row }: { row: MarketRow }) {
  const s = row.score;
  if (!s) return null;
  const sc = liveScore(s); if (!sc) return null; const [s1, s2] = sc;
  return (
    <span className="ml-2 inline-flex items-center gap-1 rounded bg-no/15 px-1.5 py-0.5 text-[11px] font-semibold text-no">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-no" /> {s1}–{s2}
    </span>
  );
}

function MarketCard({ row }: { row: MarketRow }) {
  const { home, away } = homeAway(row.fixture);
  const prices = impliedPrices(row.odds);
  const kick = new Date(row.fixture.StartTime);
  return (
    <Link href={`/market/${row.fixtureId}`} className="card block p-4 transition hover:border-accent/60">
      <div className="mb-3 flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold text-white">
            {home} vs {away}
            <LiveScore row={row} />
          </div>
          <div className="mt-0.5 text-xs text-slate-400">
            {row.resolved ? "Resolved" : kick.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}
          </div>
        </div>
        <span className="rounded-full border border-edge px-2 py-0.5 text-[10px] uppercase tracking-wide text-slate-400">1X2</span>
      </div>
      <div className="grid grid-cols-3 gap-2">
        {LABELS.map((label, i) => (
          <div key={label} className={`rounded-lg px-2 py-2 text-center text-sm font-semibold transition ${BTN[i]}`}>
            <div className="text-xs font-normal opacity-80">{i === 0 ? home.split(" ")[0] : i === 2 ? away.split(" ")[0] : "Draw"}</div>
            {prices ? cents(prices[i]) : "—"}
          </div>
        ))}
      </div>
    </Link>
  );
}

export default function Home() {
  const { rows, live } = useMarkets();
  const open = rows.filter((r) => !r.resolved);
  const done = rows.filter((r) => r.resolved);

  return (
    <div className="pt-8">
      <div className="mb-6 flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">World Cup 2026 Markets</h1>
          <p className="mt-1 text-sm text-slate-400">
            Prices seeded from TxLINE StablePrice consensus odds · settled on Solana devnet in USDC
          </p>
        </div>
        <span className={`flex items-center gap-1.5 text-xs ${live ? "text-yes" : "text-slate-500"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-yes" : "bg-slate-500"}`} />
          {live ? "Live feed connected" : "Feed reconnecting…"}
        </span>
      </div>

      {rows.length === 0 && (
        <div className="card p-10 text-center text-slate-400">
          No markets yet. Start the server (<code>npm start</code> in /server) — it creates a market for every upcoming TxLINE fixture.
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {open.map((r) => <MarketCard key={r.fixtureId} row={r} />)}
      </div>

      {done.length > 0 && (
        <>
          <h2 className="mb-3 mt-10 text-lg font-semibold text-white">Resolved</h2>
          <div className="grid grid-cols-1 gap-4 opacity-70 sm:grid-cols-2 lg:grid-cols-3">
            {done.map((r) => <MarketCard key={r.fixtureId} row={r} />)}
          </div>
        </>
      )}
    </div>
  );
}
