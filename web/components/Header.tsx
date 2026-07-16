"use client";
import Link from "next/link";
import dynamic from "next/dynamic";

const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

export function Header() {
  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-ink/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl items-center gap-6 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-bold text-white">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-accent text-sm">Tx</span>
          TxMarket
        </Link>
        <nav className="flex gap-4 text-sm text-slate-400">
          <Link href="/" className="hover:text-white">Markets</Link>
          <Link href="/portfolio" className="hover:text-white">Portfolio</Link>
        </nav>
        <div className="ml-auto flex items-center gap-3">
          <span className="hidden rounded-full border border-edge px-2.5 py-1 text-xs text-slate-400 sm:block">
            Devnet · live odds by TxLINE
          </span>
          <WalletButton />
        </div>
      </div>
    </header>
  );
}
