import type { ComponentProps } from "react";
import { cn } from "@/lib/cn";

/** Sized like the content it replaces so nothing shifts when data arrives. */
export function Skeleton({ className, ...props }: ComponentProps<"div">) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-surface-2", className)} {...props} />;
}
