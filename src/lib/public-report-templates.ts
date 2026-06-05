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

import { isCertificateTypeOfWork } from "@/lib/type-of-work";

export type ReportTemplate = "general" | "gardener" | "cleaner" | "certificate";

const GARDENER_KEYWORDS = ["garden", "lawn", "hedge", "landscap"];
const CLEANER_KEYWORDS  = ["clean", "housekeep", "sanitiz", "sanitis"];

export function pickReportTemplate(input: {
  serviceType?: string | null;
  title?:       string | null;
}): ReportTemplate {
  const haystack = `${input.serviceType ?? ""} ${input.title ?? ""}`.toLowerCase();
  if (GARDENER_KEYWORDS.some((k) => haystack.includes(k))) return "gardener";
  if (CLEANER_KEYWORDS.some((k) => haystack.includes(k))) return "cleaner";
  if (isCertificateTypeOfWork(input.serviceType) || isCertificateTypeOfWork(input.title)) {
    return "certificate";
  }
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
  certificate: {
    start: [
      {
        key: "site_access_obtained",
        label: "Were you able to access the property?",
        type: "boolean",
      },
      {
        key: "access_issues_note",
        label: "Access issues",
        hint: "Explain what blocked access, if applicable.",
        type: "longtext",
        optional: true,
        showIf: { key: "site_access_obtained", equals: false },
      },
    ],
    final: [
      {
        key: "inspection_summary",
        label: "Inspection / testing summary",
        hint: "What was inspected or tested on site.",
        type: "longtext",
      },
      {
        key: "certificate_issued",
        label: "Certificate or report issued?",
        type: "boolean",
      },
      {
        key: "certificate_number",
        label: "Certificate / report reference",
        type: "text",
        optional: true,
        showIf: { key: "certificate_issued", equals: true },
      },
      {
        key: "certificate_outcome",
        label: "Outcome",
        type: "select",
        showIf: { key: "certificate_issued", equals: true },
        options: [
          { value: "satisfactory", label: "Satisfactory" },
          { value: "satisfactory_with_recommendations", label: "Satisfactory with recommendations" },
          { value: "unsatisfactory", label: "Unsatisfactory" },
        ],
      },
      {
        key: "expiry_date",
        label: "Expiry date",
        hint: "DD/MM/YYYY — if applicable.",
        type: "text",
        optional: true,
        showIf: { key: "certificate_issued", equals: true },
      },
      {
        key: "remedial_work_required",
        label: "Remedial work required?",
        type: "boolean",
      },
      {
        key: "remedial_work_details",
        label: "Remedial work details",
        type: "longtext",
        optional: true,
        showIf: { key: "remedial_work_required", equals: true },
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
        key: "follow_up_required",
        label: "Follow-up visit required?",
        type: "boolean",
      },
    ],
  },
};

export function fieldsForTemplate(template: ReportTemplate): TemplateSpec {
  return SPECS[template];
}

export function reportTemplateDisplayLabel(template: ReportTemplate): string {
  const labels: Record<ReportTemplate, string> = {
    general: "General maintenance",
    gardener: "Gardening",
    cleaner: "Cleaning",
    certificate: "Certificate",
  };
  return labels[template];
}

export function reportSectionTitles(template: ReportTemplate): { start: string; final: string } {
  if (template === "certificate") {
    return { start: "Site access", final: "Certificate details" };
  }
  if (template === "gardener") return { start: "On arrival", final: "On completion" };
  if (template === "cleaner") return { start: "On arrival", final: "On completion" };
  return { start: "On arrival", final: "On completion" };
}

export interface ReportPhotoSlot {
  key: string;
  label: string;
  hint?: string;
  /** Shown in UI only — uploads are never blocked server-side. */
  optional?: boolean;
  accept?: string;
  /** Large drop-style upload (certificate PDF/photo). */
  prominent?: boolean;
}

/** Mirrors the per-template photo bucket layout from the mobile app. */
export function photoSlotsForTemplate(template: ReportTemplate): {
  start: ReportPhotoSlot[];
  final: ReportPhotoSlot[];
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
  if (template === "certificate") {
    return {
      start: [],
      final: [
        {
          key: "certificate",
          label: "Attach certificate or report",
          hint: "Upload the issued certificate or report — PDF or photo.",
          accept: "image/*,application/pdf,.pdf",
          prominent: true,
          optional: true,
        },
      ],
    };
  }
  return {
    start: [{ key: "before", label: "Before photos" }],
    final: [{ key: "after",  label: "After photos" }],
  };
}
