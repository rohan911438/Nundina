import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <div className="mx-auto flex max-w-xl flex-col items-center px-4 py-32 text-center">
      <p className="num text-sm text-muted">404</p>
      <h1 className="mt-3 text-3xl font-semibold tracking-tight">Nothing committed here</h1>
      <p className="mt-3 text-muted">This page, provider or signal doesn&apos;t exist.</p>
      <Button asChild className="mt-8">
        <Link href="/leaderboard">Go to the leaderboard</Link>
      </Button>
    </div>
  );
}
