import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createTicket } from "@/lib/zendesk";
import { buildAccountWelcomeEmail, type PrecoCombinado } from "@/lib/emails/account-welcome";
import { confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Boas-vindas da conta (dono, 26/10/2026). GET devolve a prévia (html); POST manda uma vez
 * por conta: abre um ticket no Zendesk com o contato da conta como solicitante e o e-mail
 * como primeira mensagem, então a resposta dele cai ali. Repetir só com { force: true }.
 */
async function montar(id: string) {
  const sb = createServiceClient();
  const { data: conta } = await sb
    .from("accounts")
    .select("id, company_name, contact_name, email, payment_terms, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!conta || conta.deleted_at) return null;
  const { data: linhas } = await sb
    .from("account_service_prices")
    .select("use_standard, fixed_price, hourly_rate, default_hours, service_catalog(name, pricing_mode)")
    .eq("account_id", id)
    .is("deleted_at", null);
  const precos: PrecoCombinado[] = [];
  for (const l of (linhas ?? []) as unknown as Array<{ use_standard: boolean; fixed_price: number | null; hourly_rate: number | null; default_hours: number | null; service_catalog: { name: string; pricing_mode: string } | null }>) {
    if (l.use_standard || !l.service_catalog) continue;
    const hora = l.service_catalog.pricing_mode === "hourly";
    const valor = Number(hora ? l.hourly_rate : l.fixed_price) || 0;
    if (valor > 0) precos.push({ servico: l.service_catalog.name, modo: hora ? "hourly" : "fixed", valor, horasMinimas: hora ? l.default_hours : null });
  }
  const email = buildAccountWelcomeEmail({ empresa: conta.company_name, contato: conta.contact_name, precos, prazo: conta.payment_terms });
  return { sb, conta, email };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const m = await montar(id);
  if (!m) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  return new NextResponse(m.email.html, { headers: { "content-type": "text/html; charset=utf-8" } });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { id } = await params;
  const corpo = (await req.json().catch(() => ({}))) as { force?: boolean };
  const m = await montar(id);
  if (!m) return NextResponse.json({ error: "Account not found" }, { status: 404 });
  const para = String(m.conta.email ?? "").trim();
  if (!para.includes("@")) return NextResponse.json({ error: "This account has no email. Add the contact email first." }, { status: 400 });

  const chave = corpo.force ? `account-welcome:${id}:${Date.now()}` : `account-welcome:${id}`;
  const reserva = await reservarEnvio(m.sb, { chave, finalidade: "account-welcome", canal: "email", destinatario: para, motivo: "new account" });
  if (!reserva.reservado) return NextResponse.json({ error: "The welcome email was already sent to this account." }, { status: 409 });
  try {
    const t = await createTicket({
      subject: m.email.subject,
      htmlBody: m.email.html,
      publicComment: true,
      requesterEmail: para,
      requesterName: m.conta.contact_name ?? m.conta.company_name,
      tags: ["account_welcome"],
      externalId: `fixfy:account:${id}`,
    });
    if (!t.ok || !t.id) throw new Error(t.error ?? "Zendesk refused the ticket");
    await confirmarEnvio(m.sb, chave, String(t.id));
    return NextResponse.json({ ok: true, ticketId: t.id, to: para });
  } catch (e) {
    await falhouEnvio(m.sb, chave, e).catch(() => undefined);
    return NextResponse.json({ error: e instanceof Error ? e.message : "Send failed" }, { status: 502 });
  }
}
