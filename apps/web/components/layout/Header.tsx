import Link from "next/link";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/#how", label: "How it works" },
  { href: "/#agents", label: "For agents" },
];

export function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-border/60 bg-bg/95 md:bg-bg/75 md:backdrop-blur-xl md:supports-[backdrop-filter]:bg-bg/60">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Nundina home" className="shrink-0">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm text-muted md:flex">
          {NAV.map((n) => (
            <Link key={n.href} href={n.href} className="rounded-full px-3 py-1.5 transition-colors hover:bg-surface-2 hover:text-text">
              {n.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <Link href="/leaderboard" className="rounded-full px-3 py-1.5 text-sm text-muted hover:text-text md:hidden">
            Leaderboard
          </Link>
          <ThemeToggle />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/start">Get started</Link>
          </Button>
        </div>
      </div>
    </header>
  );
}
