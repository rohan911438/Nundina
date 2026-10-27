import Link from "next/link";
import { HashScramble } from "@/components/motion/HashScramble";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-32 text-center">
      <p className="rise num rounded-full border border-border bg-surface px-3 py-1 text-xs text-muted">
        404 · <HashScramble final="0x0000…0000" />
      </p>
      <h1 className="rise mt-5 text-3xl font-semibold tracking-tight [animation-delay:80ms]">Nothing committed here</h1>
      <p className="rise mt-3 text-muted [animation-delay:160ms]">This page, provider or signal doesn&apos;t exist. Signal links look like /s/42.</p>
      <div className="rise mt-8 flex flex-wrap justify-center gap-3 [animation-delay:240ms]">
        <Button asChild variant="accent">
          <Link href="/leaderboard">Go to the leaderboard</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/dashboard">My signals</Link>
        </Button>
      </div>
    </div>
  );
}
