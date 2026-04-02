import type { JobStatus } from "@/types/database";
import { TYPE_OF_WORK_OPTIONS } from "@/lib/type-of-work";

/** Two-letter codes for calendar chips (type of work from job title). */
export const SCHEDULE_TYPE_ABBR: Record<string, string> = {
  Painter: "PA",
  "General Maintenance": "GM",
  Plumber: "PL",
  Electrician: "EL",
  Builder: "BU",
  Carpenter: "CA",
  Cleaning: "CL",
  Gardener: "GR",
  "Boiler Service": "BS",
  EICR: "EI",
  "PAT EICR": "PC",
  "PAT Testing": "PT",
  "Gas Safety Certificate": "GS",
  "Fire Risk Assessment": "FR",
  "Fire Alarm Certificate": "FA",
  "Emergency Lighting Certificate": "LG",
  "Fire Extinguisher Service": "FE",
};

/** Bar colour follows job pipeline stage (status). */
export function scheduleJobStatusColorClasses(status: JobStatus): string {
  const map: Record<JobStatus, string> = {
    unassigned:
      "bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950/50 dark:text-amber-100 dark:border-amber-800",
    auto_assigning:
      "bg-blue-100 text-blue-950 border-blue-300 dark:bg-blue-950/50 dark:text-blue-100 dark:border-blue-800",
    scheduled:
      "bg-sky-100 text-sky-950 border-sky-300 dark:bg-sky-950/50 dark:text-sky-100 dark:border-sky-800",
    late: "bg-orange-100 text-orange-950 border-orange-300 dark:bg-orange-950/50 dark:text-orange-100 dark:border-orange-800",
    in_progress_phase1:
      "bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-emerald-800",
    in_progress_phase2:
      "bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-emerald-800",
    in_progress_phase3:
      "bg-emerald-100 text-emerald-950 border-emerald-300 dark:bg-emerald-950/50 dark:text-emerald-100 dark:border-emerald-800",
    final_check:
      "bg-amber-100 text-amber-950 border-amber-300 dark:bg-amber-950/40 dark:text-amber-100 dark:border-amber-800",
    awaiting_payment:
      "bg-violet-100 text-violet-950 border-violet-300 dark:bg-violet-950/50 dark:text-violet-100 dark:border-violet-800",
    need_attention:
      "bg-red-100 text-red-950 border-red-300 dark:bg-red-950/40 dark:text-red-100 dark:border-red-800",
    completed:
      "bg-zinc-200 text-zinc-900 border-zinc-400 dark:bg-zinc-700 dark:text-zinc-100 dark:border-zinc-600",
    cancelled:
      "bg-neutral-200 text-neutral-600 border-neutral-300 dark:bg-neutral-800 dark:text-neutral-400 dark:border-neutral-600",
  };
  return map[status] ?? map.scheduled;
}

/**
 * Best matching catalogue type from job title (e.g. "Plumber — leak" → Plumber).
 */
export function resolveScheduleJobTypeKey(title: string): string {
  const t = title.trim();
  if (!t) return "General Maintenance";
  const lower = t.toLowerCase();
  const exact = TYPE_OF_WORK_OPTIONS.find((opt) => lower === opt.toLowerCase());
  if (exact) return exact;
  const contains = TYPE_OF_WORK_OPTIONS.find((opt) => lower.includes(opt.toLowerCase()));
  if (contains) return contains;
  const firstWord = lower.split(/[\s—–-]+/)[0] ?? "";
  const fuzzy = TYPE_OF_WORK_OPTIONS.find(
    (opt) => opt.toLowerCase().startsWith(firstWord) || firstWord.startsWith(opt.toLowerCase().slice(0, 4)),
  );
  return fuzzy ?? "General Maintenance";
}

export function scheduleJobAbbrevFromTitle(title: string): string {
  const key = resolveScheduleJobTypeKey(title);
  const fromMap = SCHEDULE_TYPE_ABBR[key];
  if (fromMap) return fromMap.slice(0, 2).toUpperCase();
  const letters = title.replace(/[^a-zA-Z]/g, "");
  if (letters.length >= 2) return letters.slice(0, 2).toUpperCase();
  return `${(title.slice(0, 2) || "··").toUpperCase()}`.padEnd(2, "·");
}

/** UK outward + inward postcode; falls back to em dash if not found. */
export function extractUkPostcodeFromAddress(address: string): string {
  const m = address.trim().match(/\b([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\b/i);
  return m ? m[1].replace(/\s+/g, " ").toUpperCase() : "—";
}

/**
 * Calendar bar text: `JOB-12 · PL · Alex · SW1A 1AA`
 * — reference first, then abbr; partner = first name (or first token); postcode from property line.
 */
export function formatScheduleCalendarBarCompact(job: {
  reference: string;
  title: string;
  partner_name?: string | null;
  property_address?: string | null;
}): string {
  const ref = job.reference?.trim() || "—";
  const abbr = scheduleJobAbbrevFromTitle(job.title);
  const partner = job.partner_name?.trim()
    ? job.partner_name.trim().split(/\s+/)[0]!.slice(0, 14)
    : "—";
  const pc = extractUkPostcodeFromAddress(job.property_address ?? "");
  return `${ref} · ${abbr} · ${partner} · ${pc}`;
}
