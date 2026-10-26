import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      <div className="flex items-start gap-4">
        <Skeleton className="size-14 rounded-full" />
        <div className="flex-1">
          <Skeleton className="h-10 w-64" />
          <Skeleton className="mt-2 h-5 w-40" />
        </div>
      </div>
      <Skeleton className="mt-10 h-48 rounded-2xl" />
      <div className="mt-4 grid gap-4 lg:grid-cols-[1.6fr_1fr]">
        <Skeleton className="h-72 rounded-2xl" />
        <Skeleton className="h-72 rounded-2xl" />
      </div>
    </div>
  );
}
