/** Solana side for the server: create markets + keeper resolution. */
import * as anchor from "@coral-xyz/anchor";
import { Connection, Keypair, PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddressSync } from "@solana/spl-token";
import fs from "fs";
import os from "os";
import path from "path";

const RPC = process.env.RPC_URL ?? "https://api.devnet.solana.com";
// Circle's official devnet USDC mint
export const USDC_MINT = new PublicKey(process.env.USDC_MINT ?? "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU");
const SEED_LIQUIDITY = Number(process.env.SEED_LIQUIDITY_USDC ?? 100) * 1_000_000; // 100 USDC default

class Chain {
  program!: anchor.Program;
  payer!: Keypair;

  async init() {
    const kpPath = process.env.KEEPER_WALLET ?? path.join(os.homedir(), ".config/solana/id.json");
    this.payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf8"))));
    const connection = new Connection(RPC, "confirmed");
    const provider = new anchor.AnchorProvider(connection, new anchor.Wallet(this.payer), { commitment: "confirmed" });
    anchor.setProvider(provider);
    const idl = JSON.parse(fs.readFileSync(path.join(__dirname, "../idl/oddschain.json"), "utf8"));
    this.program = new anchor.Program(idl, provider);
    console.log(`[chain] program ${this.program.programId.toBase58()} keeper ${this.payer.publicKey.toBase58()}`);
  }

  marketPda(fixtureId: number): [PublicKey, PublicKey] {
    const fid = new anchor.BN(fixtureId).toArrayLike(Buffer, "le", 8);
    const [market] = PublicKey.findProgramAddressSync([Buffer.from("market"), fid], this.program.programId);
    const [vault] = PublicKey.findProgramAddressSync([Buffer.from("vault"), fid], this.program.programId);
    return [market, vault];
  }

  async createMarket(fixtureId: number, title: string, probBps: number[], closeTs: number): Promise<string> {
    const [market, vault] = this.marketPda(fixtureId);
    const existing = await this.program.provider.connection.getAccountInfo(market);
    if (existing) return market.toBase58();

    const creatorUsdc = getAssociatedTokenAddressSync(USDC_MINT, this.payer.publicKey);
    const padded = [...probBps, 0, 0, 0].slice(0, 3);

    await (this.program.methods as any)
      .createMarket(new anchor.BN(fixtureId), 3, title.slice(0, 64), padded, new anchor.BN(SEED_LIQUIDITY), new anchor.BN(closeTs))
      .accounts({
        market, vault,
        usdcMint: USDC_MINT,
        creatorUsdc,
        oracle: this.payer.publicKey,
        authority: this.payer.publicKey,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    return market.toBase58();
  }

  /** All markets ever created by this program — the chain is the durable store. */
  async allMarkets(): Promise<
    { fixtureId: number; market: string; title: string; resolved: boolean; winner: number; closeTs: number }[]
  > {
    const accounts = await (this.program.account as any).market.all();
    return accounts.map((a: any) => ({
      fixtureId: Number(a.account.fixtureId),
      market: a.publicKey.toBase58(),
      title: String(a.account.title),
      resolved: Boolean(a.account.resolved),
      winner: Number(a.account.winner),
      closeTs: Number(a.account.closeTs),
    }));
  }

  async resolve(fixtureId: number, winner: number, txlineRef: number): Promise<string> {
    const [market] = this.marketPda(fixtureId);
    return (this.program.methods as any)
      .resolve(winner, new anchor.BN(txlineRef))
      .accounts({ market, oracle: this.payer.publicKey })
      .rpc();
  }
}

export const chain = new Chain();
