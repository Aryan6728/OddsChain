"use client";
import Link from "next/link";
import dynamic from "next/dynamic";
import { usePathname, useRouter } from "next/navigation";
import { useState } from "react";

const WalletButton = dynamic(
  () => import("@solana/wallet-adapter-react-ui").then((m) => m.WalletMultiButton),
  { ssr: false },
);

function SearchIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" />
    </svg>
  );
}

export function Header() {
  const pathname = usePathname();
  const router = useRouter();
  const [q, setQ] = useState("");

  const onMarkets = pathname === "/" || pathname.startsWith("/market");

  return (
    <header className="sticky top-0 z-20 border-b border-edge bg-panel/95 backdrop-blur">
      <div className="mx-auto max-w-6xl px-4">
        {/* top row: logo · search · wallet */}
        <div className="flex items-center gap-4 py-3">
          <Link href="/" className="flex shrink-0 items-center gap-2 text-lg font-bold text-ink">
            <span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-sm font-bold text-white">OC</span>
            OddsChain
          </Link>

          <form
            className="relative hidden max-w-md flex-1 md:block"
            onSubmit={(e) => { e.preventDefault(); router.push(q ? `/?q=${encodeURIComponent(q)}` : "/"); }}
          >
            <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint"><SearchIcon /></span>
            <input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search markets..."
              className="w-full rounded-xl border border-edge bg-soft py-2 pl-9 pr-3 text-sm text-ink outline-none transition placeholder:text-faint focus:border-accent focus:bg-panel"
            />
          </form>

          <div className="ml-auto flex shrink-0 items-center gap-3">
            <span className="hidden items-center gap-1.5 text-sm font-medium text-accent lg:flex">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm1 15h-2v-6h2v6Zm0-8h-2V7h2v2Z"/></svg>
              How it works
            </span>
            <WalletButton />
          </div>
        </div>

        {/* nav row: category tabs */}
        <nav className="flex items-center gap-6 overflow-x-auto">
          <Link href="/" className="nav-tab">
            <span>📈</span> Trending
          </Link>
          <Link href="/" className={`nav-tab ${onMarkets ? "nav-tab-active" : ""}`}>
            <span>🏆</span> World Cup
          </Link>
          <Link href="/schedule" className={`nav-tab ${pathname === "/schedule" ? "nav-tab-active" : ""}`}>
            <span>📅</span> Schedule
          </Link>
          <Link href="/portfolio" className={`nav-tab ${pathname === "/portfolio" ? "nav-tab-active" : ""}`}>
            Portfolio
          </Link>
          <span className="nav-tab ml-auto hidden shrink-0 cursor-default sm:flex">
            Devnet · live odds by TxLINE
          </span>
        </nav>
      </div>
    </header>
  );
}
