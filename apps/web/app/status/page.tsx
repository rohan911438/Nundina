import type { Metadata } from "next";
import { get } from "@/lib/api";

export const metadata: Metadata = {
  title: "Status",
  description: "Live health of the Nundina API, relayer, keeper, settlements and HSP payments.",
};
export const dynamic = "force-dynamic";

interface Status {
  ok: boolean;
  checkedAt: string;
  checks: { name: string; ok: boolean; detail: string }[];
}

export default async function StatusPage() {
  const s = await get<Status>("/status", undefined, 0).catch(() => null);
  return (
    <article className="mx-auto max-w-3xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
      <p className="text-xs font-medium uppercase tracking-wider text-accent">System status</p>
      <h1 className="mt-3 text-4xl font-semibold tracking-tight sm:text-5xl">
        {s == null ? "API unreachable" : s.ok ? "All systems operational" : "Degraded"}
      </h1>
      {s && <p className="mt-4 text-sm text-muted">Checked {new Date(s.checkedAt).toUTCString()}</p>}
      <ul className="mt-10 divide-y divide-border rounded-xl border border-border">
        {(s?.checks ?? []).map((c) => (
          <li key={c.name} className="flex items-start justify-between gap-4 px-4 py-3">
            <div>
              <p className="font-medium capitalize">{c.name}</p>
              <p className="mt-0.5 text-sm text-muted">{c.detail}</p>
            </div>
            <span className={`mt-1 inline-flex items-center gap-1.5 text-sm ${c.ok ? "text-win" : "text-loss"}`}>
              <span aria-hidden className={`size-2 rounded-full ${c.ok ? "bg-win" : "bg-loss"}`} />
              {c.ok ? "OK" : "Failing"}
            </span>
          </li>
        ))}
      </ul>
    </article>
  );
}
