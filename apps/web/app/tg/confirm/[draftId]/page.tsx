"use client";

import { useParams } from "next/navigation";
import { useState } from "react";
import { ConfirmSignal } from "@/components/flows/ConfirmSignal";
import { haptic, useMainButton, useTelegram } from "@/lib/telegram";

export default function TgConfirm() {
  const { draftId } = useParams<{ draftId: string }>();
  const tg = useTelegram();
  const [done, setDone] = useState(false);
  useMainButton(done ? "Close" : null, tg.close);
  return (
    <div className="mx-auto max-w-md space-y-4">
      <h1 className="text-xl font-semibold">Confirm your signal</h1>
      <ConfirmSignal draftId={draftId} onCommitted={() => (haptic.success(), setDone(true))} />
    </div>
  );
}
