import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/service";
import { fetchPartnerDocumentRules } from "@/lib/company-partner-doc-rules";
import { buildJoinRegistrationDocChecklist } from "@/lib/partner-required-docs";

export const dynamic = "force-dynamic";

/** Public: which documents the join form must collect (from Settings → Setup). */
export async function GET() {
  try {
    const supabase = createServiceClient();
    const rules = await fetchPartnerDocumentRules(supabase);
    const docs = buildJoinRegistrationDocChecklist(rules);
    return NextResponse.json({
      documents: docs.map((d) => ({
        key: d.id,
        label: d.name,
        hint: d.description,
      })),
    });
  } catch (e) {
    return NextResponse.json(
      { error: e instanceof Error ? e.message : "Failed to load document requirements" },
      { status: 500 },
    );
  }
}
