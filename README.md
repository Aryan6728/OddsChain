# OddsChain — World Cup Prediction Markets powered by TxLINE

A prediction market on Solana devnet. Every market is created from a live
TxLINE fixture, opening prices are seeded from TxLINE StablePrice consensus odds, live odds
and scores stream in over SSE, and a keeper bot resolves markets on-chain the moment
TxLINE's score feed reports the match final.

## Architecture

```
                 ┌────────────────────── TxLINE devnet API ──────────────────────┐
                 │  fixtures snapshot (+ World Cup competitionId)                │
                 │  odds / scores SSE streams · score snapshot & history         │
                 └───────────────┬───────────────────────────────────────────────┘
                                 ▼
                    server (Node, hosted on Render)
                    ├─ market creation: one on-chain market per upcoming fixture,
                    │    AMM pools seeded from TxLINE consensus odds
                    ├─ keeper: live final event ──▶ resolve() on-chain
                    ├─ backfill: missed finals settled later from score history
                    ├─ results sync: final scores for every fixture (schedule)
                    ├─ boot restore: markets + resolved state reloaded from chain
                    └─ REST + WebSocket relay
                                 │
                                 ▼
                    web (Next.js, hosted on Vercel)
                    ├─ Markets: live price pills, buy widget, portfolio & claims
                    └─ Schedule: full fixture list — results, live scores, upcoming
                                 │
Users ◀── Phantom/Solflare ── buy/claim ──▶ Anchor program on Solana devnet
                                            (FPMM, USDC vault — the durable store)
```

- **AMM**: multi-outcome Fixed Product Market Maker. 3 outcomes per soccer market
  (Home / Draw / Away). Product of pool balances stays constant across trades;
  winning shares redeem 1:1 for USDC.
- **Tokens**: Circle devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) for trading;
  SOL for tx fees and the TxLINE on-chain `subscribe`.
- **Resolution**: keeper wallet is the oracle authority; `resolve()` stores the TxLINE score
  sequence (`txline_ref`) so every resolution is auditable against the feed. Finals missed
  while the server was down are backfilled from the TxLINE score snapshot/history.
  Roadmap: replace keeper with direct CPI into txoracle `validate_fixture`.
- **Durability**: the chain is the database. On boot the server reloads every market
  (and its resolved state) via `program.account.market.all()`, so host restarts or
  free-tier spin-downs never lose settled games.

## Live deployment

| Piece | Host | Notes |
| --- | --- | --- |
| `web/` | Vercel | `web/.env.production` points the build at the API below |
| `server/` | Render (root dir `server`, `npm install` / `npm start`) | needs env vars from `server/.env.example` + keeper wallet as a Secret File |
| program | Solana devnet | id in `program/Anchor.toml` |

Render free tier sleeps after 15 min idle — keep a cron ping on `/health`
(e.g. cron-job.org every 10 min) so live streams and the keeper stay up.
`SEED_LIQUIDITY_USDC` controls how much USDC each new market pulls from the
keeper wallet; `WC_COMPETITION_ID` (default 72) merges the full World Cup
fixture list into the schedule.

## TxLINE endpoints used (for submission docs)

| Endpoint | Use |
| --- | --- |
| `POST /auth/guest/start` | guest JWT |
| on-chain `subscribe` (txoracle `6pW64g…yP2J`) | World Cup free tier |
| `POST /api/token/activate` | API token |
| `GET /api/fixtures/snapshot` (+ `?competitionId=72`) | market creation + full World Cup schedule |
| `GET /api/odds/snapshot/{fixtureId}` | seed AMM prices from consensus odds |
| `GET /api/odds/stream` (SSE) | live odds on every card |
| `GET /api/scores/stream` (SSE) | live scores + keeper trigger |
| `GET /api/scores/snapshot/{fixtureId}` | final-score backfill + detail page |
| `GET /api/scores/historical/{fixtureId}` | missed finals: score backfill + keeper backfill resolution |

## Setup (WSL2)

### 0. Prereqs
```bash
solana config set --url devnet
solana airdrop 2
# devnet USDC for seeding/testing: https://faucet.circle.com (Solana devnet)
```

### 1. Program
```bash
cd program
anchor keys sync            # generates real program id, updates lib.rs + Anchor.toml
anchor build && anchor deploy
cp target/idl/oddschain.json ../server/idl/oddschain.json
cp target/idl/oddschain.json ../web/lib/idl/oddschain.json
```
Update `NEXT_PUBLIC_PROGRAM_ID` in `web/.env.local` with the deployed id.

### 2. TxLINE activation (one time)
```bash
cd server && npm i
# download txoracle devnet IDL into server/idl/txoracle.json from
# https://github.com/txodds/tx-on-chain (examples/devnet)
npm run activate            # prints TXLINE_API_TOKEN
cp .env.example .env        # paste the token
```

### 3. Verify real payload shapes (IMPORTANT)
```bash
npm run inspect                    # list fixtures
npm run inspect -- <fixtureId>     # dump odds + scores JSON
```
Check the field names in `src/index.ts` (`extractMoneylineProbBps`, `isFinal`,
`winnerFromScore`) and `web/lib/api.ts` (`impliedPrices`) against the real payloads
and adjust — the code covers the common casings but verify once against live data.

### 4. Run
```bash
cd server && npm start      # market creation + live streams + keeper on :4000
cd web && npm i && cp .env.local.example .env.local && npm run dev
```

## Compliance note
Devnet demonstration only. No real funds, no fiat on/off ramp. Built for the TxODDS
World Cup Hackathon under its T&C; not a gambling product.
