import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth-api";
import { createServiceClient } from "@/lib/supabase/service";
import { createTicket } from "@/lib/zendesk";
import { buildAccountWelcomeEmail } from "@/lib/emails/account-welcome";
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
    .select("id, company_name, contact_name, email, deleted_at")
    .eq("id", id)
    .maybeSingle();
  if (!conta || conta.deleted_at) return null;
  const email = buildAccountWelcomeEmail({ empresa: conta.company_name, contato: conta.contact_name });
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
