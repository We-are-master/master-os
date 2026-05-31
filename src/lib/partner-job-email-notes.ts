import type { SupabaseClient } from "@supabase/supabase-js";
import type { CatalogService } from "@/types/database";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

/** Shown on all hourly partner job confirmation emails unless overridden per catalog row. */
export const DEFAULT_PARTNER_JOB_EMAIL_NOTES_HOURLY =
  "⏱ Maximum 3 hours included. If work extends beyond, contact us immediately on +44 20 4538 4668 to avoid disputes.";

/** Shown on all fixed partner job confirmation emails unless overridden per catalog row. */
export const DEFAULT_PARTNER_JOB_EMAIL_NOTES_FIXED =
  "✓ Fixed price confirmed above includes VAT. This is your maximum cost — no additional charges.";

/** Appended to every partner job offer / booked email. */
export const PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE =
  "⏱ IMPORTANT: Submit your job report within 24 hours of completion. Delayed submissions trigger additional verification checks, which may delay your payment.";

export type PartnerJobEmailNotesCatalog = Pick<
  CatalogService,
  "partner_email_notes_hourly" | "partner_email_notes_fixed" | "partner_email_notes_default"
>;

export function resolvePartnerJobEmailNotes(args: {
  jobType: "hourly" | "fixed";
  catalog?: PartnerJobEmailNotesCatalog | null;
}): string {
  const parts: string[] = [];

  const jobTypeNote =
    args.jobType === "hourly"
      ? args.catalog?.partner_email_notes_hourly?.trim() || DEFAULT_PARTNER_JOB_EMAIL_NOTES_HOURLY
      : args.catalog?.partner_email_notes_fixed?.trim() || DEFAULT_PARTNER_JOB_EMAIL_NOTES_FIXED;
  parts.push(jobTypeNote);

  const tradeNote = args.catalog?.partner_email_notes_default?.trim();
  if (tradeNote) parts.push(tradeNote);

  return parts.join("\n\n");
}

const CATALOG_NOTES_SELECT =
  "partner_email_notes_hourly, partner_email_notes_fixed, partner_email_notes_default, name";

async function loadCatalogNotesById(
  supabase: SupabaseClient,
  catalogServiceId: string,
): Promise<PartnerJobEmailNotesCatalog | null> {
  const { data } = await supabase
    .from("service_catalog")
    .select(CATALOG_NOTES_SELECT)
    .eq("id", catalogServiceId)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as PartnerJobEmailNotesCatalog | null) ?? null;
}

async function loadCatalogNotesByTitle(
  supabase: SupabaseClient,
  jobTitle: string,
): Promise<PartnerJobEmailNotesCatalog | null> {
  const norm = normalizeTypeOfWork(jobTitle);
  if (!norm) return null;

  const { data } = await supabase
    .from("service_catalog")
    .select(CATALOG_NOTES_SELECT)
    .eq("name", norm)
    .is("deleted_at", null)
    .maybeSingle();
  return (data as PartnerJobEmailNotesCatalog | null) ?? null;
}

/** Resolve partner email notes for job offer / booked templates. */
export async function loadPartnerJobEmailNotes(
  supabase: SupabaseClient,
  args: {
    catalogServiceId?: string | null;
    jobTitle?: string | null;
    jobType: "hourly" | "fixed";
  },
): Promise<string> {
  let catalog: PartnerJobEmailNotesCatalog | null = null;

  const catalogId = args.catalogServiceId?.trim();
  if (catalogId) {
    catalog = await loadCatalogNotesById(supabase, catalogId);
  }

  if (!catalog && args.jobTitle?.trim()) {
    catalog = await loadCatalogNotesByTitle(supabase, args.jobTitle);
  }

  return resolvePartnerJobEmailNotes({ jobType: args.jobType, catalog });
}
