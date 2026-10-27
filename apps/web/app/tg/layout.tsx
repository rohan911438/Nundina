import type { Metadata, Viewport } from "next";
import { Suspense, type ReactNode } from "react";
import { TgShell } from "@/components/tg/TgShell";

export const metadata: Metadata = { title: "Nundina", robots: { index: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

export default function TgLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense>
      <TgShell>{children}</TgShell>
    </Suspense>
  );
}
