import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-12 sm:px-6 sm:pt-16">
      <Skeleton className="h-12 w-64" />
      <Skeleton className="mt-4 h-5 w-full max-w-xl" />
      <Skeleton className="mt-8 h-9 w-full max-w-3xl rounded-full" />
      <div className="mt-6 rounded-2xl border border-border bg-surface">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-border/60 px-5 py-3 last:border-0">
            <Skeleton className="size-8 rounded-full" />
            <Skeleton className="h-4 w-40" />
            <Skeleton className="ml-auto h-4 w-1/2" />
          </div>
        ))}
      </div>
    </div>
  );
}
