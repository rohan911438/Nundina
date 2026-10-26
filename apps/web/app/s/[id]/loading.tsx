import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div className="mx-auto max-w-6xl px-4 pb-10 pt-10 sm:px-6 sm:pt-14">
      <Skeleton className="h-4 w-48" />
      <Skeleton className="mt-4 h-12 w-72" />
      <Skeleton className="mt-3 h-5 w-80" />
      <Skeleton className="mt-6 h-20 w-full rounded-2xl" />
      <div className="mt-6 grid gap-4 lg:grid-cols-[1fr_22rem]">
        <Skeleton className="h-[30rem] rounded-2xl" />
        <Skeleton className="h-[30rem] rounded-2xl" />
      </div>
    </div>
  );
}
