"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useMarkets, homeAway } from "@/lib/api";
import { fetchPosition, claim } from "@/lib/anchor";
import { Flag } from "@/components/Flag";

export default function Portfolio() {
  const wallet = useWallet();
  const { rows } = useMarkets();
  const [positions, setPositions] = useState<Record<number, any>>({});
  const [busy, setBusy] = useState<number | null>(null);

  useEffect(() => {
    if (!wallet.publicKey || rows.length === 0) return;
    (async () => {
      const out: Record<number, any> = {};
      for (const r of rows) {
        const p = await fetchPosition(wallet, r.fixtureId);
        if (p && p.shares.some((s: any) => s.toNumber() > 0)) out[r.fixtureId] = p;
      }
      setPositions(out);
    })();
  }, [wallet.publicKey, rows.length]);

  async function onClaim(fixtureId: number) {
    setBusy(fixtureId);
    try { await claim(wallet, fixtureId); setPositions((p) => { const n = { ...p }; delete n[fixtureId]; return n; }); }
    catch (e) { console.error(e); }
    setBusy(null);
  }

  if (!wallet.connected)
    return <div className="card mt-10 p-10 text-center text-sub">Connect your wallet to see positions.</div>;

  const entries = Object.entries(positions);
  return (
    <div className="pt-10">
      <h1 className="text-3xl font-bold tracking-tight text-ink">Portfolio</h1>
      <p className="mb-6 mt-1 text-sm text-sub">Your open positions across all markets</p>
      {entries.length === 0 && (
        <div className="card p-10 text-center text-sub">
          No open positions. <Link href="/" className="font-medium text-accent hover:underline">Browse markets →</Link>
        </div>
      )}
      {entries.length > 0 && (
        <div className="card divide-y divide-edge overflow-hidden">
          {entries.map(([fid, pos]) => {
            const row = rows.find((r) => r.fixtureId === Number(fid));
            if (!row) return null;
            const { home, away } = homeAway(row.fixture);
            const names = [home, "Draw", away];
            return (
              <div key={fid} className="flex flex-wrap items-center gap-4 p-4 transition hover:bg-soft/60">
                <Link href={`/market/${fid}`} className="flex min-w-48 items-center gap-2 font-semibold text-ink hover:text-accent">
                  <Flag team={home} />
                  {home} vs {away}
                  <Flag team={away} />
                </Link>
                <div className="flex gap-4 text-sm">
                  {names.map((n, i) => {
                    const s = pos.shares[i].toNumber() / 1e6;
                    return s > 0 ? (
                      <span key={n} className="rounded-lg bg-soft px-2.5 py-1 text-sub">
                        {n.split(" ")[0]}: <b className="text-ink">{s.toFixed(2)}</b>
                      </span>
                    ) : null;
                  })}
                </div>
                <div className="ml-auto">
                  {row.resolved ? (
                    <button onClick={() => onClaim(Number(fid))} disabled={busy === Number(fid)}
                      className="rounded-lg bg-yes px-4 py-2 text-sm font-semibold text-white transition hover:brightness-110 disabled:opacity-50">
                      {busy === Number(fid) ? "Claiming…" : "Claim"}
                    </button>
                  ) : (
                    <span className="text-xs text-faint">Awaiting result</span>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
