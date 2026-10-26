import { ImageResponse } from "next/og";
import { api } from "@/lib/api";
import { hhmm, r } from "@/lib/format";
import { Mark, OG, OG_HEADERS, OgFrame, OgMessage } from "@/lib/og";
import { signalState, STATE_LABEL } from "@/lib/signal-state";

/** Graded signal card: win/loss mark, market, side, R, "committed before the move at HH:MM". 1200×630, cached. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const s = /^\d+$/.test(id) ? await api.signal(id).catch(() => null) : null;
  if (!s) return new ImageResponse(<OgMessage title="Signal not found" />, { ...OG.size, headers: OG_HEADERS, status: 404 });

  const st = signalState(s);
  const win = st === "win";
  const lost = st === "loss" || st === "unrevealed";
  const color = win ? OG.win : lost ? OG.loss : st === "locked" ? OG.locked : OG.muted;
  const mark = win ? "win" : lost ? "loss" : st === "locked" ? "locked" : "other";

  return new ImageResponse(
    (
      <OgFrame footer={s.provider ? `@${s.provider.handle}` : `signal #${s.id}`}>
        <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
          <Mark kind={mark} color={color} size={104} />
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ display: "flex", gap: 20, fontSize: 80, fontWeight: 700, letterSpacing: -2 }}>
              <span>{s.market}</span>
              {s.side ? <span style={{ color: s.side === "LONG" ? OG.win : OG.loss }}>{s.side}</span> : null}
            </div>
            <div style={{ fontSize: 34, color: OG.muted }}>{STATE_LABEL[st]}</div>
          </div>
          {s.rMultiple != null && st !== "locked" ? (
            <div style={{ marginLeft: "auto", fontSize: 92, fontWeight: 700, color }}>{r(s.rMultiple)}</div>
          ) : null}
        </div>
        <div style={{ display: "flex", fontSize: 36, marginTop: 44, color: OG.text }}>{`Committed before the move at ${hhmm(s.committedAt)}`}</div>
      </OgFrame>
    ),
    { ...OG.size, headers: OG_HEADERS },
  );
}
