import { fromZendeskTag } from "@/lib/zendesk-reason-tags";

/** Canonical on-hold reason ids — Zendesk dropdown values use `hold_{id}`. */
export const JOB_ON_HOLD_REASONS = [
  { id: "waiting_materials", label: "Waiting for materials" },
  { id: "client_rescheduled", label: "Client rescheduled" },
  { id: "access_issue", label: "Access issue" },
  { id: "partner_unavailable", label: "Partner unavailable" },
  { id: "awaiting_confirmation", label: "Awaiting confirmation" },
  { id: "complaint", label: "Complaint" },
  { id: "other", label: "Other" },
] as const;

export type JobOnHoldReasonId = (typeof JOB_ON_HOLD_REASONS)[number]["id"];

export type JobOnHoldPresetRow = { id: string; label: string };

const CANONICAL_BY_ID = new Map(JOB_ON_HOLD_REASONS.map((r) => [r.id, r.label]));
const CANONICAL_BY_LABEL = new Map(
  JOB_ON_HOLD_REASONS.map((r) => [r.label.trim().toLowerCase(), r.id]),
);

export function jobOnHoldReasonLabel(
  id: string,
  presets?: readonly JobOnHoldPresetRow[],
): string {
  const fromSetup = presets?.find((r) => r.id === id)?.label?.trim();
  if (fromSetup) return fromSetup;
  return CANONICAL_BY_ID.get(id as JobOnHoldReasonId) ?? id;
}

/**
 * O job está em espera POR RECLAMAÇÃO?
 *
 * Três provas, porque as linhas antigas não são uniformes. O preset é a prova
 * boa e é o que o caminho novo grava. Mas o JOB-9261 até o 9264 (04/06/2026)
 * entraram só com o texto "Complaint" em `on_hold_reason`, sem preset e sem
 * descrição — e o JOB-8945 gravou "Complaint — Client Complaint". Ler só o
 * preset deixaria esses de fora, que são justamente os quatro que terminaram
 * cancelados sem ninguém olhar.
 *
 * Fica aqui, puro, porque a tela, o filtro e qualquer regra futura de retenção
 * de pagamento precisam responder isto do mesmo jeito.
 */
export function jobOnHoldPorReclamacao(job: {
  on_hold_reason_preset_id?: string | null;
  on_hold_reason?: string | null;
  on_hold_complaint_description?: string | null;
}): boolean {
  if (job.on_hold_reason_preset_id === "complaint") return true;
  if (job.on_hold_complaint_description?.trim()) return true;
  return /\bcomplaint\b/i.test(job.on_hold_reason ?? "");
}

export function resolveJobOnHoldReasonIdFromLabel(label: string): string | null {
  const key = label.trim().toLowerCase();
  if (!key) return null;
  return CANONICAL_BY_LABEL.get(key) ?? null;
}

/** Validate bare OS id or Zendesk `hold_*` tag against canonical + optional Settings presets. */
export function parseJobOnHoldReasonId(
  raw: string,
  presets?: readonly JobOnHoldPresetRow[],
): string | null {
  const id = fromZendeskTag(raw, "hold");
  if (!id) return null;
  if (presets?.some((p) => p.id === id)) return id;
  if (CANONICAL_BY_ID.has(id as JobOnHoldReasonId)) return id;
  return null;
}

export function slugifyJobOnHoldPresetId(label: string): string {
  const base = label
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 48);
  return base || "custom_reason";
}

/** Office-visible reason line stored on `jobs.on_hold_reason`. */
export function buildJobOnHoldReasonText(
  presetId: string,
  detail?: string | null,
  presets?: readonly JobOnHoldPresetRow[],
): string {
  const label = jobOnHoldReasonLabel(presetId, presets);
  const d = detail?.trim() ?? "";
  if (presetId === "other" && !d) return label;
  if (presetId === "complaint" && d) return `${label} — ${d}`;
  if (!d) return label;
  return `${label} — ${d}`;
}

export function jobOnHoldComplaintDescriptionRequired(presetId: string): boolean {
  return presetId === "complaint";
}

/** Text shown to the partner — Zendesk Complaint Description / OS `on_hold_complaint_description`. */
export function partnerOnHoldComplaintReasonText(job: {
  on_hold_complaint_description?: string | null;
  on_hold_reason?: string | null;
  on_hold_reason_preset_id?: string | null;
}): string | null {
  const desc = job.on_hold_complaint_description?.trim();
  if (desc) return desc;
  const reason = job.on_hold_reason?.trim();
  if (!reason) return null;
  if (/^customer complaint/i.test(reason)) return null;
  const dash = reason.indexOf(" — ");
  if (dash >= 0) {
    const detail = reason.slice(dash + 3).trim();
    if (detail) return detail;
  }
  // Preset label only (e.g. "Complaint") — not the customer narrative.
  return null;
}

/** Partner solution from submission notes. */
export function partnerOnHoldSolutionText(job: {
  on_hold_submission?: { notes?: string | null } | null;
}): string | null {
  const notes = job.on_hold_submission?.notes?.trim();
  return notes || null;
}
