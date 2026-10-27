import type { Metadata } from "next";
import { ProviderDashboard } from "@/components/dashboard/ProviderDashboard";

export const metadata: Metadata = { title: "Provider dashboard", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <ProviderDashboard />
    </div>
  );
}
