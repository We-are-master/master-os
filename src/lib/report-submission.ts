/**
 * Shared persistence for V2 job reports, whatever door they came through.
 *
 * Two doors write the same two JSONB columns:
 *   - the public partner link (`/api/quotes/submit-report`), token-authenticated;
 *   - the office modal (`/api/jobs/[id]/office-report`), for the partner who
 *     never opens the app — the case behind 198 completed jobs producing only
 *     16 reports.
 *
 * Both land in the partner-app V2 shape, so the dashboard card, the PDF and
 * Stefane read them without knowing who typed them. `source` rides in the
 * envelope (see ENVELOPE_KEYS in job-report-v2), never in `fields`, so it stays
 * out of the client-facing PDF.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportTemplate } from "@/lib/public-report-templates";

const BUCKET = "job-reports";
const LONDON = "Europe/London";

export const VALID_REPORT_TEMPLATES = new Set<string>([
  "general",
  "gardener",
  "cleaner",
  "certificate",
]);

export function isReportTemplate(value: string): value is ReportTemplate {
  return VALID_REPORT_TEMPLATES.has(value);
}

/** Who typed the report. Office fills are the ones the partner never sent. */
export type ReportSource = "partner_link" | "office_manual";

export interface ReportSubmissionJob {
  id: string;
  reference?: string | null;
  status?: string | null;
  partner_timer_started_at?: string | null;
  partner_timer_ended_at?: string | null;
}

export interface ReportSubmissionInput {
  template: ReportTemplate;
  source: ReportSource;
  startData: Record<string, unknown>;
  finalData: Record<string, unknown>;
  /** Files grouped by slot, as parsed from the multipart body. */
  photos: Record<string, File[]>;
  /**
   * False keeps an already-submitted start report untouched — the office fills
   * only the final half when the partner did start on the app.
   */
  writeStart: boolean;
  /** Explicit on-site window (office modal types real clock times). */
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
  /** Profile id of the office user, for the audit trail. */
  filledBy?: string | null;
  /**
   * Edit mode: photos already on the report are kept and new uploads appended;
   * the typed clock times beat a timer that a previous fill derived.
   */
  overwrite?: boolean;
  /** Photos of the report being replaced (envelope `photos`), kept on edit. */
  existingStartPhotos?: unknown;
  existingFinalPhotos?: unknown;
  /**
   * False leaves `jobs.status` alone. Editing a report on a job that already
   * moved past final_check must not drag it back into the pipeline.
   */
  moveToFinalCheck?: boolean;
}

// ─── Photo slots ─────────────────────────────────────────────────────────────

const CLEANER_ROOMS = [
  "living_room",
  "hallways",
  "kitchen",
  "bathrooms",
  "bedrooms",
  "steam_cleaning",
];

/**
 * Slots accepted for a template/kind. `null` means the template stores a flat
 * array under a single slot (`before` / `after`) instead of a room map.
 */
export function slotsForKind(
  template: ReportTemplate,
  kind: "start" | "final",
): Set<string> | null {
  if (template === "cleaner") {
    return kind === "start"
      ? new Set(["equipment", ...CLEANER_ROOMS])
      : new Set(CLEANER_ROOMS);
  }
  if (template === "certificate") {
    return kind === "start" ? new Set<string>() : new Set(["certificate"]);
  }
  return null;
}

/** `photos[<slot>][]` → `{ slot: File[] }`. Ignores every other form field. */
export function parseReportPhotoEntries(form: FormData): Record<string, File[]> {
  const out: Record<string, File[]> = {};
  for (const [key, value] of form.entries()) {
    const m = key.match(/^photos\[([^\]]+)\]\[\]$/);
    if (!m || !(value instanceof File)) continue;
    const slot = m[1];
    if (!out[slot]) out[slot] = [];
    out[slot].push(value);
  }
  return out;
}

// ─── Payload shape ───────────────────────────────────────────────────────────

export interface BuiltReportPayload {
  template: ReportTemplate;
  submitted_at: string;
  source: ReportSource;
  photos: string[] | Record<string, string[]>;
  [key: string]: unknown;
}

export function buildReportPayload(input: {
  template: ReportTemplate;
  source: ReportSource;
  submittedAt: string;
  photos: string[] | Record<string, string[]>;
  data: Record<string, unknown>;
}): BuiltReportPayload {
  return {
    template: input.template,
    submitted_at: input.submittedAt,
    source: input.source,
    photos: input.photos,
    ...input.data,
  };
}

// ─── On-site window ──────────────────────────────────────────────────────────

/**
 * Stefane sends Housekeep a start time and a finish time, read straight from
 * `partner_timer_*`. A report typed by hand has no running timer, so we derive
 * the window: explicit clock times when the office gave them, otherwise the
 * duration counted backwards from submission. A real timer already on the job
 * always wins — it is the only one measured rather than remembered.
 */
