/**
 * Venda de lead do formulário da Meta volta para a Meta (Conversions API, "lead
 * de conversão"): a Meta passa a procurar gente parecida com quem COMPRA, não
 * com quem só preenche.
 *
 * Sem burocracia: não importa se pagou no Stripe ou por transferência (Monzo).
 * Os dois terminam em `job_payments` (o Stripe pelo webhook, a transferência
 * quando a equipe registra o pagamento no Financeiro). A varredura roda a cada
 * 10 min no cron do Harvey e olha só isso:
 *
 *   lead meta_form (90 dias) → job do mesmo cliente → algum pagamento do cliente
 *   → Purchase com o lead_id da Meta, valor do job, uma vez só
 *
 * O event_id é `Purchase-<referência do job>`, o mesmo do site e do WhatsApp,
 * então a Meta não conta a mesma venda duas vezes. A marca de enviado fica em
 * `leads.raw.compra_enviada` (sem migration).
 *
 * Variáveis: as mesmas do eventos-whatsapp.ts (META_WA_DATASET_ID, padrão Master
 * PX, que está ligado à página; META_CAPI_TOKEN ou WHATSAPP_TOKEN;
 * META_TEST_EVENT_CODE para testar).
 */

import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

const GRAPH = "https://graph.facebook.com/v23.0";
const MASTER_PX = "1555218078932742";
const JANELA_DIAS = 90;

const sha = (v: string) => createHash("sha256").update(v.trim().toLowerCase()).digest("hex");

type LeadDoFormulario = { id: string; client_id: string | null; email: string | null; phone: string | null; raw: Record<string, unknown> | null; created_at: string };

/** O corpo do evento de compra de um lead do formulário. */
export function eventoDeCompra(a: { leadgenId: string; referencia: string; valor: number; telefone?: string | null; email?: string | null; quando?: Date }): Record<string, unknown> {
  const digitos = String(a.telefone ?? "").replace(/\D/g, "");
  return {
    event_name: "Purchase",
    event_time: Math.floor((a.quando ?? new Date()).getTime() / 1000),
    event_id: `Purchase-${a.referencia}`,
    action_source: "system_generated",
    user_data: {
      lead_id: a.leadgenId,
      ...(digitos ? { ph: [sha(digitos)] } : {}),
      ...(a.email ? { em: [sha(a.email)] } : {}),
    },
    custom_data: {
      event_source: "crm",
      lead_event_source: "Fixfy OS",
      currency: "GBP",
      value: Math.round(a.valor * 100) / 100,
    },
  };
}

/** O cliente do lead e os outros cadastros com o mesmo telefone (9 últimos dígitos) ou e-mail. */
async function clientesDaPessoa(sb: SupabaseClient, l: LeadDoFormulario): Promise<string[]> {
  const ids = new Set<string>(l.client_id ? [l.client_id] : []);
  const digitos = String(l.phone ?? "").replace(/\D/g, "").slice(-9);
  if (digitos.length === 9) {
    const { data } = await sb.from("clients").select("id, phone").ilike("phone", `%${digitos.slice(-4)}`).is("deleted_at", null).limit(200);
    for (const c of data ?? []) if (String(c.phone ?? "").replace(/\D/g, "").endsWith(digitos)) ids.add(c.id as string);
  }
  if (l.email) {
    const { data } = await sb.from("clients").select("id").ilike("email", l.email.trim()).is("deleted_at", null).limit(10);
    for (const c of data ?? []) ids.add(c.id as string);
  }
  return [...ids];
}

export type ResultadoDaCompra = { olhados: number; enviados: number; detalhes: string[] };

export async function varrerComprasDoFormulario(
  sb: SupabaseClient,
  { aplicar = true, agora = new Date(), fazerFetch = fetch }: { aplicar?: boolean; agora?: Date; fazerFetch?: typeof fetch } = {},
): Promise<ResultadoDaCompra> {
  const out: ResultadoDaCompra = { olhados: 0, enviados: 0, detalhes: [] };
  const desde = new Date(agora.getTime() - JANELA_DIAS * 24 * 3600_000).toISOString();
  const { data, error } = await sb
    .from("leads")
    .select("id, client_id, email, phone, raw, created_at")
    .eq("source", "meta_form")
    .not("client_id", "is", null)
    .is("raw->>compra_enviada", null)
    .gte("created_at", desde)
    .limit(200);
  if (error) throw new Error(`compras do formulário: ${error.message}`);
  const leads = (data ?? []) as LeadDoFormulario[];
  out.olhados = leads.length;

  for (const l of leads) {
    const leadgenId = String(l.raw?.leadgen_id ?? "");
    if (!leadgenId || !l.client_id) continue;
    // O checkout do site ou do Harvey pode ter criado outro cadastro da mesma pessoa:
    // vale qualquer cliente com o mesmo telefone ou e-mail do lead.
    const clientes = await clientesDaPessoa(sb, l);
    const { data: jobs } = await sb
      .from("jobs")
      .select("id, reference, client_price, total_client_price, extras_amount")
      .in("client_id", clientes)
      // Só job que nasceu depois do formulário: compra antiga do mesmo cliente não conta para o anúncio.
      .gte("created_at", l.created_at)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(20);
    if (!jobs?.length) continue;
    const ids = jobs.map((j) => j.id as string);
    const { data: pagos } = await sb
      .from("job_payments")
      .select("job_id, amount")
      .in("job_id", ids)
      .in("type", ["customer_deposit", "customer_final"])
      .is("deleted_at", null);
    const pago = (pagos ?? []).find((p) => Number(p.amount ?? 0) > 0);
    if (!pago) continue;
    const job = jobs.find((j) => j.id === pago.job_id)!;
    const valor = Number(job.total_client_price ?? 0) || Number(job.client_price ?? 0) + Number(job.extras_amount ?? 0);
    out.detalhes.push(`${job.reference}: lead ${leadgenId}, £${valor}`);
    if (!aplicar) continue;

    const dataset = process.env.META_WA_DATASET_ID?.trim() || MASTER_PX;
    const token = process.env.META_CAPI_TOKEN?.trim() || process.env.WHATSAPP_TOKEN?.trim();
    if (!token) {
      out.detalhes.push("sem token (META_CAPI_TOKEN/WHATSAPP_TOKEN): nada enviado");
      break;
    }
    const corpo: Record<string, unknown> = {
      data: [eventoDeCompra({ leadgenId, referencia: String(job.reference), valor, telefone: l.phone, email: l.email, quando: agora })],
    };
    const teste = process.env.META_TEST_EVENT_CODE?.trim();
    if (teste) corpo.test_event_code = teste;
    const res = await fazerFetch(`${GRAPH}/${dataset}/events?access_token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(corpo),
    }).catch((e) => ({ ok: false, json: async () => ({ erro: String(e) }) }) as unknown as Response);
    const resposta = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.error(`[meta-form] compra ${job.reference} falhou`, JSON.stringify(resposta).slice(0, 300));
      out.detalhes.push(`${job.reference}: falhou`);
      continue;
    }
    await sb
      .from("leads")
      .update({ raw: { ...(l.raw ?? {}), compra_enviada: agora.toISOString(), compra_job: job.reference, compra_valor: valor } })
      .eq("id", l.id);
    out.enviados++;
  }
  return out;
}
