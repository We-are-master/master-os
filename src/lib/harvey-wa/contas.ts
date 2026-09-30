/**
 * O que o Harvey conta no WhatsApp sobre o que já existe no OS:
 *  - cliente: as reservas dele (dia, janela, situação, quanto falta pagar e o link)
 *  - parceiro: situação do cadastro, documentos que faltam e os próximos jobs
 *
 * Só dado do próprio dono do telefone. Parceiro nunca vê telefone nem e-mail do cliente.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getCoreComplianceBreakdown, type PartnerDocLike } from "@/lib/partner-required-docs";
import { chaveDoTelefone, type Parceiro } from "./identidade";

const TZ = "Europe/London";
const dia = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" }).format(new Date(iso)) : null);
const hora = (iso: string | null) => (iso ? new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "numeric", minute: "2-digit", hour12: true }).format(new Date(iso)).replace(":00", "") : null);

/** A situação do job em palavras de cliente. */
function situacaoParaCliente(status: string, temParceiro: boolean): string {
  switch (status) {
    case "unassigned":
    case "auto_assigning":
      return "booked, we are confirming the professional";
    case "scheduled":
    case "late":
      return temParceiro ? "confirmed, professional assigned" : "confirmed";
    case "in_progress":
      return "in progress today";
    case "final_check":
      return "done, our team is checking the report";
    case "awaiting_payment":
      return "done, balance to pay";
    case "completed":
      return "completed";
    case "on_hold":
    case "need_attention":
      return "on hold, the team is looking at it";
    case "cancelled":
      return "cancelled";
    default:
      return status.replace(/_/g, " ");
  }
}

const CAMPOS_JOB =
  "id, reference, title, status, partner_id, partner_name, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, client_price, total_client_price, payment_status, invoice_id, client_id";

type LinhaJob = {
  id: string;
  reference: string;
  title: string | null;
  status: string;
  partner_id: string | null;
  partner_name: string | null;
  property_address: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  scheduled_end_at: string | null;
  client_price: number | null;
  total_client_price: number | null;
  payment_status: string | null;
  invoice_id: string | null;
};

/** As reservas de quem escreve: pelos clientes com esse telefone e, se ele disser, pelo e-mail. */
export async function reservasDoCliente(sb: SupabaseClient, a: { telefone: string | null; email?: string | null; clienteId?: string | null }) {
  const ids = new Set<string>();
  if (a.clienteId) ids.add(a.clienteId);
  const chave = chaveDoTelefone(a.telefone);
  if (chave) {
    const fim = chave.slice(-4);
    const { data } = await sb.from("clients").select("id, phone").ilike("phone", `%${fim.slice(0, 2)}%${fim.slice(2)}`).limit(200);
    for (const c of data ?? []) if (chaveDoTelefone(c.phone as string) === chave) ids.add(c.id as string);
  }
  if (a.email?.includes("@")) {
    const { data } = await sb.from("clients").select("id").ilike("email", a.email.trim()).limit(5);
    for (const c of data ?? []) ids.add(c.id as string);
  }
  if (!ids.size) return { encontrado: false, reservas: [] as unknown[], note: "No bookings found for this number. Ask for the email they booked with, or the booking reference." };

  const desde = new Date(Date.now() - 45 * 86_400_000).toISOString().slice(0, 10);
  const { data: jobs } = await sb
    .from("jobs")
    .select(CAMPOS_JOB)
    .in("client_id", [...ids])
    .is("deleted_at", null)
    .neq("status", "deleted")
    .or(`scheduled_date.gte.${desde},scheduled_date.is.null`)
    .order("scheduled_date", { ascending: true })
    .limit(10);
  const lista = (jobs ?? []) as LinhaJob[];
  const faturas = new Map<string, { reference: string; amount: number; amount_paid: number | null; status: string; stripe_payment_link_url: string | null }>();
  const invIds = lista.map((j) => j.invoice_id).filter(Boolean) as string[];
  if (invIds.length) {
    const { data } = await sb.from("invoices").select("id, reference, amount, amount_paid, status, stripe_payment_link_url").in("id", invIds);
    for (const f of data ?? []) faturas.set(f.id as string, f as never);
  }
  return {
    encontrado: true,
    reservas: lista.map((j) => {
      const f = j.invoice_id ? faturas.get(j.invoice_id) : undefined;
      const falta = f && f.status !== "paid" && f.status !== "cancelled" ? Math.max(0, Number(f.amount) - Number(f.amount_paid ?? 0)) : 0;
      return {
        ref: j.reference,
        service: j.title,
        address: j.property_address,
        day: dia(j.scheduled_start_at) ?? j.scheduled_date,
        arrival: j.scheduled_start_at ? `${hora(j.scheduled_start_at)}${j.scheduled_end_at ? ` to ${hora(j.scheduled_end_at)}` : ""}` : null,
        status: situacaoParaCliente(j.status, !!j.partner_id),
        professional: j.partner_id && j.partner_name ? j.partner_name.split(" ")[0] : null,
        price: j.total_client_price ?? j.client_price,
        balanceDue: falta || null,
        payLink: falta && f?.stripe_payment_link_url ? f.stripe_payment_link_url : null,
      };
    }),
    note: "Only tell them about their own bookings. To move or cancel a booking, hand off to the team.",
  };
}

/** Situação do parceiro: status, documentos que faltam para ativar e os próximos jobs. */
export async function situacaoDoParceiro(sb: SupabaseClient, p: Parceiro) {
  const hoje = new Date().toISOString().slice(0, 10);
  const [{ data: docs }, { data: jobs }] = await Promise.all([
    sb.from("partner_documents").select("id, name, doc_type, status, expires_at, counts_toward_compliance, created_at").eq("partner_id", p.id),
    sb
      .from("jobs")
      .select("reference, title, status, property_address, scheduled_date, scheduled_start_at, scheduled_end_at")
      .eq("partner_id", p.id)
      .is("deleted_at", null)
      .gte("scheduled_date", hoje)
      .not("status", "in", "(cancelled,deleted,completed)")
      .order("scheduled_date", { ascending: true })
      .limit(8),
  ]);
  const lista = (docs ?? []) as PartnerDocLike[];
  const quebra = getCoreComplianceBreakdown(lista);
  const pendentes = lista.filter((d) => d.status === "pending").map((d) => d.name);
  const agora = new Date();
  const vencidos = lista.filter((d) => d.status === "approved" && d.expires_at && new Date(d.expires_at) < agora).map((d) => d.name);
  return {
    name: p.contact_name || p.company_name,
    accountStatus: p.status,
    canReceiveJobs: p.status === "active",
    documents: quebra.items.map((i) => ({ doc: i.label, ok: i.ok })),
    missingToActivate: quebra.items.filter((i) => !i.ok).map((i) => i.label),
    waitingReview: pendentes,
    expired: vencidos,
    upcomingJobs: ((jobs ?? []) as Array<Record<string, string | null>>).map((j) => ({
      ref: j.reference,
      service: j.title,
      address: j.property_address,
      day: dia(j.scheduled_start_at) ?? j.scheduled_date,
      arrival: j.scheduled_start_at ? `${hora(j.scheduled_start_at)}${j.scheduled_end_at ? ` to ${hora(j.scheduled_end_at)}` : ""}` : null,
    })),
    portal: "https://partners.getfixfy.com",
  };
}
