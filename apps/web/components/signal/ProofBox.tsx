import type { ApiSignalDetail } from "@nundina/shared";
import { ExternalLink } from "@/components/ui/external";
import { explorer, short, utc } from "@/lib/format";

type Row = { label: string; value: string | null; href?: string | null; full?: string; pending?: string };

/** Every on-chain fact behind a signal, each with its explorer link. */
export function ProofBox({ s, chainId }: { s: Pick<ApiSignalDetail, "tx" | "committedAt" | "commitHash" | "settlement" | "paymentIds" | "status">; chainId?: number }) {
  const tx = (h: string | null | undefined) => (h ? explorer.tx(h, chainId) : null);
  const rows: Row[] = [
    { label: "Commit tx", value: s.tx.commit, href: tx(s.tx.commit) },
    { label: "Committed at", value: utc(s.committedAt) },
    { label: "Commit hash", value: s.commitHash, full: s.commitHash },
    {
      label: "Reveal tx",
      value: s.tx.reveal,
      href: tx(s.tx.reveal),
      pending: s.status === "UNREVEALED_LOSS" ? "never revealed" : "after expiry",
    },
    { label: "Oracle proof tx", value: s.settlement?.proofTx ?? s.tx.resolve, href: tx(s.settlement?.proofTx ?? s.tx.resolve), pending: "on touch or expiry" },
    { label: "Settlement tx", value: s.settlement?.settleTx ?? null, href: tx(s.settlement?.settleTx), pending: "after the challenge window" },
  ];
  return (
    <div>
      <dl className="divide-y divide-border text-sm" data-testid="proof-box">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-4 py-2.5">
            <dt className="shrink-0 text-muted">{r.label}</dt>
            <dd className="min-w-0 truncate text-right" title={r.full ?? r.value ?? undefined}>
              {r.value == null ? (
                <span className="text-xs text-muted">{r.pending ?? "—"}</span>
              ) : r.href ? (
                <ExternalLink href={r.href} label={`${r.label} on explorer`}>
                  {short(r.value, 8, 6)}
                </ExternalLink>
              ) : (
                <span className="num">{r.label === "Commit hash" ? short(r.value, 10, 8) : r.value}</span>
              )}
            </dd>
          </div>
        ))}
        <div className="py-2.5">
          <dt className="text-muted">HSP payments</dt>
          <dd className="mt-2 flex flex-wrap gap-1.5">
            {s.paymentIds.length ? (
              s.paymentIds.map((id) => (
                <span key={id} className="rounded-md border border-border bg-surface-2 px-2 py-0.5 text-xs">
                  <ExternalLink href={explorer.hsp(id)} label={`HSP payment ${id}`}>
                    {short(id, 10, 4)}
                  </ExternalLink>
                </span>
              ))
            ) : (
              <span className="text-xs text-muted">No paid purchases yet</span>
            )}
          </dd>
        </div>
      </dl>
    </div>
  );
}
