/**
 * Botão Call da /inbox. O Zendesk Talk não tem API para discar, então a
 * ligação sai do próprio Talk: achamos a pessoa no Zendesk pelo telefone e
 * devolvemos o perfil dela (o número ali é clicável e disca pelo Talk). Sem
 * cadastro no Zendesk, devolve o painel do agente e a tela copia o número.
 * POST com o número no corpo para não deixar telefone em URL.
 *
 * Parceiro tem um ticket só de ligações (partners.zendesk_ticket_id): o Call
 * abre sempre esse. Sem ticket ainda, a tela confirma e manda `criar`; o
 * ticket nasce com nota interna, então o Zendesk não manda e-mail ao parceiro.
 */

import { NextRequest, NextResponse } from "next/server";
import { staffDaInbox } from "@/lib/inbox/staff";
import { createTicket, isZendeskConfigured, zendeskApi } from "@/lib/zendesk";

export const dynamic = "force-dynamic";

type UsuarioZd = { id: number; name: string; phone: string | null; role: string };

export async function POST(req: NextRequest) {
  const s = await staffDaInbox();
  if (s instanceof NextResponse) return s;
  const { numero, parceiroId, criar } = (await req.json().catch(() => ({}))) as { numero?: unknown; parceiroId?: unknown; criar?: unknown };
  const dig = String(numero ?? "").replace(/\D/g, "");
  if (dig.length < 10) return NextResponse.json({ error: "Invalid number" }, { status: 400 });

  const sub = process.env.ZENDESK_SUBDOMAIN?.trim();
  if (!sub || !isZendeskConfigured()) return NextResponse.json({ error: "Zendesk not configured" }, { status: 503 });

  if (typeof parceiroId === "string" && parceiroId) {
    const { data: p, error } = await s.sb
      .from("partners")
      .select("id, company_name, contact_name, email, zendesk_ticket_id")
      .eq("id", parceiroId)
      .maybeSingle();
    if (error) return NextResponse.json({ error: "Partner call tickets need migration 355" }, { status: 409 });
    if (!p) return NextResponse.json({ error: "Partner not found" }, { status: 404 });
    const abrir = (id: unknown) => NextResponse.json({ url: `https://${sub}.zendesk.com/agent/tickets/${id}`, ticket: String(id), achado: true, nome: p.company_name ?? p.contact_name });
    if (p.zendesk_ticket_id) return abrir(p.zendesk_ticket_id);
    if (criar !== true) return NextResponse.json({ semTicket: true });
    const email = String(p.email ?? "").trim();
    if (!email) return NextResponse.json({ error: "This partner has no email, Zendesk needs one for the ticket" }, { status: 422 });
    const nome = (p.company_name as string | null) || (p.contact_name as string | null) || "Partner";
    const t = await createTicket({
      subject: `Calls · ${nome}`,
      commentBody: `Call log for ${nome} (+${dig}). Every call from the OS inbox opens this ticket.`,
      publicComment: false,
      requesterEmail: email,
      requesterName: (p.contact_name as string | null) ?? nome,
      tags: ["parceiro", "ligacoes"],
      externalId: `partner-calls-${p.id}`,
    });
    if (!t.ok || !t.id) return NextResponse.json({ error: t.error ?? "Could not create the ticket" }, { status: 502 });
    await s.sb.from("partners").update({ zendesk_ticket_id: t.id }).eq("id", p.id);
    return abrir(t.id);
  }
  const painel = `https://${sub}.zendesk.com/agent/dashboard`;

  // O Zendesk guarda o telefone como veio: +44..., 44... ou 07... no UK.
  const formas = [`+${dig}`, dig, ...(dig.startsWith("44") ? [`0${dig.slice(2)}`] : [])];
  for (const f of formas) {
    try {
      const r = await zendeskApi<{ users?: UsuarioZd[] }>(`users/search.json?query=${encodeURIComponent(f)}`);
      const u = (r.users ?? []).find((x) => String(x.phone ?? "").replace(/\D/g, "").endsWith(dig.slice(-9)));
      if (u) return NextResponse.json({ url: `https://${sub}.zendesk.com/agent/users/${u.id}/requested_tickets`, nome: u.name, achado: true });
    } catch (e) {
      console.error("[inbox/ligar]", e instanceof Error ? e.message : e);
      break;
    }
  }
  return NextResponse.json({ url: painel, achado: false });
}
