"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { useSchedule, impliedPrices, cents, homeAway, liveScore, ScheduleRow } from "@/lib/api";
import { code } from "@/lib/flags";
import { Flag } from "@/components/Flag";

type Filter = "all" | "upcoming" | "finished";

function kickoff(f: ScheduleRow["fixture"]) {
  const n = Number(f.StartTime);
  return new Date(Number.isFinite(n) && n > 0 ? n : f.StartTime);
}

function dayLabel(d: Date) {
  return d.toLocaleDateString("en-US", { weekday: "short", month: "long", day: "numeric" });
}

function FixtureRow({ row }: { row: ScheduleRow }) {
  const { home, away } = homeAway(row.fixture);
  const kick = kickoff(row.fixture);
  const started = kick.getTime() < Date.now();
  const result = row.result ?? (row.score ? liveScore(row.score) : null);
  const isLive = started && !row.finished && !!result;
  const prices = !row.finished && row.market ? impliedPrices(row.odds) : null;
  // winning side: from the score, else from the on-chain resolution (0 home / 1 draw / 2 away)
  const winner = row.finished
    ? result
      ? result[0] > result[1] ? 0 : result[0] < result[1] ? 1 : -1
      : row.winner === 0 ? 0 : row.winner === 2 ? 1 : row.winner === 1 ? -1 : null
    : null;

  const body = (
    <>
      {/* meta row: time / status */}
      <div className="mb-3 flex items-center gap-2 text-xs text-sub">
        <span className="font-medium">
          {row.finished
            ? "Final"
            : kick.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" })}
        </span>
        {isLive && (
          <span className="inline-flex items-center gap-1 rounded bg-no/10 px-1.5 py-0.5 text-[11px] font-semibold text-no">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-no" /> LIVE
          </span>
        )}
        <span className="ml-auto rounded-full border border-edge px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-faint">
          {row.finished ? "FT" : row.market ? "Reg time" : "Scheduled"}
        </span>
      </div>

      <div className="flex items-center gap-4">
        {/* teams + score */}
        <div className="min-w-0 flex-1 space-y-3">
          {[home, away].map((team, i) => {
            const won = winner === i;
            const lost = winner !== null && winner !== -1 && !won;
            return (
              <div key={team} className="flex items-center gap-2.5">
                <Flag team={team} />
                <span className={`truncate font-semibold ${lost ? "text-sub" : "text-ink"}`}>{team}</span>
                {result ? (
                  <span className={`ml-auto pr-2 text-sm font-bold ${lost ? "text-sub" : "text-ink"}`}>
                    {result[i]}
                  </span>
                ) : won ? (
                  <span className="ml-auto pr-2 text-sm font-bold text-yes">✓</span>
                ) : null}
              </div>
            );
          })}
        </div>

        {/* right side: odds pills for open markets, status text otherwise */}
        {prices ? (
          <>
            <div className="flex flex-col gap-2">
              {[0, 2].map((idx, i) => (
                <span key={idx} className="price-pill">
                  <span className="text-xs text-current opacity-70">{code(i === 0 ? home : away)}</span>
                  {cents(prices[idx])}
                </span>
              ))}
            </div>
            <div className="hidden self-stretch sm:flex">
              <span className="price-pill h-full">
                <span className="text-xs text-current opacity-70">DRAW</span>
                {cents(prices[1])}
              </span>
            </div>
          </>
        ) : (
          <span className="shrink-0 text-xs text-faint">
            {row.finished
              ? row.market ? (row.resolved ? "Market settled" : "Settling…") : ""
              : row.market ? "" : "Market opening soon"}
          </span>
        )}
      </div>
    </>
  );

  return row.market ? (
    <Link href={`/market/${row.fixtureId}`} className="block p-4 transition hover:bg-soft/60">{body}</Link>
  ) : (
    <div className="p-4">{body}</div>
  );
}

export default function Schedule() {
  const { schedule } = useSchedule();
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");

  const rows = schedule.filter((r) => {
    if (filter === "upcoming" && r.finished) return false;
    if (filter === "finished" && !r.finished) return false;
    if (q.trim()) {
      const { home, away } = homeAway(r.fixture);
      if (!`${home} ${away}`.toLowerCase().includes(q.trim().toLowerCase())) return false;
    }
    return true;
  });

  const groups = useMemo(() => {
    const map = new Map<string, ScheduleRow[]>();
    for (const r of rows) {
      const key = dayLabel(kickoff(r.fixture));
      map.set(key, [...(map.get(key) ?? []), r]);
    }
    return Array.from(map.entries());
  }, [schedule, filter, q]);

  const TABS: [Filter, string][] = [["all", "All"], ["upcoming", "Upcoming"], ["finished", "Finished"]];

  return (
    <div className="pt-10">
      <h1 className="text-4xl font-bold tracking-tight text-ink sm:text-5xl">Schedule</h1>
      <p className="mt-2 text-sm text-sub">
        Full World Cup fixture list — results and upcoming matches. Tap a game to trade its market.
      </p>

      <div className="mt-8 flex items-center gap-3">
        <div className="flex gap-2">
          {TABS.map(([key, label]) => (
            <button
              key={key}
              onClick={() => setFilter(key)}
              className={`rounded-full px-4 py-1.5 text-sm font-semibold transition ${filter === key ? "bg-soft text-ink" : "text-sub hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
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

      {schedule.length === 0 && (
        <div className="card mt-6 p-10 text-center text-sub">
          Schedule loads from the live TxLINE feed — start the server (<code>npm start</code> in /server).
        </div>
      )}

      {groups.map(([day, games]) => (
        <section key={day} className="mt-8">
          <div className="mb-2 px-1">
            <h2 className="text-lg font-bold text-ink">{day}</h2>
          </div>
          <div className="card divide-y divide-edge overflow-hidden">
            {games.map((r) => <FixtureRow key={r.fixtureId} row={r} />)}
          </div>
        </section>
      ))}

      {schedule.length > 0 && rows.length === 0 && (
        <div className="card mt-6 p-10 text-center text-sub">No matches found.</div>
      )}
    </div>
  );
}
