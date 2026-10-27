"use client";

import { RotateCw } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";

/** Route-level error boundary: say what happened, offer a retry, never show a stack trace. */
export default function Error({ error, retry }: { error: unknown; retry: () => void }) {
  const [retrying, setRetrying] = useState(false);
  useEffect(() => console.error(error), [error]);
  const digest = (error as { digest?: string } | null)?.digest;
  const offline = typeof navigator !== "undefined" && !navigator.onLine;

  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-32 text-center" role="alert">
      <p className="rise num rounded-full border border-loss/30 bg-loss/[0.06] px-3 py-1 text-xs text-loss">{offline ? "offline" : "error"}</p>
      <h1 className="rise mt-5 text-3xl font-semibold tracking-tight [animation-delay:80ms]">
        {offline ? "You're offline" : "This page didn't load"}
      </h1>
      <p className="rise mt-3 text-muted [animation-delay:160ms]">
        {offline
          ? "Reconnect and try again. Nothing on-chain was affected."
          : "Something went wrong on our side. Your funds and purchases are safe on-chain; try again in a moment."}
      </p>
      <div className="rise mt-8 flex flex-wrap justify-center gap-3 [animation-delay:240ms]">
        <Button
          variant="accent"
          onClick={() => {
            setRetrying(true);
            retry();
            setTimeout(() => setRetrying(false), 1500);
          }}
        >
          <RotateCw aria-hidden className={retrying ? "animate-spin" : undefined} />
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
      {digest ? <p className="num mt-6 text-xs text-muted">ref {digest}</p> : null}
    </div>
  );
}
