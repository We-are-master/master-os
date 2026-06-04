/** Preset reasons when the office cancels a job (shown in dashboard + sent to assigned partner). */
export const OFFICE_JOB_CANCELLATION_REASONS = [
  { id: "client_requested", label: "Client requested cancellation" },
  { id: "scheduling_access", label: "Scheduling / property access issue" },
  { id: "duplicate_error", label: "Duplicate job or created in error" },
  { id: "pricing_scope", label: "Pricing or scope disagreement" },
  { id: "partner_capacity", label: "Partner unavailable / reassignment needed" },
  { id: "weather_external", label: "Weather or external factor" },
  { id: "other", label: "Other (add details below)" },
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
  const v = raw.trim();
  if (!v) return null;
  const id = v.startsWith("cancel_") ? v.slice("cancel_".length) : v;
  const row = OFFICE_JOB_CANCELLATION_REASONS.find((r) => r.id === id);
  return row ? row.id : null;
}