export function deriveTimerWindow(input: {
  existingStartedAt?: string | null;
  existingEndedAt?: string | null;
  explicitStartedAt?: string | null;
  explicitEndedAt?: string | null;
  durationMs?: number | null;
  now: string;
  /**
   * Edit mode: the "existing" timer was derived by a previous manual fill, not
   * measured by the app, so freshly typed clock times take precedence.
   */
  preferExplicit?: boolean;
}): { startedAt: string | null; endedAt: string } {
  // Same precedence on both ends: measured beats remembered beats assumed —
  // inverted when editing, where the typed correction is the point.
  const endedAt = input.preferExplicit
    ? input.explicitEndedAt ?? input.existingEndedAt ?? input.now
    : input.existingEndedAt ?? input.explicitEndedAt ?? input.now;

  const first = input.preferExplicit ? input.explicitStartedAt : input.existingStartedAt;
  const second = input.preferExplicit ? input.existingStartedAt : input.explicitStartedAt;
  if (first) return { startedAt: first, endedAt };
  if (second) return { startedAt: second, endedAt };
  const ms = input.durationMs ?? 0;
  if (ms > 0) {
    const end = new Date(endedAt).getTime();
    if (Number.isFinite(end)) {
      return { startedAt: new Date(end - ms).toISOString(), endedAt };
    }
  }
  return { startedAt: null, endedAt };
}

/**
 * `2026-08-13` + `09:30` in London wall clock → UTC ISO.
 *
 * The office types the time it reads off a message from the partner, which is
 * London time; the column is UTC, and BST costs an hour if you skip this.
 */
export function londonWallClockToUtcIso(ymd: string, hhmm: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  if (!/^\d{1,2}:\d{2}$/.test(hhmm)) return null;
  const [h, min] = hhmm.split(":").map(Number);
  if (h > 23 || min > 59) return null;

  // Start from the naive UTC reading, then correct by London's offset at that
  // instant. One pass is enough away from the DST boundary; the second settles
  // the hour when the first guess landed on the other side of a change.
  let guess = new Date(`${ymd}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`);
  if (Number.isNaN(guess.getTime())) return null;
  for (let i = 0; i < 2; i++) {
    const offsetMs = londonOffsetMs(guess);
    const next = new Date(
      Date.parse(`${ymd}T${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}:00Z`) - offsetMs,
    );
    if (next.getTime() === guess.getTime()) break;
    guess = next;
  }
  return guess.toISOString();
}

/** How far ahead of UTC London runs at `instant` (0 in winter, 1h in BST). */
function londonOffsetMs(instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: LONDON,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  }).formatToParts(instant);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return asUtc - instant.getTime();
}

// ─── Photo merge (edit mode) ─────────────────────────────────────────────────

type PhotoSet = string[] | Record<string, string[]>;

const cleanList = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];

/**
 * Keeps every photo already on the report and appends the fresh uploads.
 * Editing exists so a report saved without photos can receive them later —
 * losing the old ones on the way would defeat the point.
 */
export function mergeReportPhotos(existing: unknown, fresh: PhotoSet): PhotoSet {
  if (!existing) return fresh;

  if (Array.isArray(existing)) {
    const old = cleanList(existing);
    if (Array.isArray(fresh)) return [...old, ...fresh];
    // Template shape changed between fills (title edit) — keep the old flat
    // list under its own slot so nothing silently disappears.
    return old.length ? { ...fresh, previous: [...cleanList((fresh as Record<string, string[]>).previous), ...old] } : fresh;
  }

  if (typeof existing === "object") {
    const out: Record<string, string[]> = {};
    for (const [slot, urls] of Object.entries(existing as Record<string, unknown>)) {
      const list = cleanList(urls);
      if (list.length) out[slot] = list;
    }
    if (Array.isArray(fresh)) {
      if (fresh.length) out.added = [...(out.added ?? []), ...fresh];
      return out;
    }
    for (const [slot, urls] of Object.entries(fresh)) {
      out[slot] = [...(out[slot] ?? []), ...urls];
    }
    return out;
  }

  return fresh;
}

// ─── Persistence ─────────────────────────────────────────────────────────────

export interface PersistResult {
  ok: boolean;
  error?: string;
  /** Photo uploads that failed — the report still saves without them. */
  photoFailures: number;
}

/**
 * Uploads the photos, writes both JSONB columns and moves the job to
 * `final_check`. Callers own their own authorisation: the public route checks
 * the token against the job's partner, the office route checks the session role.
 */
