import type { Metadata } from "next";
import { SubscriberDashboard } from "@/components/dashboard/SubscriberDashboard";

export const metadata: Metadata = { title: "Your signals", robots: { index: false } };

export default function Page() {
  return (
    <div className="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-semibold tracking-tight">Your signals</h1>
      <p className="mt-1 text-muted">Purchases decrypt on this device. Wrong calls refund automatically.</p>
      <div className="mt-8">
        <SubscriberDashboard />
      </div>
    </div>
  );
}
