/**
 * TxLINE client — devnet, World Cup free tier.
 *
 * Endpoints used (list these in your submission docs):
 *  POST /auth/guest/start                       — guest JWT
 *  POST /api/token/activate                     — API token after on-chain subscribe
 *  GET  /api/fixtures/snapshot                  — all fixtures (+ ?competitionId=)
 *  GET  /api/odds/snapshot/{fixtureId}          — odds for a fixture
 *  GET  /api/scores/snapshot/{fixtureId}        — scores for a fixture
 *  GET  /api/scores/historical/{fixtureId}      — full score sequence (completed matches)
 *  GET  /api/odds/stream                        — live odds SSE
 *  GET  /api/scores/stream                      — live scores SSE
 */
import axios, { AxiosInstance } from "axios";

const API_ORIGIN = process.env.TXLINE_ORIGIN ?? "https://txline-dev.txodds.com";

export interface Fixture {
  FixtureId: number;
  Participant1: string;
  Participant2: string;
  Participant1IsHome: boolean;
  StartTime: string | number;
  CompetitionId?: number;
  GameState?: number; // 1 scheduled, 6 cancelled
}

export class TxLine {
  private jwt = "";
  private apiToken: string;
  private http!: AxiosInstance;

  constructor(apiToken: string) {
    this.apiToken = apiToken;
  }

  async init() {
    await this.renewJwt();
  }

  async renewJwt() {
    const res = await axios.post(`${API_ORIGIN}/auth/guest/start`);
    this.jwt = res.data.token;
    this.http = axios.create({
      baseURL: API_ORIGIN,
      timeout: 30_000,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.jwt}`,
        "X-Api-Token": this.apiToken,
      },
    });
  }

  private async get<T>(path: string, params?: any): Promise<T> {
    try {
      const res = await this.http.get(path, { params });
      return res.data as T;
    } catch (e: any) {
      if (e?.response?.status === 401) {
        // guest JWT expired — renew from same host and retry once
        await this.renewJwt();
        const res = await this.http.get(path, { params });
        return res.data as T;
      }
      throw e;
    }
  }

  fixtures(competitionId?: number) {
    return this.get<Fixture[]>("/api/fixtures/snapshot", competitionId ? { competitionId } : undefined);
  }
  odds(fixtureId: number) {
    return this.get<any[]>(`/api/odds/snapshot/${fixtureId}`);
  }
  scores(fixtureId: number) {
    return this.get<any[]>(`/api/scores/snapshot/${fixtureId}`);
  }
  historicalScores(fixtureId: number) {
    return this.get<any[]>(`/api/scores/historical/${fixtureId}`);
  }

  /** Open an SSE stream ("odds" | "scores") and invoke onMessage per event. Auto-reconnects. */
  async stream(kind: "odds" | "scores", onMessage: (event: string, data: any) => void) {
    const url = `${API_ORIGIN}/api/${kind}/stream`;
    // eslint-disable-next-line no-constant-condition
    while (true) {
      try {
        const res = await fetch(url, {
          headers: {
            Authorization: `Bearer ${this.jwt}`,
            "X-Api-Token": this.apiToken,
            Accept: "text/event-stream",
            "Cache-Control": "no-cache",
          },
        });
        if (res.status === 401) { await this.renewJwt(); continue; }
        if (!res.ok || !res.body) throw new Error(`${kind} stream failed: ${res.status}`);
        console.log(`[txline] ${kind} stream open`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        while (true) {
          const { value, done } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          let idx;
          while ((idx = buf.search(/\r?\n\r?\n/)) !== -1) {
            const block = buf.slice(0, idx);
            buf = buf.slice(idx).replace(/^\r?\n\r?\n/, "");
            let event = "message", data = "";
            for (const line of block.split(/\r?\n/)) {
              if (!line || line.startsWith(":")) continue;
              const sep = line.indexOf(":");
              const field = sep === -1 ? line : line.slice(0, sep);
              const val = sep === -1 ? "" : line.slice(sep + 1).replace(/^ /, "");
              if (field === "data") data += val + "\n";
              if (field === "event") event = val;
            }
            data = data.replace(/\n$/, "");
            if (!data) continue;
            try { onMessage(event, JSON.parse(data)); }
            catch { onMessage(event, data); }
          }
        }
        console.warn(`[txline] ${kind} stream ended, reconnecting in 3s`);
      } catch (e: any) {
        console.warn(`[txline] ${kind} stream error: ${e.message}, reconnecting in 3s`);
      }
      await new Promise((r) => setTimeout(r, 3000));
    }
  }
}
