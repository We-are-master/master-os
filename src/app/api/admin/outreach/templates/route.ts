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

export async function GET() {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  const admin = createServiceClient();
  const { data, error } = await admin
    .from("outreach_templates")
    .select("*")
    .order("updated_at", { ascending: false });

  if (error) {
    console.error("[outreach/templates] list error:", error);
    return NextResponse.json({ error: "Failed to load templates" }, { status: 500 });
  }

  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const gate = await requireAdmin();
  if ("error" in gate) return gate.error;

  let payload: {
    name?: string;
    category?: string;
    subject?: string;
    body_html?: string;
    duplicate_of?: string;
  };
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const admin = createServiceClient();

  // Duplicate flow: load the source and clone with "Copy of" prefix.
  if (payload.duplicate_of) {
    if (!isValidUUID(payload.duplicate_of)) {
      return NextResponse.json({ error: "Invalid duplicate_of" }, { status: 400 });
    }
    const { data: source, error: srcErr } = await admin
      .from("outreach_templates")
      .select("*")
      .eq("id", payload.duplicate_of)
      .maybeSingle();
    if (srcErr || !source) {
      return NextResponse.json({ error: "Source template not found" }, { status: 404 });
    }
    const src = source as {
      name: string;
      category: string | null;
      subject: string;
      body_html: string;
      variables: string[];
    };
    const { data, error } = await admin
      .from("outreach_templates")
      .insert({
        name: `${src.name} (cópia)`,
        category: src.category,
        subject: src.subject,
        body_html: src.body_html,
        variables: src.variables,
        created_by: gate.user.id,
      })
      .select()
      .single();
    if (error) {
      console.error("[outreach/templates] duplicate error:", error);
      return NextResponse.json({ error: "Failed to duplicate template" }, { status: 500 });
    }
    return NextResponse.json({ template: data });
  }

  const name = typeof payload.name === "string" ? payload.name.trim() : "";
  const subject = typeof payload.subject === "string" ? payload.subject.trim() : "";
  const body_html = typeof payload.body_html === "string" ? payload.body_html.trim() : "";
  const category =
    payload.category && ALLOWED_CATEGORIES.includes(payload.category as OutreachTemplateCategory)
      ? (payload.category as OutreachTemplateCategory)
      : null;

  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  if (!subject) return NextResponse.json({ error: "Subject is required" }, { status: 400 });
  if (!body_html) return NextResponse.json({ error: "Body is required" }, { status: 400 });

  const variables = extractVariables(subject + " " + body_html);

  const { data, error } = await admin
    .from("outreach_templates")
    .insert({
      name,
      category,
      subject,
      body_html,
      variables,
      created_by: gate.user.id,
    })
    .select()
    .single();

  if (error) {
    console.error("[outreach/templates] create error:", error);
    return NextResponse.json({ error: "Failed to create template" }, { status: 500 });
  }

  return NextResponse.json({ template: data });
}
