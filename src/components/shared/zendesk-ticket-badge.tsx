"use client";

import type { Job } from "@/types/database";

/**
 * Inline pill that surfaces the Zendesk ticket id on a job/quote when
 * `external_source = "zendesk"`. Hidden for jobs that didn't originate
 * from Zendesk (e.g. portal, manual creation).
 */
export function ZendeskTicketBadge({
  source,
  ref,
  size = "sm",
}: {
  source: Job["external_source"];
  ref: Job["external_ref"];
  size?: "xs" | "sm";
}) {
  if (source !== "zendesk" || !ref) return null;
  const padding = size === "xs" ? "px-1 py-0.5" : "px-1.5 py-0.5";
  const fontSize = size === "xs" ? "text-[9px]" : "text-[10px]";
  return (
    <span
      title={`Zendesk ticket #${ref}`}
      className={`inline-flex items-center gap-1 font-mono font-semibold text-blue-700 bg-blue-50 dark:bg-blue-950/30 dark:text-blue-300 ${padding} ${fontSize} rounded`}
    >
      <span aria-hidden="true">🎫</span>#{ref}
    </span>
  );
}
