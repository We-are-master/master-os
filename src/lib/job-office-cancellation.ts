import { fromZendeskTag } from "@/lib/zendesk-reason-tags";

/** Preset reasons when the office cancels a job (shown in dashboard + sent to assigned partner). */
/**
 * Two words each, because this label is read twice: once by the operator
 * picking it under time pressure, and once by the partner, who receives it as
 * the reason their job disappeared. "Partner unavailable / reassignment needed"
 * told the partner about our internal process; "Partner unavailable" tells them
 * what happened. The detail box carries the specifics.
 */
export const OFFICE_JOB_CANCELLATION_REASONS = [
  { id: "client_requested", label: "Client cancelled" },
  { id: "scheduling_access", label: "No access" },
  { id: "duplicate_error", label: "Booking error" },
  { id: "pricing_scope", label: "Price disputed" },
  { id: "partner_capacity", label: "Partner unavailable" },
  { id: "weather_external", label: "Weather" },
  { id: "other", label: "Other" },
] as const;

export type OfficeJobCancellationReasonId = (typeof OFFICE_JOB_CANCELLATION_REASONS)[number]["id"];

export function officeCancellationReasonLabel(
  id: string,
  presets?: readonly { id: string; label: string }[],
): string {
  const trimmed = presets?.find((r) => r.id === id)?.label?.trim();
  if (trimmed) return trimmed;
  const row = OFFICE_JOB_CANCELLATION_REASONS.find((r) => r.id === id);
  return row?.label ?? id;
}

/**
 * Rótulo curto do motivo para chips (dono, 19/10/2026): o texto gravado pode ser longo
 * ("Client requested cancellation — platform cancellation email (ticket #…)") e quebrava
 * o chip. Com preset, o nome de duas palavras; sem preset, só o trecho antes do detalhe.
 */
export function shortCancellationReasonLabel(
  reason: string | null | undefined,
  presetId?: string | null,
): string | null {
  const preset = presetId?.trim() ? OFFICE_JOB_CANCELLATION_REASONS.find((r) => r.id === presetId) : undefined;
  if (preset) return preset.label;
  const texto = reason?.trim();
  if (!texto) return null;
  const antesDoDetalhe = texto.split(/\s+[—–-]\s+|\s+\(|\.\s/)[0].replace(/\.$/, "").trim();
  if (/^client requested cancell?ation$/i.test(antesDoDetalhe)) return "Client cancelled";
  return antesDoDetalhe || texto;
}

/** Single text stored on `jobs.cancellation_reason` (partner + internal visibility). */
export function buildOfficeCancellationReasonText(
  presetId: string,
  detail?: string,
  presets?: readonly { id: string; label: string }[],
): string {
  const label = officeCancellationReasonLabel(presetId, presets);
  const d = detail?.trim() ?? "";
  if (presetId === "other" && !d) return label;
  if (!d) return label;
  return `${label} — ${d}`;
}

export function officeCancellationDetailRequired(presetId: string): boolean {
  return presetId === "other";
}

/** Alias for Zendesk / API validation (notes required when reason is other). */
export const officeCancellationNotesRequired = officeCancellationDetailRequired;

/** Validate bare OS id or Zendesk `cancel_*` tag → canonical id. */
export function parseOfficeCancellationReasonId(raw: string): OfficeJobCancellationReasonId | null {
  const id = fromZendeskTag(raw, "cancel");
  const row = OFFICE_JOB_CANCELLATION_REASONS.find((r) => r.id === id);
  return row ? row.id : null;
}
