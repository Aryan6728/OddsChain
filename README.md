# OddsChain — World Cup Prediction Markets powered by TxLINE

A prediction market on Solana devnet. Every market is created from a live
TxLINE fixture, opening prices are seeded from TxLINE StablePrice consensus odds, live odds
and scores stream in over SSE, and a keeper bot resolves markets on-chain the moment
TxLINE's score feed reports the match final. 

## Architecture

```
TxLINE devnet API ──snapshots + SSE──▶ server (Node)
                                        ├─ creates one on-chain market per fixture
                                        ├─ REST + WebSocket relay ──▶ web (Next.js, Polymarket UI)
                                        └─ keeper: match final ──▶ resolve() on-chain
                                                                      │
Users ◀── Phantom/Solflare ── buy/claim ──▶ Anchor program (FPMM, USDC vault)
```

- **AMM**: multi-outcome Fixed Product Market Maker (same model as Polymarket's FPMM).
  3 outcomes per soccer market (Home / Draw / Away). Product of pool balances stays
  constant across trades; winning shares redeem 1:1 for USDC.
- **Tokens**: Circle devnet USDC (`4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU`) for trading;
  SOL for tx fees and the TxLINE on-chain `subscribe`.
- **Resolution**: keeper wallet is the oracle authority; `resolve()` stores the TxLINE score
  sequence (`txline_ref`) so every resolution is auditable against the feed.
  Roadmap: replace keeper with direct CPI into txoracle `validate_fixture`.

## TxLINE endpoints used (for submission docs)

| Endpoint | Use |
| --- | --- |
| `POST /auth/guest/start` | guest JWT |
| on-chain `subscribe` (txoracle `6pW64g…yP2J`) | World Cup free tier |
| `POST /api/token/activate` | API token |
| `GET /api/fixtures/snapshot` | market creation |
| `GET /api/odds/snapshot/{fixtureId}` | seed AMM prices from consensus odds |
| `GET /api/odds/stream` (SSE) | live odds on every card |
| `GET /api/scores/stream` (SSE) | live scores + keeper trigger |
| `GET /api/scores/snapshot/{fixtureId}` | detail page |
| `GET /api/scores/historical/{fixtureId}` | resolution audit |

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
