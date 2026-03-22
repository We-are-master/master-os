import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import {
  fetchOpsSnapshot,
  snapshotToPromptBlock,
  fetchQuotesPipelineBlock,
  fetchAssignedJobsBlock,
} from "@/lib/master-brain-metrics";
import {
  MASTER_BRAIN_SYSTEM_PROMPT,
  MASTER_BRAIN_MANAGER_PROMPT,
  MASTER_BRAIN_OPERATOR_PROMPT,
  openaiChat,
  isOpenAIConfigured,
  type ChatMessage,
} from "@/lib/openai-client";

type Body = {
  message?: string;
  history?: { role: "user" | "assistant"; content: string }[];
};

type AppRole = "admin" | "manager" | "operator";

type CompanyAiRow = {
  master_brain_enabled?: boolean;
  master_brain_manager_enabled?: boolean;
  master_brain_operator_enabled?: boolean;
  master_brain_manager_instructions?: string | null;
  master_brain_operator_instructions?: string | null;
};

function allowedForRole(settings: CompanyAiRow | null, role: AppRole): boolean {
  if (!settings) return false;
  if (role === "admin") return Boolean(settings.master_brain_enabled);
  if (role === "manager") return Boolean(settings.master_brain_manager_enabled);
  if (role === "operator") return Boolean(settings.master_brain_operator_enabled);
  return false;
}

function appendInstructions(base: string, extra: string | null | undefined): string {
  const t = (extra ?? "").trim();
  if (!t) return base;
  return `${base}\n\nCompany-specific instructions from admin:\n${t}`;
}

/**
 * Master Brain chat — admin / manager / operator when enabled in company_settings + OPENAI_API_KEY.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  if (!isOpenAIConfigured()) {
    return NextResponse.json(
      { error: "OpenAI is not configured (set OPENAI_API_KEY on the server)." },
      { status: 503 },
    );
  }

  const admin = createServiceClient();
  const { data: prof, error: pErr } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  const role = prof?.role as AppRole | undefined;
  if (pErr || !role || !["admin", "manager", "operator"].includes(role)) {
    return NextResponse.json({ error: "Master Brain is not available for this profile." }, { status: 403 });
  }

  const { data: settingsRow } = await admin
    .from("company_settings")
    .select(
      "master_brain_enabled, master_brain_manager_enabled, master_brain_operator_enabled, master_brain_manager_instructions, master_brain_operator_instructions",
    )
    .limit(1)
    .maybeSingle();

  const settings = settingsRow as CompanyAiRow | null;
  if (!allowedForRole(settings, role)) {
    return NextResponse.json({ error: "Master Brain is disabled for your role in company settings." }, { status: 403 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 8000) {
    return NextResponse.json({ error: "message required (max 8000 chars)" }, { status: 400 });
  }

  const history = Array.isArray(body.history) ? body.history.slice(-16) : [];

  let systemPrompt = MASTER_BRAIN_SYSTEM_PROMPT;
  const contextParts: string[] = [];

  try {
    const snap = await fetchOpsSnapshot(admin);
    contextParts.push(`General operational context:\n${snapshotToPromptBlock(snap)}`);
  } catch (e) {
    console.error("Master Brain snapshot:", e);
    contextParts.push("General operational context: (could not load)");
  }

  if (role === "manager" || role === "operator") {
    try {
      const qBlock = await fetchQuotesPipelineBlock(admin);
      contextParts.push(`Quotes focus:\n${qBlock}`);
    } catch (e) {
      console.error("Master Brain quotes block:", e);
    }
  }

  if (role === "operator") {
    try {
      const jBlock = await fetchAssignedJobsBlock(admin, auth.user.id);
      contextParts.push(`This user's assignments:\n${jBlock}`);
    } catch (e) {
      console.error("Master Brain jobs block:", e);
    }
    systemPrompt = appendInstructions(
      MASTER_BRAIN_OPERATOR_PROMPT,
      settings?.master_brain_operator_instructions,
    );
  } else if (role === "manager") {
    systemPrompt = appendInstructions(
      MASTER_BRAIN_MANAGER_PROMPT,
      settings?.master_brain_manager_instructions,
    );
  }

  const msgs: ChatMessage[] = [
    { role: "system", content: systemPrompt },
    {
      role: "system",
      content: `Fresh data from Master OS (use only as facts; may be partial):\n\n${contextParts.join("\n\n---\n\n")}`,
    },
  ];

  for (const h of history) {
    if (h.role !== "user" && h.role !== "assistant") continue;
    if (typeof h.content !== "string" || !h.content.trim()) continue;
    msgs.push({ role: h.role, content: h.content.trim().slice(0, 8000) });
  }
  msgs.push({ role: "user", content: message });

  try {
    const maxTokens = role === "admin" ? 1200 : 1000;
    const reply = await openaiChat(msgs, { maxTokens, temperature: role === "operator" ? 0.5 : 0.55 });
    return NextResponse.json({ reply, role });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "OpenAI error";
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}

/** Admin-only: check if server has OpenAI key (for settings UI). */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;

  const admin = createServiceClient();
  const { data: prof } = await admin.from("profiles").select("role").eq("id", auth.user.id).maybeSingle();
  if (prof?.role !== "admin") {
    return NextResponse.json({ error: "Admin only" }, { status: 403 });
  }

  return NextResponse.json({
    openaiConfigured: isOpenAIConfigured(),
    model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
  });
}
