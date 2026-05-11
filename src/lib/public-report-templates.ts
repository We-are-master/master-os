/**
 * Field metadata for the public quote-link report submission form.
 *
 * Mirrors the partner mobile app's `pickReportTemplate` + per-template
 * field sets in `screens/jobs/reports/*ReportScreen.tsx` so a job's V2
 * `start_report` / `final_report` JSONB written through the public form
 * lands in the same shape the dashboard V2 cards already understand.
 *
 * No timer here — public submitters type `durationHours` / `durationMinutes`
 * by hand and we serialise to `duration_ms` on submit.
 */

export type ReportTemplate = "general" | "gardener" | "cleaner";

const GARDENER_KEYWORDS = ["garden", "lawn", "hedge", "landscap"];
const CLEANER_KEYWORDS  = ["clean", "housekeep", "sanitiz", "sanitis"];

export function pickReportTemplate(input: {
  serviceType?: string | null;
  title?:       string | null;
}): ReportTemplate {
  const haystack = `${input.serviceType ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (GARDENER_KEYWORDS.some((k) => haystack.includes(k))) return "gardener";
  if (CLEANER_KEYWORDS.some((k) => haystack.includes(k))) return "cleaner";
  return "general";
}

// ─── Field declarations ──────────────────────────────────────────────────────

export type ReportFieldType = "boolean" | "number" | "text" | "longtext" | "select";

export interface ReportField {
  key:           string;
  label:         string;
  hint?:         string;
  type:          ReportFieldType;
  options?:      Array<{ value: string; label: string }>;
  /** When true, treat blank as "skip" (don't send the key at all). */
  optional?:     boolean;
  /** When set: a key whose true/false value gates whether this field is shown. */
  showIf?:       { key: string; equals: unknown };
}

interface TemplateSpec {
  start: ReportField[];
  final: ReportField[];
}

const SPECS: Record<ReportTemplate, TemplateSpec> = {
  general: {
    start: [
      {
        key: "recommend_additional_services",
        label: "Spotted any extra work the customer should know about?",
        type: "boolean",
      },
    ],
    final: [
      {
        key: "description",
        label: "Work description",
        hint: "What was done on site, in your own words.",
        type: "longtext",
      },
      {
        key: "additional_charges",
        label: "Any additional charges agreed on site?",
        type: "boolean",
      },
      {
        key: "additional_charges_note",
        label: "Charges note",
        type: "text",
        optional: true,
        showIf: { key: "additional_charges", equals: true },
      },
      {
        key: "completion_status",
        label: "Completion status",
        type: "select",
        options: [
          { value: "complete",          label: "Complete" },
          { value: "partially_complete", label: "Partially complete" },
          { value: "could_not_complete", label: "Could not complete" },
        ],
      },
      {
        key: "what_needs_completing",
        label: "What still needs completing",
        type: "longtext",
        optional: true,
        showIf: { key: "completion_status", equals: "partially_complete" },
      },
      {
        key: "follow_up_required",
        label: "Follow-up required?",
        type: "boolean",
      },
    ],
  },
  gardener: {
    start: [
      {
        key: "number_of_gardeners",
        label: "Number of gardeners on site",
        type: "number",
      },
    ],
    final: [
      {
        key: "description",
        label: "Work description",
        hint: "Summary of tasks completed on the day.",
        type: "longtext",
      },
      {
        key: "waste_bags",
        label: "Waste bags removed",
        type: "number",
      },
      {
        key: "materials_charges",
        label: "Charge for materials?",
        type: "boolean",
      },
      {
        key: "materials_charges_note",
        label: "Materials note",
        type: "text",
        optional: true,
        showIf: { key: "materials_charges", equals: true },
      },
      {
        key: "all_tasks_done",
        label: "All scheduled tasks done?",
        type: "boolean",
      },
      {
        key: "next_visit_tasks",
        label: "Tasks for next visit",
        type: "longtext",
        optional: true,
      },
      {
        key: "seasonal_maintenance",
        label: "Seasonal maintenance notes",
        type: "longtext",
        optional: true,
      },
    ],
  },
  cleaner: {
    start: [
      { key: "scope_changes",        label: "Any scope changes on site?",     type: "boolean" },
      {
        key: "scope_changes_note",
        label: "Scope changes note",
        type: "text",
        optional: true,
        showIf: { key: "scope_changes", equals: true },
      },
      { key: "pre_existing_damage",  label: "Pre-existing damage noticed?",   type: "boolean" },
      { key: "photos_refused",       label: "Customer refused photos?",       type: "boolean" },
      { key: "recommend_additional_services", label: "Suggest extra services?", type: "boolean" },
    ],
    final: [
      { key: "job_complete",       label: "Job complete?",            type: "boolean" },
      { key: "customer_inspected", label: "Customer inspected the work?", type: "boolean" },
    ],
  },
};

export function fieldsForTemplate(template: ReportTemplate): TemplateSpec {
  return SPECS[template];
}

/** Mirrors the per-template photo bucket layout from the mobile app. */
export function photoSlotsForTemplate(template: ReportTemplate): {
  start: Array<{ key: string; label: string }>;
  final: Array<{ key: string; label: string }>;
} {
  if (template === "cleaner") {
    const rooms = [
      { key: "living_room",   label: "Living room" },
      { key: "hallways",      label: "Hallways" },
      { key: "kitchen",       label: "Kitchen" },
      { key: "bathrooms",     label: "Bathrooms" },
      { key: "bedrooms",      label: "Bedrooms" },
      { key: "steam_cleaning", label: "Steam cleaning" },
    ];
    return {
      start: [{ key: "equipment", label: "Equipment" }, ...rooms],
      final: rooms,
    };
  }
  return {
    start: [{ key: "before", label: "Before photos" }],
    final: [{ key: "after",  label: "After photos" }],
  };
}
