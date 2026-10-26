import { ImageResponse } from "next/og";
import { api } from "@/lib/api";
import { config } from "@/lib/config";
import { pct, r } from "@/lib/format";
import { Check, OG, OG_HEADERS, OgFrame, OgMessage } from "@/lib/og";
import { allTimeScore } from "@/lib/score";

/** Provider badge: handle, score, n, Wilson lower bound, short URL. 1200×630, cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ handle: string }> }) {
  const { handle } = await params;
  const p = await api.provider(decodeURIComponent(handle)).catch(() => null);
  if (!p) return new ImageResponse(<OgMessage title="Provider not found" />, { ...OG.size, headers: OG_HEADERS, status: 404 });

  const s = allTimeScore(p);
  const host = config.siteUrl.replace(/^https?:\/\//, "").replace(/\/$/, "");
  const stats: [string, string, string?][] = [
    ["Score", s.score == null ? "—" : s.score.toFixed(0)],
    ["Signals", String(s.n)],
    ["Win rate LB", pct(s.wilsonLb, { dp: 0 })],
    ["Expectancy", r(s.expectancyR), s.expectancyR >= 0 ? OG.win : OG.loss],
  ];

  return new ImageResponse(
    (
      <OgFrame footer={`${host}/p/${p.handle}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div style={{ fontSize: 68, fontWeight: 700, letterSpacing: -2 }}>{p.displayName}</div>
          {p.verified ? (
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 24, color: OG.accent, border: `2px solid ${OG.accent}`, borderRadius: 999, padding: "6px 16px" }}>
              <Check color={OG.accent} size={22} /> Verified
            </div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 30, color: OG.muted, marginTop: 8 }}>{`@${p.handle}${s.probation ? " · on probation" : ""}`}</div>
        <div style={{ display: "flex", gap: 20, marginTop: 48 }}>
          {stats.map(([k, v, color]) => (
            <div
              key={k}
              style={{ display: "flex", flexDirection: "column", flex: 1, background: OG.surface, border: `1px solid ${OG.border}`, borderRadius: 24, padding: "24px 28px" }}
            >
              <span style={{ fontSize: 22, color: OG.muted }}>{k}</span>
              <span style={{ fontSize: 60, fontWeight: 700, color: color ?? OG.text, marginTop: 6 }}>{v}</span>
            </div>
          ))}
        </div>
      </OgFrame>
    ),
    { ...OG.size, headers: OG_HEADERS },
  );
}
