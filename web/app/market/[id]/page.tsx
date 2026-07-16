"use client";
import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarkets, impliedPrices, cents, homeAway } from "@/lib/api";
import { fetchMarket, fetchPosition, poolPrices, quoteBuy, buy, claim } from "@/lib/anchor";

const LABELS = ["Home wins", "Draw", "Away wins"];
const COLORS = ["text-yes", "text-draw", "text-no"];
const FILL = ["bg-yes", "bg-draw", "bg-no"];

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

  if (!row) return <div className="card mt-8 p-10 text-center text-slate-400">Loading market…</div>;
  const { home, away } = homeAway(row.fixture);
  const names = [home, "Draw", away];

  return (
    <div className="grid grid-cols-1 gap-6 pt-8 lg:grid-cols-[1fr_360px]">
      <div>
        <h1 className="text-2xl font-bold text-white">{home} vs {away}</h1>
        <p className="mt-1 text-sm text-slate-400">
          Kickoff {new Date(row.fixture.StartTime).toLocaleString()} · Fixture #{fixtureId}
          {row.resolved && <span className="ml-2 rounded bg-yes/15 px-2 py-0.5 text-xs text-yes">Resolved</span>}
        </p>

        {/* price bars: on-chain AMM vs TxLINE consensus */}
        <div className="card mt-6 divide-y divide-edge">
          {LABELS.map((label, i) => {
            const p = chainPrices?.[i] ?? feedPrices?.[i] ?? 0;
            return (
              <div key={label} className="p-4">
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="font-medium text-white">{names[i]}</span>
                  <span className={`text-lg font-bold ${COLORS[i]}`}>{cents(p)}</span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-edge">
                  <div className={`h-full ${FILL[i]}`} style={{ width: `${p * 100}%` }} />
                </div>
                <div className="mt-1 flex justify-between text-[11px] text-slate-500">
                  <span>{label}</span>
                  {feedPrices && <span>TxLINE consensus: {cents(feedPrices[i])}</span>}
                </div>
              </div>
            );
          })}
        </div>

        {position && (
          <div className="card mt-6 p-4">
            <h3 className="mb-2 font-semibold text-white">Your position</h3>
            <div className="grid grid-cols-3 gap-3 text-center">
              {names.map((n, i) => (
                <div key={n} className="rounded-lg bg-ink p-3">
                  <div className="text-xs text-slate-400">{n}</div>
                  <div className="font-bold text-white">{(position.shares[i].toNumber() / 1e6).toFixed(2)}</div>
                </div>
              ))}
            </div>
            {row.resolved && (
              <button onClick={onClaim} disabled={busy}
                className="mt-4 w-full rounded-lg bg-yes py-2.5 font-semibold text-white disabled:opacity-50">
                {busy ? "Claiming…" : "Claim winnings"}
              </button>
            )}
          </div>
        )}
      </div>

      {/* trade panel */}
      <div className="card h-fit p-4 lg:sticky lg:top-20">
        <h3 className="mb-3 font-semibold text-white">Buy shares</h3>
        <div className="mb-3 grid grid-cols-3 gap-2">
          {names.map((n, i) => (
            <button key={n} onClick={() => setOutcome(i)}
              className={`rounded-lg border py-2 text-sm font-semibold transition
                ${outcome === i ? "border-accent bg-accent/15 text-white" : "border-edge text-slate-400 hover:text-white"}`}>
              {n.split(" ")[0]}
            </button>
          ))}
        </div>
        <label className="mb-1 block text-xs text-slate-400">Amount (USDC, devnet)</label>
        <input value={amount} onChange={(e) => setAmount(e.target.value)} inputMode="decimal"
          className="mb-3 w-full rounded-lg border border-edge bg-ink px-3 py-2.5 text-white outline-none focus:border-accent" />
        {quote && Number(amount) > 0 && (
          <div className="mb-3 space-y-1 rounded-lg bg-ink p-3 text-sm">
            <div className="flex justify-between text-slate-400"><span>Shares out</span><span className="text-white">{quote.shares.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-400"><span>Avg price</span><span className="text-white">{cents(quote.avgPrice)}</span></div>
            <div className="flex justify-between text-slate-400"><span>Payout if correct</span><span className="text-yes">${quote.shares.toFixed(2)}</span></div>
            <div className="flex justify-between text-slate-400"><span>Fee</span><span>2%</span></div>
          </div>
        )}
        <button onClick={onBuy}
          disabled={busy || !wallet.connected || row.resolved || !onchain}
          className="w-full rounded-lg bg-accent py-2.5 font-semibold text-white transition hover:bg-blue-500 disabled:opacity-50">
          {!wallet.connected ? "Connect wallet" : row.resolved ? "Market resolved" : busy ? "Confirming…" : `Buy ${names[outcome].split(" ")[0]}`}
        </button>
        {txSig && (
          <a href={`https://explorer.solana.com/tx/${txSig}?cluster=devnet`} target="_blank"
            className="mt-2 block truncate text-center text-xs text-accent hover:underline">
            View transaction ↗
          </a>
        )}
        {err && <p className="mt-2 text-xs text-no">{err}</p>}
        <p className="mt-3 text-[11px] leading-relaxed text-slate-500">
          Devnet demo — no real funds. Winning shares redeem 1 : 1 for devnet USDC after the keeper
          resolves the market from TxLINE's final score feed.
        </p>
      </div>
    </div>
  );
}
