import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { createClient } from "@/lib/supabase/server";
import { createServiceClient } from "@/lib/supabase/service";
import { extractVariables } from "@/lib/outreach/render-template";
import type { OutreachTemplateCategory } from "@/types/outreach";

export const dynamic = "force-dynamic";

const ALLOWED_CATEGORIES: OutreachTemplateCategory[] = [
  "onboarding",
  "follow_up",
  "reactivation",
  "announcement",
  "custom",
];

async function requireAdmin() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return { error: auth };
  const sb = await createClient();
  const { data: profile } = await sb
    .from("profiles")
    .select("role")
    .eq("id", auth.user.id)
    .single();
  if ((profile as { role?: string } | null)?.role !== "admin") {
    return { error: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { user: auth.user };
}

export async function PUT(
  req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  let payload: {
    name?: string;
    category?: string | null;
    subject?: string;
    body_html?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const updates: Record<string, unknown> = {};
  if (typeof payload.name === "string") updates.name = payload.name.trim();
  if (typeof payload.subject === "string") updates.subject = payload.subject.trim();
  if (typeof payload.body_html === "string") updates.body_html = payload.body_html.trim();
  if (payload.category === null) {
    updates.category = null;
  } else if (typeof payload.category === "string") {
    updates.category = ALLOWED_CATEGORIES.includes(payload.category as OutreachTemplateCategory)
      ? payload.category
      : null;
  }
  if (typeof updates.subject === "string" || typeof updates.body_html === "string") {
    const subject = (updates.subject as string | undefined) ?? "";
    const body = (updates.body_html as string | undefined) ?? "";
    updates.variables = extractVariables(subject + " " + body);
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "No fields to update" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("outreach_templates")
    .update(updates)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    console.error("[outreach/templates/[id]] update error:", error);
    return NextResponse.json({ error: "Failed to update template" }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ id: string }> },
) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const { id } = await ctx.params;
  if (!isValidUUID(id)) {
    return NextResponse.json({ error: "Invalid id" }, { status: 400 });
  }

  const admin = createServiceClient();
  const { error } = await admin.from("outreach_templates").delete().eq("id", id);

  if (error) {
    console.error("[outreach/templates/[id]] delete error:", error);
    return NextResponse.json({ error: "Failed to delete template" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
