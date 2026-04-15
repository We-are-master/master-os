import { NextRequest, NextResponse } from "next/server";
import { requirePortalUser } from "@/lib/portal-auth";
import { createServiceClient } from "@/lib/supabase/service";
import { isUuid } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type RouteCtx = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  const supabase = createServiceClient();
  const { data, error } = await supabase
    .from("account_properties")
    .select("*")
    .eq("id", id)
    .eq("account_id", auth.accountId)
    .is("deleted_at", null)
    .maybeSingle();

  if (error || !data) {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }
  return NextResponse.json({ property: data });
}

export async function PATCH(req: NextRequest, ctx: RouteCtx) {
  const auth = await requirePortalUser();
  if (auth instanceof NextResponse) return auth;
  const { id } = await ctx.params;
  if (!isUuid(id)) return NextResponse.json({ error: "Invalid id." }, { status: 400 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const patch: Record<string, unknown> = {};
  if (body.name != null) patch.name = String(body.name).trim();
  if (body.fullAddress != null || body.full_address != null) {
    patch.full_address = String(body.fullAddress ?? body.full_address ?? "").trim();
  }
  if (body.propertyType != null || body.property_type != null) {
    patch.property_type = String(body.propertyType ?? body.property_type ?? "").trim();
  }
  if ("primaryContactId" in body || "primary_contact_id" in body) {
    const raw = body.primaryContactId ?? body.primary_contact_id;
    patch.primary_contact_id =
      raw == null || raw === "" ? null : String(raw).trim();
  }
  if (body.phone != null) patch.phone = String(body.phone).trim() || null;
  if (body.notes != null) patch.notes = String(body.notes).trim() || null;

  const supabase = createServiceClient();

  const pc = patch.primary_contact_id;
  if (pc != null && pc !== "") {
    if (!isUuid(String(pc))) {
      return NextResponse.json({ error: "Invalid primary contact." }, { status: 400 });
    }
    const { data: c } = await supabase
      .from("clients")
      .select("id")
      .eq("id", pc)
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
    .update(patch)
    .eq("id", id)
    .eq("account_id", auth.accountId)
    .is("deleted_at", null)
    .select()
    .single();

  if (error || !row) {
    console.error("[portal/assets PATCH]", error);
    return NextResponse.json({ error: "Could not update property." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, property: row });
}
