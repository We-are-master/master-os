import { NextRequest, NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { zendeskApi } from "@/lib/zendesk";
import { TITLE_FIELD_ID, tituloDoTicket } from "@/lib/zendesk-espelho";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const ORG_FIXFY = Number(process.env.ZENDESK_ORG_CUSTOMERS?.trim() || "6354308808991");
const TAGS_DE_LEAD = ["lead_gen", "harvey_wa_lead", "lead_checkatrade", "lead_meta", "lead_promo"];
const STATUS_DE_LEAD = [6417913706527, 6417870637599];

/**
 * POST /api/webhooks/desk/ticket-title
 *
 * Gatilho "Title on create" do Zendesk (dono, 26/10/2026): o Title nascia vazio e só era
 * preenchido pelo espelho, a cada 10 min (#51807). Aqui ele sai na criação, pela mesma
 * regra do espelho (`tituloDoTicket`); quando aparecer job ou quote, o espelho refina.
 * Corpo: { ticket_id }.
 */
export async function POST(req: NextRequest) {
  const provided = req.headers.get("x-api-key");
  const expected = (process.env.ZENDESK_WEBHOOK_API_KEY ?? process.env.ZOHO_DESK_WEBHOOK_API_KEY)?.trim();
  if (!expected) return NextResponse.json({ error: "Webhook not configured." }, { status: 500 });
  if (!secretsMatch(provided, expected)) return NextResponse.json({ error: "Unauthorized." }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const ticketId = String(body.ticket_id ?? "").trim();
  if (!/^\d+$/.test(ticketId)) return NextResponse.json({ error: "ticket_id is required." }, { status: 400 });

  type Ticket = { subject: string | null; organization_id: number | null; requester_id: number | null; custom_status_id: number | null; tags?: string[]; custom_fields?: Array<{ id: number; value: unknown }> };
  const { ticket: t } = await zendeskApi<{ ticket: Ticket }>(`tickets/${ticketId}.json`);
  const atual = t.custom_fields?.find((f) => Number(f.id) === TITLE_FIELD_ID)?.value;
  if (typeof atual === "string" && atual.trim()) return NextResponse.json({ ok: true, skipped: "title already set" });

  let nomeDoRequester: string | null = null;
  if (t.requester_id) {
    const { user } = await zendeskApi<{ user?: { name?: string } }>(`users/${t.requester_id}.json`).catch(() => ({ user: undefined }));
    nomeDoRequester = user?.name ?? null;
  }
  const titulo = tituloDoTicket({
    assunto: t.subject,
    fixfy: !t.organization_id || t.organization_id === ORG_FIXFY,
    semOrganizacao: !t.organization_id,
    etapa: null,
    ehLead: STATUS_DE_LEAD.includes(Number(t.custom_status_id)) || (t.tags ?? []).some((x) => TAGS_DE_LEAD.includes(x)),
    nomeDoRequester,
  });
  if (!titulo) return NextResponse.json({ ok: true, skipped: "no title" });
  await zendeskApi(`tickets/${ticketId}.json`, { method: "PUT", body: { ticket: { custom_fields: [{ id: TITLE_FIELD_ID, value: titulo }] } } });
  return NextResponse.json({ ok: true, titulo });
}

function secretsMatch(provided: string | null, expected: string): boolean {
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
