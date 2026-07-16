import type { Metadata } from "next";
import "./globals.css";
import { Providers } from "@/components/Providers";
import { Header } from "@/components/Header";

export const metadata: Metadata = {
  title: "TxMarket — World Cup Prediction Markets",
  description: "Trade World Cup outcomes with live TxLINE consensus odds, settled on Solana devnet.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-panel text-ink antialiased">
        <Providers>
          <Header />
          <main className="mx-auto max-w-6xl px-4 pb-24">{children}</main>
        </Providers>
      </body>
    </html>
  );
}
