"use client";
import { useEffect, useRef, useState } from "react";

const API = process.env.NEXT_PUBLIC_API ?? "http://localhost:4000";
const WS = process.env.NEXT_PUBLIC_WS ?? "ws://localhost:4000/ws";

export interface MarketRow {
  fixtureId: number;
  market: string;
  fixture: {
    Participant1: string;
    Participant2: string;
    Participant1IsHome: boolean;
    StartTime: string | number;
  };
  odds: any;
  score: any;
  resolved: boolean;
}

export function homeAway(f: MarketRow["fixture"]) {
  return { home: f.Participant1, away: f.Participant2 };
}

export function useMarkets() {
  const [rows, setRows] = useState<MarketRow[]>([]);
  const [live, setLive] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    let dead = false;
    fetch(`${API}/markets`).then((r) => r.json()).then((d) => !dead && setRows(d)).catch(() => {});

    function connect() {
      const ws = new WebSocket(WS);
      wsRef.current = ws;
      ws.onopen = () => setLive(true);
      ws.onclose = () => { setLive(false); if (!dead) setTimeout(connect, 3000); };
      ws.onmessage = (e) => {
        const { type, payload } = JSON.parse(e.data);
        setRows((prev) => {
          const next = [...prev];
          const i = next.findIndex((r) => r.fixtureId === payload.fixtureId);
          if (type === "odds" && i >= 0) next[i] = { ...next[i], odds: payload.data };
          if (type === "score" && i >= 0) next[i] = { ...next[i], score: payload.data };
          if (type === "resolved" && i >= 0) next[i] = { ...next[i], resolved: true };
          if (type === "market_created" && i < 0)
            fetch(`${API}/markets`).then((r) => r.json()).then(setRows).catch(() => {});
          return next;
        });
      };
    }
    connect();
    return () => { dead = true; wsRef.current?.close(); };
  }, []);

  return { rows, live };
}

export interface ScheduleRow {
  fixtureId: number;
  fixture: MarketRow["fixture"];
  market: string | null;
  odds: any;
  score: any;
  result: [number, number] | null;
  finished: boolean;
  resolved: boolean;
}

/** Full fixture schedule (past + upcoming), polled once a minute. */
export function useSchedule() {
  const [schedule, setSchedule] = useState<ScheduleRow[]>([]);

  useEffect(() => {
    let dead = false;
    const load = () =>
      fetch(`${API}/schedule`).then((r) => r.json()).then((d) => !dead && setSchedule(d)).catch(() => {});
    load();
    const t = setInterval(load, 60_000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  return { schedule };
}

export function impliedPrices(odds: any): number[] | null {
  const pct = odds?.Pct;
  if (!Array.isArray(pct) || pct.length !== 3) return null;
  const nums = pct.map((p: string) => Number(p));
  if (!nums.every((n) => Number.isFinite(n) && n > 0)) return null;
  const sum = nums[0] + nums[1] + nums[2];
  return nums.map((n) => n / sum);
}

export function liveScore(msg: any): [number, number] | null {
  const spots = [msg?.Stats, msg?.Data, msg];
  for (const s of spots) {
    if (!s) continue;
    const s1 = s.Score1 ?? s.score1 ?? s.Goals1 ?? s.goals1;
    const s2 = s.Score2 ?? s.score2 ?? s.Goals2 ?? s.goals2;
    if (s1 !== undefined && s2 !== undefined) return [Number(s1), Number(s2)];
  }
  return null;
}

export const cents = (p: number) => `${Math.round(p * 100)}¢`;
