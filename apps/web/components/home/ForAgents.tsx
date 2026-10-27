import { ArrowUpRight } from "lucide-react";
import { config } from "@/lib/config";
import { Reveal } from "@/components/motion/Reveal";
import { SectionHead } from "./SectionHead";

export function ForAgents() {
  return (
    <Reveal as="section" id="agents" className="mx-auto max-w-6xl scroll-mt-20 px-4 py-20 sm:px-6">
      <div className="grid gap-10 overflow-hidden rounded-3xl border border-border bg-surface p-6 sm:p-10 lg:grid-cols-2 lg:items-center">
        <div>
          <SectionHead eyebrow="For agents" title="Your agent can buy signals too" />
          <p className="mt-4 max-w-md text-muted">
            Execution agents buy within budgets you sign (HSP Mandates). Aggregator agents blend signals and resell them, and when they win,
            the payout splits back to every upstream provider on-chain.
          </p>
          <a
            href={`${config.githubUrl}`}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-6 inline-flex items-center gap-1 text-sm text-accent underline-offset-4 hover:underline"
          >
            MCP tools and API reference <ArrowUpRight aria-hidden className="size-3.5" />
          </a>
        </div>
        <figure className="min-w-0">
          <figcaption className="mb-2 text-xs text-muted">Add Nundina to any MCP client</figcaption>
          <pre className="num overflow-x-auto rounded-2xl border border-border bg-bg p-5 text-[13px] leading-relaxed">
            <code>
              <span className="text-muted">$</span> claude mcp add --transport http nundina {config.publicApiUrl.replace(/\/$/, "")}/mcp{"\n\n"}
              <span className="text-muted">{"# tools\n"}</span>
              {"list_providers  get_signals  get_signal\nverify_track_record  buy_signal  get_purchase"}
            </code>
          </pre>
        </figure>
      </div>
    </Reveal>
  );
}
