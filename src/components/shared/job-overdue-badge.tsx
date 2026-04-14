"use client";

import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { isJobOverdue, type JobOverdueInput } from "@/lib/job-overdue";

const overdueBadgeClassName = cn(
  "!text-red-950 !bg-red-950/[0.1] !ring-red-950/35 border border-red-950/30",
  "dark:!text-red-100 dark:!bg-red-950/50 dark:!ring-red-900/45 dark:border-red-900/55",
);

export function JobOverdueBadge({
  job,
  size = "sm",
}: {
  job: JobOverdueInput;
  size?: "sm" | "md";
}) {
  if (!isJobOverdue(job)) return null;
  return (
    <Badge variant="outline" size={size} className={overdueBadgeClassName}>
      Overdue
    </Badge>
  );
}
