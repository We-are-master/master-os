import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/portal/assets — list properties for the signed-in portal account.
 * POST /api/portal/assets — create a property (JSON body).
 */
export async function GET() {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("account_properties")
    .select("*")
    .eq("account_id", auth.accountId)
    .is("deleted_at", null)
    .order("name", { ascending: true });

  if (error) {
    console.error("[portal/assets GET]", error);
    return NextResponse.json({ error: "Could not load properties." }, { status: 500 });
  }
  return NextResponse.json({ items: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const name = String(body.name ?? "").trim();
  const fullAddress = String(body.fullAddress ?? body.full_address ?? "").trim();
  const propertyType = String(body.propertyType ?? body.property_type ?? "").trim();
  const primaryContactIdRaw = body.primaryContactId ?? body.primary_contact_id;
  const primaryContactId =
    primaryContactIdRaw == null || primaryContactIdRaw === ""
      ? null
      : String(primaryContactIdRaw).trim();
  const phone = String(body.phone ?? "").trim() || null;
  const notes = String(body.notes ?? "").trim() || null;

  if (!name || name.length > 200) {
    return NextResponse.json({ error: "Property name is required." }, { status: 400 });
  }
  if (!fullAddress || fullAddress.length > 1000) {
    return NextResponse.json({ error: "Full address is required." }, { status: 400 });
  }
  if (!propertyType || propertyType.length > 80) {
    return NextResponse.json({ error: "Property type is required." }, { status: 400 });
  }

  if (primaryContactId && !isUuid(primaryContactId)) {
    return NextResponse.json({ error: "Invalid primary contact." }, { status: 400 });
  }

  const supabase = createServiceClient();

  if (primaryContactId) {
    const { data: c } = await supabase
      .from("clients")
      .select("id")
      .eq("id", primaryContactId)
      .eq("source_account_id", auth.accountId)
      .is("deleted_at", null)
      .maybeSingle();
    if (!c) {
      return NextResponse.json(
        { error: "Primary site contact must be a contact on this account." },
        { status: 400 },
      );
    }
  }

  const { data: row, error } = await supabase
    .from("account_properties")
    .insert({
      account_id: auth.accountId,
      name,
      full_address: fullAddress,
      property_type: propertyType,
      primary_contact_id: primaryContactId,
      phone,
      notes,
    })
    .select()
    .single();

  if (error || !row) {
    console.error("[portal/assets POST]", error);
    return NextResponse.json({ error: "Could not create property." }, { status: 500 });
  }

  return NextResponse.json({ ok: true, property: row });
}
