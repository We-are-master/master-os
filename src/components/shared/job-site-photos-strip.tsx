"use client";

import { cn } from "@/lib/utils";
import { coerceJobImagesArray } from "@/lib/job-images";
import type { Job } from "@/types/database";
import { ImageIcon } from "lucide-react";

export function jobSitePhotoUrls(job: Job): string[] {
  return coerceJobImagesArray(job.images);
}

/** Compact thumbnails for list / kanban; opens full image in new tab. */
export function JobSitePhotosStrip({
  urls,
  className,
  max = 4,
  size = "sm",
}: {
  urls: string[];
  className?: string;
  max?: number;
  size?: "sm" | "md";
}) {
  const list = urls.filter(Boolean).slice(0, max);
  const extra = urls.filter(Boolean).length - list.length;
  if (list.length === 0) return null;
  const wh = size === "sm" ? "h-6 w-6 sm:h-7 sm:w-7" : "h-10 w-10 sm:h-11 sm:w-11";
  return (
    <div className={cn("flex flex-wrap items-center gap-1 min-w-0", className)}>
      <ImageIcon className="h-3.5 w-3.5 text-text-tertiary shrink-0" aria-hidden />
      {list.map((url, i) => (
        <a
          key={`${url.slice(-40)}-${i}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="shrink-0 rounded-md border border-border-light overflow-hidden bg-surface-hover ring-1 ring-black/5"
          title="Open photo"
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className={cn(wh, "object-cover")} />
        </a>
      ))}
      {extra > 0 ? <span className="text-[10px] font-semibold text-text-tertiary tabular-nums">+{extra}</span> : null}
    </div>
  );
}
