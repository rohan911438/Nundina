import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google";
import type { ReactNode } from "react";
import { Footer } from "@/components/layout/Footer";
import { Header } from "@/components/layout/Header";
import { themeScript } from "@/components/layout/ThemeToggle";
import { config } from "@/lib/config";
import { Providers } from "./providers";
import "./globals.css";

const sans = Geist({ subsets: ["latin"], variable: "--font-geist", display: "swap" });
const mono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono", display: "swap", preload: false });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap", preload: false });

export const metadata: Metadata = {
  metadataBase: new URL(config.siteUrl),
  title: { default: "Nundina · Pay only when the call is right", template: "%s · Nundina" },
  description:
    "Trading signals committed on HashKey Chain before the move, paid through HSP into escrow, and refunded automatically when they're wrong.",
  openGraph: { siteName: "Nundina", type: "website" },
  twitter: { card: "summary_large_image" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0b0d" },
    { media: "(prefers-color-scheme: light)", color: "#f7f7f5" },
  ],
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${sans.variable} ${mono.variable} ${serif.variable}`} suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="min-h-dvh">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-50 focus:rounded-full focus:bg-text focus:px-4 focus:py-2 focus:text-bg">
          Skip to content
        </a>
        <Providers>
          <Header />
          <main id="main">{children}</main>
          <Footer />
        </Providers>
      </body>
    </html>
  );
}
