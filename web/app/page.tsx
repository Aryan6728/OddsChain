"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMarkets, impliedPrices, cents, homeAway, liveScore, MarketRow } from "@/lib/api";
import { code } from "@/lib/flags";
import { Flag } from "@/components/Flag";

function dayLabel(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" });
}

function ColumnHeaders() {
  return (
    <div className="hidden items-center gap-2 sm:flex">
      <span className="w-28 text-center text-[11px] font-semibold uppercase tracking-wide text-faint">Moneyline</span>
      <span className="w-28 text-center text-[11px] font-semibold uppercase tracking-wide text-faint">Draw</span>
    </div>
  );
}

function GameRow({ row }: { row: MarketRow }) {
  const { home, away } = homeAway(row.fixture);
  const prices = impliedPrices(row.odds);
  const kick = new Date(row.fixture.StartTime);
  const score = row.score ? liveScore(row.score) : null;

  return (
    <Link href={`/market/${row.fixtureId}`} className="block p-4 transition hover:bg-soft/60">
      {/* meta row: kickoff time · live badge */}
      <div className="mb-3 flex items-center gap-2 text-xs text-sub">
        <span className="font-medium">
          {row.resolved
            ? "Final"
            : kick.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        {score && !row.resolved && (
          <span className="inline-flex items-center gap-1 rounded bg-no/10 px-1.5 py-0.5 text-[11px] font-semibold text-no">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-no" /> LIVE
          </span>
        )}
        <span className="ml-auto rounded-full border border-edge px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          Reg time
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* teams */}
        <div className="min-w-0 flex-1 space-y-3">
          {[home, away].map((team, i) => (
            <div key={team} className="flex items-center gap-2.5">
              <Flag team={team} />
              <span className="truncate font-semibold text-ink">{team}</span>
              {score && <span className="ml-auto pr-2 text-sm font-bold text-ink">{score[i]}</span>}
            </div>
          ))}
        </div>

        {/* moneyline pills */}
        <div className="flex flex-col gap-2">
          {[0, 2].map((idx, i) => (
            <span key={idx} className="price-pill">
              <span className="text-xs text-current opacity-70">{code(i === 0 ? home : away)}</span>
              {prices ? cents(prices[idx]) : "—"}
            </span>
          ))}
        </div>

        {/* draw pill */}
        <div className="hidden self-stretch sm:flex">
          <span className="price-pill h-full">
            <span className="text-xs text-current opacity-70">DRAW</span>
            {prices ? cents(prices[1]) : "—"}
          </span>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const { rows, live } = useMarkets();
  const [q, setQ] = useState("");
  const [showDone, setShowDone] = useState(false);

  // header search lands here as /?q=…
  useEffect(() => {
    const p = new URLSearchParams(window.location.search).get("q");
    if (p) setQ(p);
  }, []);

  const matches = (r: MarketRow) => {
    if (!q.trim()) return true;
    const { home, away } = homeAway(r.fixture);
    return `${home} ${away}`.toLowerCase().includes(q.trim().toLowerCase());
  };

  const open = rows.filter((r) => !r.resolved && matches(r));
  const done = rows.filter((r) => r.resolved && matches(r));

  // group upcoming games by kickoff day, Polymarket-style
  const groups = useMemo(() => {
    const map = new Map<string, MarketRow[]>();
    for (const r of [...open].sort(
      (a, b) => +new Date(a.fixture.StartTime) - +new Date(b.fixture.StartTime),
    )) {
      const key = dayLabel(new Date(r.fixture.StartTime));
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return Array.from(map.entries());
  }, [rows, q]);

  return (
    <div className="pt-10">
      {/* hero */}
      <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">World Cup</h1>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-sub">
        <span>Live World Cup predictions &amp; odds</span>
        <span className="text-faint">·</span>
        <span>Powered by TxLINE consensus, settled on Solana devnet</span>
        <span className={`flex items-center gap-1.5 text-xs ${live ? "text-yes" : "text-faint"}`}>
          <span className={`h-2 w-2 rounded-full ${live ? "animate-pulse bg-yes" : "bg-faint"}`} />
          {live ? "Live" : "Reconnecting…"}
        </span>
      </div>

      {/* tabs + search */}
      <div className="mt-8 flex items-center gap-3">
        <div className="flex gap-2">
          <button
            onClick={() => setShowDone(false)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${!showDone ? "bg-soft text-ink" : "text-sub hover:text-ink"}`}
          >
            Games
          </button>
          <button
            onClick={() => setShowDone(true)}
            className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${showDone ? "bg-soft text-ink" : "text-sub hover:text-ink"}`}
          >
            Finished
          </button>
        </div>
        <div className="relative ml-auto w-44 sm:w-56">
          <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
              <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
            </svg>
          </span>
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search"
            className="w-full rounded-xl border border-edge bg-panel py-1.5 pl-8 pr-3 text-sm outline-none transition placeholder:text-faint focus:border-accent"
          />
        </div>
      </div>

      {rows.length === 0 && (
        <div className="card mt-6 p-10 text-center text-sub">
          No markets yet. Start the server (<code>npm start</code> in /server) — it creates a market for every upcoming TxLINE fixture.
        </div>
      )}

      {/* upcoming games grouped by day */}
      {!showDone &&
        groups.map(([day, games]) => (
          <section key={day} className="mt-8">
            <div className="mb-2 flex items-end justify-between px-1">
              <h2 className="text-lg font-bold text-ink">{day}</h2>
              <ColumnHeaders />
            </div>
            <div className="card divide-y divide-edge overflow-hidden">
              {games.map((r) => <GameRow key={r.fixtureId} row={r} />)}
            </div>
          </section>
        ))}

      {!showDone && open.length === 0 && rows.length > 0 && (
        <div className="card mt-6 p-10 text-center text-sub">No upcoming games match your search.</div>
      )}

      {/* finished games */}
      {showDone && (
        <section className="mt-8">
          {done.length === 0 ? (
            <div className="card p-10 text-center text-sub">No finished games yet.</div>
          ) : (
            <div className="card divide-y divide-edge overflow-hidden opacity-80">
              {done.map((r) => <GameRow key={r.fixtureId} row={r} />)}
            </div>
          )}
        </section>
      )}

      {/* View Finished divider, like the reference */}
      {!showDone && done.length > 0 && (
        <div className="mt-10 flex items-center gap-4">
          <span className="h-px flex-1 bg-edge" />
          <button
            onClick={() => setShowDone(true)}
            className="flex items-center gap-1.5 text-sm font-medium text-sub transition hover:text-ink"
          >
            <span className="grid h-5 w-5 place-items-center rounded-full border border-edge text-xs">+</span>
            View Finished
          </button>
          <span className="h-px flex-1 bg-edge" />
        </div>
      )}
    </div>
  );
}
