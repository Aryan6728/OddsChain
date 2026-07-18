"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarkets, impliedPrices, cents, homeAway } from "@/lib/api";
import { fetchMarket, fetchPosition, poolPrices, quoteBuy, buy, claim } from "@/lib/anchor";
import { code } from "@/lib/flags";
import { Flag } from "@/components/Flag";

const LABELS = ["Home wins", "Draw", "Away wins"];
const COLORS = ["text-accent", "text-draw", "text-no"];
const FILL = ["bg-accent", "bg-draw", "bg-no"];
const QUICK_ADD = [1, 5, 10, 100];

export default function MarketPage() {
  const { id } = useParams<{ id: string }>();
  const fixtureId = Number(id);
  const wallet = useWallet();
  const { rows } = useMarkets();
  const row = rows.find((r) => r.fixtureId === fixtureId);

  const [onchain, setOnchain] = useState<any>(null);
  const [position, setPosition] = useState<any>(null);
  const [outcome, setOutcome] = useState(0);
  const [amount, setAmount] = useState("10");
  const [busy, setBusy] = useState(false);
  const [txSig, setTxSig] = useState("");
  const [err, setErr] = useState("");

  async function refresh() {
    try { setOnchain(await fetchMarket(wallet, fixtureId)); } catch { /* market may not exist yet */ }
    if (wallet.publicKey) {
      try { setPosition(await fetchPosition(wallet, fixtureId)); } catch {}
    }
  }
  useEffect(() => { refresh(); }, [wallet.publicKey, fixtureId]);

  const pools: number[] | null = useMemo(
    () => (onchain ? onchain.pools.slice(0, onchain.outcomeCount).map((b: any) => b.toNumber() / 1e6) : null),
    [onchain],
  );
  const chainPrices = onchain ? poolPrices(onchain.pools, onchain.outcomeCount) : null;
  const feedPrices = row ? impliedPrices(row.odds) : null;
  const quote = pools ? quoteBuy(pools, outcome, Number(amount) || 0) : null;

  async function onBuy() {
    setBusy(true); setErr(""); setTxSig("");
    try {
      const minOut = quote ? quote.shares * 0.98 : 0; // 2% slippage guard
      const sig = await buy(wallet, fixtureId, outcome, Number(amount), minOut);
      setTxSig(sig);
      await refresh();
    } catch (e: any) { setErr(e.message ?? String(e)); }
    setBusy(false);
  }

  async function onClaim() {
    setBusy(true); setErr("");
    try { setTxSig(await claim(wallet, fixtureId)); await refresh(); }
    catch (e: any) { setErr(e.message ?? String(e)); }
    setBusy(false);
  }

  if (!row) return <div className="card mt-10 p-10 text-center text-sub">Loading market…</div>;
  const { home, away } = homeAway(row.fixture);
  const names = [home, "Draw", away];
  const codes = [code(home), "DRAW", code(away)];
  const price = (i: number) => chainPrices?.[i] ?? feedPrices?.[i] ?? 0;

  return (
    <div className="grid grid-cols-1 gap-8 pt-10 lg:grid-cols-[1fr_340px]">
      <div>
        {/* header */}
        <div className="flex items-center gap-3">
          <Flag team={home} size={34} />
          <Flag team={away} size={34} />
          <h1 className="text-2xl font-bold text-ink sm:text-3xl">{home} vs {away}</h1>
        </div>
        <p className="mt-2 text-sm text-sub">
          Kickoff {new Date(row.fixture.StartTime).toLocaleString()} · Fixture #{fixtureId}
          {row.resolved && (
            <span className="ml-2 rounded bg-yes/10 px-2 py-0.5 text-xs font-semibold text-yes">Resolved</span>
          )}
        </p>

        {/* outcomes: on-chain AMM price vs TxLINE consensus */}
        <div className="card mt-6 divide-y divide-edge overflow-hidden">
          <div className="flex items-center justify-between bg-soft/50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-faint">
            <span>Outcome</span><span>Price</span>
          </div>
          {LABELS.map((label, i) => {
            const p = price(i);
            return (
              <div key={label} className="p-4">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="flex items-center gap-2 font-semibold text-ink">
                    {i !== 1 && <Flag team={names[i]} />}
                    {names[i]}
                  </span>
                  <span className={`text-lg font-bold ${COLORS[i]}`}>{cents(p)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-soft">
                  <div className={`h-full ${FILL[i]}`} style={{ width: `${p * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-faint">
                  <span>{label}</span>
                  {feedPrices && <span>TxLINE consensus: {cents(feedPrices[i])}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {position && (
          <div className="card mt-6 p-4">
            <h3 className="mb-2 font-semibold text-ink">Your position</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              {names.map((n, i) => (
                <div key={n} className="rounded-xl bg-soft p-3">
                  <div className="text-xs text-sub">{n}</div>
                  <div className="font-bold text-ink">{(position.shares[i].toNumber() / 1e6).toFixed(2)}</div>
                </div>
              ))}
            </div>
            {row.resolved && (
              <button onClick={onClaim} disabled={busy}
                className="mt-4 w-full rounded-xl bg-yes py-2.5 font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                {busy ? "Claiming…" : "Claim winnings"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* trade widget */}
      <div className="card h-fit p-5 lg:sticky lg:top-28">
        <div className="flex items-center gap-2.5">
          {outcome === 1 ? (
            <span className="grid h-[22px] w-[30px] shrink-0 place-items-center rounded-[3px] border border-edge bg-soft text-[10px] font-bold text-sub">X</span>
          ) : (
            <Flag team={names[outcome]} size={30} />
          )}
          <div>
            <div className="text-xs text-sub">Match winner</div>
            <div className="font-bold text-ink">{names[outcome]}</div>
          </div>
        </div>

        <div className="mt-4 flex items-center justify-between border-b border-edge text-sm">
          <span className="border-b-2 border-ink pb-2 font-semibold text-ink">Buy</span>
          <span className="pb-2 text-sub">Market</span>
        </div>

        {/* outcome selector */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {names.map((n, i) => (
            <button key={n} onClick={() => setOutcome(i)}
              className={`rounded-lg py-2.5 text-sm font-semibold shadow-btn transition
                ${outcome === i ? "bg-accent text-white" : "bg-soft text-ink hover:bg-softer"}`}>
              <span className="block text-[11px] opacity-70">{codes[i]}</span>
              {cents(price(i))}
            </button>
          ))}
        </div>

        {/* amount */}
        <div className="mt-5 flex items-center justify-between">
          <span className="font-semibold text-ink">Amount</span>
          <div className="flex items-baseline text-4xl font-bold text-faint">
            <span className={Number(amount) > 0 ? "text-ink" : ""}>$</span>
            <input
              value={amount}
              onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))}
              inputMode="decimal"
              placeholder="0"
              style={{ width: `${Math.min(8, Math.max(1, amount.length || 1))}ch` }}
              className="bg-transparent text-right text-4xl font-bold text-ink outline-none placeholder:text-faint"
            />
          </div>
        </div>
        <div className="mt-3 flex justify-end gap-2">
          {QUICK_ADD.map((n) => (
            <button key={n} onClick={() => setAmount(String((Number(amount) || 0) + n))} className="chip">
              +${n}
            </button>
          ))}
        </div>

        <button onClick={onBuy}
          disabled={busy || !wallet.connected || row.resolved || !onchain}
          className="mt-5 w-full rounded-xl bg-accent py-3 font-semibold text-white shadow-btn transition hover:bg-accent2 disabled:opacity-50">
          {!wallet.connected ? "Connect wallet" : row.resolved ? "Market resolved" : busy ? "Confirming…" : "Trade"}
        </button>

        {quote && Number(amount) > 0 && (
          <div className="mt-4 space-y-1.5 rounded-xl bg-soft p-3 text-sm">
            <div className="flex justify-between text-sub"><span>Shares out</span><span className="font-semibold text-ink">{quote.shares.toFixed(2)}</span></div>
            <div className="flex justify-between text-sub"><span>Avg price</span><span className="font-semibold text-ink">{cents(quote.avgPrice)}</span></div>
            <div className="flex justify-between text-sub"><span>To win</span><span className="font-semibold text-yes">${quote.shares.toFixed(2)}</span></div>
            <div className="flex justify-between text-sub"><span>Fee</span><span>2%</span></div>
          </div>
        )}

        {txSig && (
          <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank"
            className="mt-3 block truncate text-center text-xs text-accent hover:underline">
            View transaction ↗
          </a>
        )}
        {err && <p className="mt-2 text-xs text-no">{err}</p>}
        <p className="mt-4 text-center text-[11px] leading-relaxed text-faint">
          Devnet demo — no real funds. Winning shares redeem 1 : 1 for devnet USDC after the keeper
          resolves the market from TxLINE&apos;s final score feed.
        </p>
      </div>
    </div>
  );
}
