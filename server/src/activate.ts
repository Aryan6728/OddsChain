import * as anchor from "@coral-xyz/anchor";
import { Connection, PublicKey, SystemProgram, Keypair, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
} from "@solana/spl-token";
import axios from "axios";
import nacl from "tweetnacl";
import fs from "fs";
import os from "os";
import path from "path";

const NETWORK = (process.env.NETWORK ?? "devnet") as "mainnet" | "devnet";

const CONFIG = {
  mainnet: {
    rpcUrl: process.env.MAINNET_RPC ?? "https://api.mainnet-beta.solana.com",
    apiOrigin: "https://txline.txodds.com",
    programId: new PublicKey("9ExbZjAapQww1vfcisDmrngPinHTEfpjYRWMunJgcKaA"),
    txlMint: new PublicKey("Zhw9TVKp68a1QrftncMSd6ELXKDtpVMNuMGr1jNwdeL"),
    idl: "../idl/txoracle-mainnet.json",
  },
  devnet: {
    rpcUrl: process.env.RPC_URL ?? "https://api.devnet.solana.com",
    apiOrigin: "https://txline-dev.txodds.com",
    programId: new PublicKey("6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J"),
    txlMint: new PublicKey("4Zao8ocPhmMgq7PdsYWyxvqySMGx7xb9cMftPMkEokRG"),
    idl: "../idl/txoracle.json",
  },
} as const;

const C = CONFIG[NETWORK];
const SERVICE_LEVEL_ID = Number(process.env.TXLINE_SERVICE_LEVEL ?? 1);
const DURATION_WEEKS = 4;
const SELECTED_LEAGUES: number[] = [];

async function main() {
  console.log(`Network: ${NETWORK} | Service level: ${SERVICE_LEVEL_ID}`);
  const kpPath = process.env.ANCHOR_WALLET ?? path.join(os.homedir(), ".config/solana/id.json");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(kpPath, "utf8"))));
  const connection = new Connection(C.rpcUrl, "confirmed");

  const bal = await connection.getBalance(payer.publicKey);
  console.log(`Wallet ${payer.publicKey.toBase58()} balance: ${bal / 1e9} SOL on ${NETWORK}`);
  if (bal < 5000000) {
    console.error(`Not enough SOL on ${NETWORK}. Need ~0.005+ SOL for fees/rent.`);
    process.exit(1);
  }

  const wallet = new anchor.Wallet(payer);
  const provider = new anchor.AnchorProvider(connection, wallet, { commitment: "confirmed" });
  anchor.setProvider(provider);

  const idl = JSON.parse(fs.readFileSync(path.join(__dirname, C.idl), "utf8"));
  const program = new anchor.Program(idl, provider);
  if (!program.programId.equals(C.programId)) {
    throw new Error(`IDL program mismatch for ${NETWORK}`);
  }

  const [tokenTreasuryPda] = PublicKey.findProgramAddressSync([Buffer.from("token_treasury_v2")], C.programId);
  const [pricingMatrixPda] = PublicKey.findProgramAddressSync([Buffer.from("pricing_matrix")], C.programId);
  const tokenTreasuryVault = getAssociatedTokenAddressSync(C.txlMint, tokenTreasuryPda, true, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);
  const userTokenAccount = getAssociatedTokenAddressSync(C.txlMint, payer.publicKey, false, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID);

  const ataIx = createAssociatedTokenAccountIdempotentInstruction(
    payer.publicKey, userTokenAccount, payer.publicKey,
    C.txlMint, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID,
  );
  await sendAndConfirmTransaction(connection, new Transaction().add(ataIx), [payer]);
  console.log("TxL token account ready:", userTokenAccount.toBase58());

  console.log("Subscribing on-chain...");
  const txSig = await (program.methods as any)
    .subscribe(SERVICE_LEVEL_ID, DURATION_WEEKS)
    .accounts({
      user: payer.publicKey,
      pricingMatrix: pricingMatrixPda,
      tokenMint: C.txlMint,
      userTokenAccount,
      tokenTreasuryVault,
      tokenTreasuryPda,
      tokenProgram: TOKEN_2022_PROGRAM_ID,
      associatedTokenProgram: ASSOCIATED_TOKEN_PROGRAM_ID,
      systemProgram: SystemProgram.programId,
    })
    .rpc();
  console.log("subscribe tx:", txSig);

  const auth = await axios.post(`${C.apiOrigin}/auth/guest/start`);
  const jwt = auth.data.token;

  const message = new TextEncoder().encode(`${txSig}:${SELECTED_LEAGUES.join(",")}:${jwt}`);
  const sig = nacl.sign.detached(message, payer.secretKey);
  const walletSignature = Buffer.from(sig).toString("base64");

  const activation = await axios.post(
    `${C.apiOrigin}/api/token/activate`,
    { txSig, walletSignature, leagues: SELECTED_LEAGUES },
    { headers: { Authorization: `Bearer ${jwt}` } },
  );
  const apiToken = activation.data.token ?? activation.data;
  console.log("");
  console.log("TXLINE_API_TOKEN=" + apiToken);
  console.log("TXLINE_ORIGIN=" + C.apiOrigin);
  console.log("");
  console.log("Put BOTH lines in server/.env");
}

main().catch((e) => { console.error(e?.response?.data ?? e); process.exit(1); });
