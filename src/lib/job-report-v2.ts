/**
 * Typed reads of the V2 job-report JSONB payloads written by the partner
 * mobile app via `services/jobReportV2`. The legacy phase-based system
 * (table `job_reports`) is deprecated by mig 162 — all new reports live
 * inside the `jobs` row as two JSONB columns:
 *
 *   - jobs.start_report  → submitted on arrival ("before" photos + checks)
 *   - jobs.final_report  → submitted on completion ("after" photos + outcome)
 *
 * Each payload has a common envelope (template, submitted_at, photos) and
 * template-specific fields. This module provides:
 *   1. Discriminated union types per template + start/final.
 *   2. A `normalizeReport(raw)` that returns the shape callers can render
 *      without needing to know template field names.
 *   3. `REPORT_FIELD_LABELS` — humanised labels for each known key, used by
 *      both the dashboard card and the PDF template.
 */

export type ReportTemplate = "general" | "gardener" | "cleaner";
export type ReportKind = "start" | "final";

export type ReportPhotos = string[] | Record<string, string[]>;

/** Common envelope every V2 report has. */
interface ReportEnvelope {
  template: ReportTemplate;
  submitted_at: string;
  photos?: ReportPhotos;
}

/** Per-template payload shapes. Anything outside these is ignored on render. */
export interface GeneralStartData {
  recommend_additional_services?: boolean;
}
export interface GeneralFinalData {
  description?: string;
  additional_charges?: boolean;
  additional_charges_note?: string | null;
  completion_status?: string;
  what_needs_completing?: string | null;
  follow_up_required?: boolean;
  duration_ms?: number;
}
export interface GardenerStartData {
  number_of_gardeners?: number;
}
export interface GardenerFinalData {
  description?: string;
  waste_bags?: number;
  materials_charges?: boolean;
  materials_charges_note?: string | null;
  all_tasks_done?: boolean;
  next_visit_tasks?: string | null;
  seasonal_maintenance?: string | null;
  duration_ms?: number;
  chargeable_hours?: number;
}
export interface CleanerStartData {
  scope_changes?: boolean;
  scope_changes_note?: string | null;
  pre_existing_damage?: boolean;
  photos_refused?: boolean;
  recommend_additional_services?: boolean;
}
export interface CleanerFinalData {
  job_complete?: boolean;
  customer_inspected?: boolean;
  duration_ms?: number;
}

/** Output shape used by the dashboard card + PDF — already split for rendering. */
export interface NormalizedReport {
  template: ReportTemplate;
  submittedAt: Date | null;
  /** Flat array view of all photos. Cleaner room maps are flattened with the room as a label. */
  photosFlat: Array<{ url: string; label?: string }>;
  /** Original room-by-room map for cleaner; null for flat templates. */
  photosByRoom: Record<string, string[]> | null;
  /** Template-specific data fields (envelope keys removed). */
  fields: Record<string, unknown>;
  /** durationMs surfaced separately — common to all final reports. */
  durationMs: number | null;
}

const ENVELOPE_KEYS = new Set<string>(["template", "submitted_at", "photos"]);

export function normalizeReport(raw: unknown): NormalizedReport | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<ReportEnvelope> & Record<string, unknown>;

  const template = (typeof r.template === "string" ? r.template : "general") as ReportTemplate;
  const submittedAt = typeof r.submitted_at === "string" ? new Date(r.submitted_at) : null;

  // Photos can be array (general/gardener) OR room map (cleaner OR general
  // with a single 'before' bucket). Normalize both shapes for rendering.
  const photosFlat: Array<{ url: string; label?: string }> = [];
  let photosByRoom: Record<string, string[]> | null = null;

  if (Array.isArray(r.photos)) {
    for (const u of r.photos) {
      if (typeof u === "string" && u.trim()) photosFlat.push({ url: u });
    }
  } else if (r.photos && typeof r.photos === "object") {
    photosByRoom = {};
    for (const [room, urls] of Object.entries(r.photos as Record<string, unknown>)) {
      if (!Array.isArray(urls)) continue;
      const list = urls.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
      photosByRoom[room] = list;
      for (const u of list) photosFlat.push({ url: u, label: humaniseRoomKey(room) });
    }
  }

  const fields: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (ENVELOPE_KEYS.has(k)) continue;
    fields[k] = v;
  }

  const durationMs =
    typeof fields.duration_ms === "number" && Number.isFinite(fields.duration_ms)
      ? (fields.duration_ms as number)
      : null;

  return { template, submittedAt, photosFlat, photosByRoom, fields, durationMs };
}

/** Per-key human label for the dashboard + PDF. Unknown keys fall back to title-case. */
export const REPORT_FIELD_LABELS: Record<string, string> = {
  // general / shared
  recommend_additional_services: "Suggested upsells",
  description:                   "Work description",
  additional_charges:            "Additional charges",
  additional_charges_note:       "Charges note",
  completion_status:             "Completion status",
  what_needs_completing:         "What still needs completing",
  follow_up_required:            "Follow-up required",
  duration_ms:                   "Duration",
  // gardener
  number_of_gardeners:    "Number of gardeners",
  waste_bags:             "Waste bags",
  materials_charges:      "Materials charges",
  materials_charges_note: "Materials note",
  all_tasks_done:         "All tasks completed",
  next_visit_tasks:       "Next visit tasks",
  seasonal_maintenance:   "Seasonal maintenance",
  chargeable_hours:       "Chargeable hours",
  // cleaner
  scope_changes:        "Scope changes",
  scope_changes_note:   "Scope changes note",
  pre_existing_damage:  "Pre-existing damage",
  photos_refused:       "Customer refused photos",
  job_complete:         "Job complete",
  customer_inspected:   "Customer inspected",
};

export function labelForReportField(key: string): string {
  if (REPORT_FIELD_LABELS[key]) return REPORT_FIELD_LABELS[key];
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Renderable representation of a single field value (boolean → "Yes"/"No", duration → human, etc). */
export interface RenderableField {
  key: string;
  label: string;
  /** Display string, or empty when the value was null/undefined. */
  display: string;
  /** Original raw value for callers that need conditional styling. */
  raw: unknown;
}

export function renderableFields(report: NormalizedReport): RenderableField[] {
  const out: RenderableField[] = [];
  // Stable order: known keys first (in label-map order), then any leftovers.
  const knownOrder = Object.keys(REPORT_FIELD_LABELS);
  const seen = new Set<string>();

  const push = (key: string, value: unknown) => {
    if (key === "photos") return;
    seen.add(key);
    out.push({
      key,
      label: labelForReportField(key),
      display: formatFieldValue(key, value),
      raw: value,
    });
  };

  for (const k of knownOrder) {
    if (k in report.fields) push(k, report.fields[k]);
  }
  for (const [k, v] of Object.entries(report.fields)) {
    if (!seen.has(k)) push(k, v);
  }
  return out.filter((f) => f.display !== "");
}

function formatFieldValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return "";
  if (key === "duration_ms" && typeof value === "number") return formatDurationMs(value);
  if (key === "chargeable_hours" && typeof value === "number") return `${value.toFixed(2)} h`;
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return JSON.stringify(value);
}

function formatDurationMs(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return "";
  const totalMin = Math.round(ms / 60_000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function humaniseRoomKey(key: string): string {
  return key.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}
