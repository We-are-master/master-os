import type { SupabaseClient } from "@supabase/supabase-js";
import { REQUIRED_PARTNER_DOCS } from "@/lib/partner-required-docs";

const DOC_SATISFIES = new Set(["approved", "pending"]);

/**
 * Server-side document gate — mirrors trade portal `partnerMissingRequiredDocs`.
 * Partners cannot accept auto-assign offers until core docs are on file.
 */
export async function partnerMissingRequiredDocs(
  supabase: SupabaseClient,
  partnerId: string,
): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("partner_documents")
      .select("doc_type, status")
      .eq("partner_id", partnerId);
    if (error) throw error;
    const docs = (data ?? []) as Array<{ doc_type: string | null; status: string | null }>;
    return REQUIRED_PARTNER_DOCS.filter(
      (req) =>
        !docs.some(
          (d) =>
            d.doc_type === req.docType &&
            DOC_SATISFIES.has(String(d.status ?? "").trim().toLowerCase()),
        ),
    ).map((d) => d.name);
  } catch {
    return ["your documents could not be verified — try again"];
  }
}
