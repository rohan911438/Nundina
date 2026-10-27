"use client";

import { SubscriberDashboard } from "@/components/dashboard/SubscriberDashboard";

export default function TgMy() {
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">My signals</h1>
      <SubscriberDashboard compact />
    </div>
  );
}