export async function persistReportSubmission(
  supabase: SupabaseClient,
  job: ReportSubmissionJob,
  input: ReportSubmissionInput,
): Promise<PersistResult> {
  const now = new Date().toISOString();
  const failures = { count: 0 };

  const startPhotos = input.writeStart
    ? await uploadSlotPhotos(supabase, job.id, "start", input.photos, input.template, failures)
    : null;
  const finalPhotos = await uploadSlotPhotos(
    supabase,
    job.id,
    "final",
    input.photos,
    input.template,
    failures,
  );

  const durationMs =
    typeof input.finalData.duration_ms === "number" ? input.finalData.duration_ms : null;
  const { startedAt, endedAt } = deriveTimerWindow({
    existingStartedAt: job.partner_timer_started_at ?? null,
    existingEndedAt: job.partner_timer_ended_at ?? null,
    explicitStartedAt: input.timerStartedAt ?? null,
    explicitEndedAt: input.timerEndedAt ?? null,
    durationMs,
    now,
    preferExplicit: input.overwrite === true,
  });

  const update: Record<string, unknown> = {
    final_report: buildReportPayload({
      template: input.template,
      source: input.source,
      submittedAt: now,
      photos: mergeReportPhotos(input.existingFinalPhotos, finalPhotos ?? []),
      data: input.finalData,
    }),
    final_report_submitted: true,
    final_report_skipped: false,
    final_report_approved_at: now,
    partner_timer_ended_at: endedAt,
    partner_timer_is_paused: false,
    updated_at: now,
  };
  if (input.moveToFinalCheck !== false) update.status = "final_check";
  if (startedAt) update.partner_timer_started_at = startedAt;
  if (input.filledBy) update.final_report_approved_by = input.filledBy;

  if (input.writeStart) {
    update.start_report = buildReportPayload({
      template: input.template,
      source: input.source,
      submittedAt: now,
      photos: mergeReportPhotos(input.existingStartPhotos, startPhotos ?? []),
      data: input.startData,
    });
    update.start_report_submitted = true;
    update.start_report_skipped = false;
    update.start_report_approved_at = now;
    if (input.filledBy) update.start_report_approved_by = input.filledBy;
  }

  const { error } = await supabase.from("jobs").update(update).eq("id", job.id);
  if (error) {
    console.error("[report-submission] update failed:", error);
    return { ok: false, error: "Could not save the report.", photoFailures: failures.count };
  }

  void supabase
    .from("audit_logs")
    .insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference ?? null,
      action: input.overwrite ? "report_edited" : "report_submitted",
      field_name: input.writeStart ? "start_report+final_report" : "final_report",
      old_value: job.status ?? null,
      new_value: input.moveToFinalCheck !== false ? "final_check" : job.status ?? null,
      metadata: {
        source: input.source,
        template: input.template,
        filled_by: input.filledBy ?? null,
        overwrite: input.overwrite === true,
      },
    })
    .then(({ error: auditErr }) => {
      if (auditErr) console.error("audit_logs (report-submission)", auditErr);
    });

  return { ok: true, photoFailures: failures.count };
}

/** Cleaner/certificate return `{ slot: [urls] }`; the rest a flat array. */
async function uploadSlotPhotos(
  supabase: SupabaseClient,
  jobId: string,
  kind: "start" | "final",
  photoEntries: Record<string, File[]>,
  template: ReportTemplate,
  failures: { count: number },
): Promise<string[] | Record<string, string[]>> {
  const allowed = slotsForKind(template, kind);

  if (allowed === null) {
    const flatSlot = kind === "start" ? "before" : "after";
    return uploadFlat(supabase, jobId, kind, photoEntries[flatSlot] ?? [], failures);
  }

  const result: Record<string, string[]> = {};
  for (const [slot, files] of Object.entries(photoEntries)) {
    if (!allowed.has(slot)) continue;
    result[slot] = await uploadFlat(supabase, jobId, `${kind}-${slot}`, files, failures);
  }
  return result;
}

async function uploadFlat(
  supabase: SupabaseClient,
  jobId: string,
  prefix: string,
  files: File[],
  failures: { count: number },
): Promise<string[]> {
  const out: string[] = [];
  for (let i = 0; i < files.length; i++) {
    const f = files[i];
    const bytes = new Uint8Array(await f.arrayBuffer());
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    const isPdf = f.type === "application/pdf" || f.name.toLowerCase().endsWith(".pdf");
    const ext = isPdf ? "pdf" : "jpg";
    const path = `${jobId}/${prefix}-${i}-${ts}.${ext}`;
    const { error } = await supabase.storage.from(BUCKET).upload(path, bytes, {
      contentType: isPdf ? "application/pdf" : f.type || "image/jpeg",
      upsert: false,
    });
    if (error) {
      console.error("[report-submission] photo upload failed:", error);
      failures.count += 1;
      continue;
    }
    const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
    if (data?.publicUrl) out.push(data.publicUrl);
  }
  return out;
}
