"use client";
import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import type { WalletContextState } from "@solana/wallet-adapter-react";
import idl from "./idl/txmarket.json";

const RPC = process.env.NEXT_PUBLIC_RPC ?? "https://api.devnet.solana.com";
const USDC = new PublicKey(process.env.NEXT_PUBLIC_USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");

export const connection = new Connection(RPC, "confirmed");

function program(wallet: WalletContextState) {
  const provider = new anchor.AnchorProvider(connection, wallet as any, { commitment: "confirmed" });
  return new anchor.Program(idl as anchor.Idl, provider);
}

export function pdas(programId: PublicKey, fixtureId: number, user?: PublicKey) {
  const fid = new anchor.BN(fixtureId).toArrayLike(Buffer, "le", 8);
  const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), fid], programId);
  const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), fid], programId);
  const position = user
    ? PublicKey.findProgramAddressSync([Buffer.from("position"), market.toBuffer(), user.toBuffer()], programId)[0]
    : undefined;
  return { market, vault, position };
}

export async function fetchMarket(wallet: WalletContextState, fixtureId: number) {
  const p = program(wallet);
  const { market } = pdas(p.programId, fixtureId);
  return (p.account as any).market.fetch(market);
}

/** On-chain AMM prices from pool balances: price_i = (1/pool_i) / Σ(1/pool_j) */
export function poolPrices(pools: anchor.BN[], n: number): number[] {
  const inv = pools.slice(0, n).map((b) => 1 / Math.max(1, b.toNumber()));
  const s = inv.reduce((a, b) => a + b, 0);
  return inv.map((x) => x / s);
}

/** Quote FPMM buy client-side (mirrors program math) for the trade panel. */
export function quoteBuy(pools: number[], outcome: number, amountIn: number, feeBps = 200) {
  const a = amountIn * (1 - feeBps / 10_000);
  const k = pools.reduce((x, y) => x * y, 1);
  const prodOther = pools.reduce((acc, p, i) => (i === outcome ? acc : acc * (p + a)), 1);
  const newPoolO = k / prodOther;
  const shares = pools[outcome] + a - newPoolO;
  return { shares, avgPrice: amountIn / shares };
}

export async function buy(
  wallet: WalletContextState, fixtureId: number, outcome: number,
  amountUsdc: number, minSharesOut: number,
) {
  const p = program(wallet);
  const user = wallet.publicKey!;
  const { market, vault, position } = pdas(p.programId, fixtureId, user);
  const userUsdc = getAssociatedTokenAddressSync(USDC, user);
  return (p.methods as any)
    .buy(outcome, new anchor.BN(Math.floor(amountUsdc * 1e6)), new anchor.BN(Math.floor(minSharesOut * 1e6)))
    .accounts({
      market, vault, position, userUsdc, user,
      tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
    })
    .rpc();
}

export async function claim(wallet: WalletContextState, fixtureId: number) {
  const p = program(wallet);
  const user = wallet.publicKey!;
  const { market, vault, position } = pdas(p.programId, fixtureId, user);
  const userUsdc = getAssociatedTokenAddressSync(USDC, user);
  return (p.methods as any)
    .claim()
    .accounts({ market, vault, position, userUsdc, user, tokenProgram: TOKEN_PROGRAM_ID })
    .rpc();
}

export async function fetchPosition(wallet: WalletContextState, fixtureId: number) {
  const p = program(wallet);
  const { position } = pdas(p.programId, fixtureId, wallet.publicKey!);
  try { return await (p.account as any).position.fetch(position!); }
  catch { return null; }
}
