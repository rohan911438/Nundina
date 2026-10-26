import type { ReactNode } from "react";

/** Shared frame and palette for OG images (Satori: inline styles, flexbox only). */
export const OG = {
  size: { width: 1200, height: 630 },
  bg: "#0a0b0d",
  surface: "#121418",
  text: "#eceef2",
  muted: "#9aa1ad",
  border: "#252932",
  accent: "#a3a8ff",
  win: "#3ddc97",
  loss: "#ff6b6b",
  locked: "#f5b84a",
};

/** Cache OG images at the edge for 10 minutes, serve stale for a day while refreshing. */
export const OG_HEADERS = { "Cache-Control": "public, max-age=600, s-maxage=600, stale-while-revalidate=86400" };

export function OgFrame({ children, footer }: { children: ReactNode; footer: string }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: OG.bg,
        backgroundImage: `radial-gradient(60% 60% at 50% 0%, rgba(120,126,255,0.22), transparent 70%)`,
        color: OG.text,
        padding: 64,
        fontFamily: "sans-serif",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, fontSize: 30, fontWeight: 700 }}>
        <div style={{ width: 40, height: 40, borderRadius: 12, background: OG.text, display: "flex", alignItems: "center", justifyContent: "center" }}>
          <Check color={OG.bg} size={26} />
        </div>
        nundina
      </div>
      <div style={{ display: "flex", flex: 1, flexDirection: "column", justifyContent: "center" }}>{children}</div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 24, color: OG.muted, borderTop: `1px solid ${OG.border}`, paddingTop: 24 }}>
        <span>Verified by Nundina · HashKey Chain</span>
        <span>{footer}</span>
      </div>
    </div>
  );
}

/** A tick drawn as SVG (glyphs outside the bundled font would need a network font fetch). */
export function Check({ color, size }: { color: string; size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke={color} strokeWidth={3.2} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Result mark in a filled circle: tick (win), cross (loss) or padlock (locked). */
export function Mark({ kind, color, size }: { kind: "win" | "loss" | "locked" | "other"; color: string; size: number }) {
  const path =
    kind === "win"
      ? "M7 12.5l3.5 3.5L17 8.5"
      : kind === "loss"
        ? "M8 8l8 8M16 8l-8 8"
        : kind === "locked"
          ? "M8.5 11V9a3.5 3.5 0 0 1 7 0v2M7.5 11h9v6.5h-9z"
          : "M8 12h8";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="11" fill={color} />
      <path d={path} fill="none" stroke={OG.bg} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function OgMessage({ title }: { title: string }) {
  return (
    <OgFrame footer="nundina">
      <div style={{ fontSize: 64, fontWeight: 700 }}>{title}</div>
    </OgFrame>
  );
}
