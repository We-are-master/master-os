/**
 * POST /api/crm/leads/from-conversation
 *
 * "Add to CRM" do Atendimento (06/11/2026, dono): a pessoa da equipe escolhe a
 * coluna e o card nasce ligado ao contato (cliente, telefone, ticket). Se o
 * contato já tem um card aberto, devolve o dele em vez de duplicar. O lead é
 * nosso: nunca publicado aos parceiros.
 *
 * Só equipe com a permissão Leads.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isValidUUID } from "@/lib/auth-api";
import { requireStaffPermission } from "@/lib/staff-permission";
import { createServiceClient } from "@/lib/supabase/service";
import { registrarEvento } from "@/lib/crm/lead-servidor";
import { segmentoPeloProcesso } from "@/lib/crm/fontes";
import { legacyStatusFromStage } from "@/lib/crm/etapas";
import { limparScope } from "@/lib/scope-limpo";
import { formatLeadPhoneDisplay, normalizeLeadEmail, normalizeLeadPostcode } from "@/lib/lead-validation";
import { finalDoNumero } from "@/lib/whatsapp/operacao";
import type { LeadSegment, LeadStage } from "@/types/database";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/** Colunas em que um card pode nascer à mão. Quoted e Won vêm da quote e do job. */
const COLUNAS_DE_ENTRADA: readonly LeadStage[] = ["new", "qualified", "quoting"];
const ABERTAS: readonly LeadStage[] = ["new", "qualified", "quoting", "quoted"];

type Corpo = {
  stage?: unknown;
  segment?: unknown;
  name?: unknown;
  email?: unknown;
  phone?: unknown;
  postcode?: unknown;
  address?: unknown;
  scope?: unknown;
  clientId?: unknown;
  accountId?: unknown;
  ticketId?: unknown;
};

const texto = (v: unknown, max = 500) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const perm = await requireStaffPermission(auth, "leads");
  if (perm instanceof NextResponse) return perm;

  const b = ((await req.json().catch(() => null)) ?? {}) as Corpo;
  const stage = texto(b.stage) as LeadStage;
  if (!COLUNAS_DE_ENTRADA.includes(stage)) return NextResponse.json({ error: "Pick a column" }, { status: 400 });
  const name = texto(b.name, 120);
  if (!name) return NextResponse.json({ error: "Name is required" }, { status: 400 });
  const clientId = isValidUUID(texto(b.clientId)) ? texto(b.clientId) : null;
  const accountId = isValidUUID(texto(b.accountId)) ? texto(b.accountId) : null;
  const ticket = /^\d+$/.test(texto(b.ticketId)) ? texto(b.ticketId) : null;
  const phoneRaw = texto(b.phone, 40);
  const sb = createServiceClient();

  // Já tem card aberto (ticket, cliente ou telefone): abre o dele.
  const existente = await acharAberto(sb, { ticket, clientId, phone: phoneRaw });
  if (existente) return NextResponse.json({ ok: true, existed: true, lead: existente });

  let segment: LeadSegment = texto(b.segment) === "b2b" ? "b2b" : "b2c";
  if (accountId) {
    const { data } = await sb.from("accounts").select("process_type").eq("id", accountId).maybeSingle();
    if (segmentoPeloProcesso((data as { process_type?: string | null } | null)?.process_type) === "b2b") segment = "b2b";
  }
  const address = texto(b.address, 300);
  const postcode = normalizeLeadPostcode(texto(b.postcode, 12) || null, address);
  const { data: ref } = await sb.rpc("next_lead_ref");
  if (!ref) return NextResponse.json({ error: "Could not generate a lead reference" }, { status: 500 });

  const { data: criado, error } = await sb
    .from("leads")
    .insert({
      reference: String(ref),
      name,
      email: normalizeLeadEmail(texto(b.email, 200)) || null,
      phone: phoneRaw ? formatLeadPhoneDisplay(phoneRaw) : null,
      address: address || (postcode ? `London, ${postcode}` : "London"),
      city: "London",
      postcode,
      urgency: "medium",
      scope: limparScope(texto(b.scope, 2000)) ?? "",
      status: legacyStatusFromStage(stage),
      stage,
      segment,
      source: "whatsapp",
      client_id: clientId,
      account_id: accountId,
      external_source: ticket ? "zendesk" : null,
      external_ref: ticket,
      next_action: stage === "quoting" ? "Create the quote" : stage === "qualified" ? "Close the sale" : "Qualify the customer",
      next_action_at: new Date().toISOString(),
      owner_id: auth.user.id,
      published_at: null,
    })
    .select("id, reference, stage")
    .single();
  if (error || !criado) {
    // O ticket já tem lead (índice único): devolve o dele.
    const outro = ticket ? await acharAberto(sb, { ticket, clientId: null, phone: "" }) : null;
    if (outro) return NextResponse.json({ ok: true, existed: true, lead: outro });
    return NextResponse.json({ error: error?.message ?? "Could not create the lead" }, { status: 500 });
  }
  await registrarEvento(sb, {
    leadId: criado.id as string,
    kind: "created",
    channel: "whatsapp",
    actorType: "staff",
    actorId: auth.user.id,
    toStage: stage,
    summary: "Lead created from the inbox",
    payload: { client_id: clientId, ticket_id: ticket },
  });
  return NextResponse.json({ ok: true, existed: false, lead: criado });
}

async function acharAberto(
  sb: ReturnType<typeof createServiceClient>,
  q: { ticket: string | null; clientId: string | null; phone: string },
): Promise<{ id: string; reference: string | null; stage: LeadStage } | null> {
  const base = () => sb.from("leads").select("id, reference, stage, phone").is("deleted_at", null).in("stage", ABERTAS as LeadStage[]);
  if (q.ticket) {
    const { data } = await base().eq("external_source", "zendesk").eq("external_ref", q.ticket).limit(1).maybeSingle();
    if (data) return data as { id: string; reference: string | null; stage: LeadStage };
  }
  if (q.clientId) {
    const { data } = await base().eq("client_id", q.clientId).order("created_at", { ascending: false }).limit(1).maybeSingle();
    if (data) return data as { id: string; reference: string | null; stage: LeadStage };
  }
  const fim = finalDoNumero(q.phone);
  if (fim.length >= 10) {
    const { data } = await base().ilike("phone", `%${fim.slice(-4)}%`).limit(50);
    const achado = ((data ?? []) as Array<{ id: string; reference: string | null; stage: LeadStage; phone: string | null }>).find(
      (l) => finalDoNumero(l.phone) === fim,
    );
    if (achado) return achado;
  }
  return null;
}
