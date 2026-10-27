"use client";

import { Menu, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand/Logo";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { ThemeToggle } from "./ThemeToggle";

const NAV = [
  { href: "/leaderboard", label: "Leaderboard" },
  { href: "/#how", label: "How it works" },
  { href: "/#agents", label: "For agents" },
  { href: "/dashboard", label: "My signals" },
];

export function Header() {
  const path = usePathname();
  const [scrolled, setScrolled] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const on = () => setScrolled(window.scrollY > 8);
    on();
    window.addEventListener("scroll", on, { passive: true });
    return () => window.removeEventListener("scroll", on);
  }, []);
  // close the menu when navigating or pressing Escape
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open]);

  const active = (href: string) => !href.includes("#") && (path === href || path.startsWith(`${href}/`));

  return (
    <header
      className={cn(
        "sticky top-0 z-40 border-b transition-[background-color,border-color,box-shadow] duration-300",
        scrolled || open
          ? "border-border/70 bg-bg/90 shadow-[0_10px_30px_-20px_rgb(0_0_0/0.35)] backdrop-blur-xl supports-[backdrop-filter]:bg-bg/70"
          : "border-transparent bg-bg/0",
      )}
    >
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-6 px-4 sm:px-6">
        <Link href="/" aria-label="Nundina home" className="shrink-0 transition-opacity hover:opacity-80">
          <Logo />
        </Link>
        <nav aria-label="Main" className="hidden items-center gap-1 text-sm text-muted md:flex">
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={cn("relative rounded-full px-3 py-1.5 transition-colors hover:bg-surface-2 hover:text-text", active(n.href) && "text-text")}
            >
              {n.label}
              <span
                aria-hidden
                className={cn("absolute inset-x-3 -bottom-[13px] h-px origin-center bg-accent transition-transform duration-300", active(n.href) ? "scale-x-100" : "scale-x-0")}
              />
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Button asChild size="sm" className="hidden sm:inline-flex">
            <Link href="/start">Get started</Link>
          </Button>
          <button
            type="button"
            onClick={() => setOpen((o) => !o)}
            aria-expanded={open}
            aria-controls="mobile-nav"
            aria-label={open ? "Close menu" : "Open menu"}
            className="grid size-9 place-items-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-text md:hidden"
          >
            <span className="relative size-5">
              <Menu aria-hidden className={cn("absolute inset-0 size-5 transition-all duration-300", open ? "rotate-90 scale-50 opacity-0" : "opacity-100")} />
              <X aria-hidden className={cn("absolute inset-0 size-5 transition-all duration-300", open ? "opacity-100" : "-rotate-90 scale-50 opacity-0")} />
            </span>
          </button>
        </div>
      </div>

      {/* mobile menu: grid-rows trick animates height without measuring */}
      <div
        id="mobile-nav"
        className={cn("grid transition-[grid-template-rows] duration-300 ease-out md:hidden", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}
        inert={!open}
      >
        <nav aria-label="Mobile" className="overflow-hidden">
          <ul className="space-y-1 px-4 pb-4 pt-1">
            {NAV.map((n, i) => (
              <li
                key={n.href}
                className={cn("transition-all duration-300", open ? "translate-y-0 opacity-100" : "-translate-y-2 opacity-0")}
                style={{ transitionDelay: open ? `${60 + i * 45}ms` : "0ms" }}
              >
                <Link
                  href={n.href}
                  onClick={() => setOpen(false)}
                  aria-current={active(n.href) ? "page" : undefined}
                  className={cn("block rounded-xl px-3 py-2.5 text-base transition-colors hover:bg-surface-2", active(n.href) ? "bg-surface-2 text-text" : "text-muted")}
                >
                  {n.label}
                </Link>
              </li>
            ))}
            <li className={cn("pt-2 transition-all duration-300", open ? "opacity-100" : "opacity-0")} style={{ transitionDelay: open ? "240ms" : "0ms" }}>
              <Button asChild className="w-full">
                <Link href="/start" onClick={() => setOpen(false)}>
                  Get started
                </Link>
              </Button>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}
