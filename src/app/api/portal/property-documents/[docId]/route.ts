import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const BUCKET = "account-property-docs";

type RouteCtx = { params: Promise<{ docId: string }> };

/**
 * GET — temporary redirect to a signed URL for a document on a property the portal user can access.
 */
export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;
  const { docId } = await ctx.params;
  if (!isUuid(docId)) return NextResponse.json({ error: "Invalid document." }, { status: 400 });

  const supabase = createServiceClient();
  const { data: doc, error: dErr } = await supabase
    .from("account_property_documents")
    .select("id, storage_path, property_id")
    .eq("id", docId)
    .maybeSingle();
  if (dErr || !doc) return NextResponse.json({ error: "Not found." }, { status: 404 });

  const { data: prop, error: pErr } = await supabase
    .from("account_properties")
    .select("account_id")
    .eq("id", (doc as { property_id: string }).property_id)
    .is("deleted_at", null)
    .maybeSingle();
  if (pErr || !prop || (prop as { account_id: string }).account_id !== auth.accountId) {
    return NextResponse.json({ error: "Forbidden." }, { status: 403 });
  }

  const path = (doc as { storage_path: string }).storage_path;
  const { data: signed, error: sErr } = await supabase.storage.from(BUCKET).createSignedUrl(path, 120);
  if (sErr || !signed?.signedUrl) {
    console.error("[portal/property-documents] signed URL", sErr);
    return NextResponse.json({ error: "Could not open file." }, { status: 500 });
  }

  return NextResponse.redirect(signed.signedUrl);
}
