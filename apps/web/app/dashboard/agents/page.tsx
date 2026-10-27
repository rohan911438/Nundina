import type { Metadata } from "next";
import { AgentsDashboard } from "@/components/dashboard/AgentsDashboard";

export const metadata: Metadata = { title: "Agents", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Agents</h1>
      <p className="mt-1 text-muted">An execution agent buys signals for you, within limits you set.</p>
      <div className="mt-8">
        <AgentsDashboard />
      </div>
    </div>
  );
}
