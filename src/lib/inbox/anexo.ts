/**
 * O "Attach job or quote" do composer da /inbox: acha o job ou a quote e monta o
 * texto que entra na caixa (quem envia é a pessoa). Job: nome, endereço,
 * telefone, data, scope, valor e link. Quote: endereço, scope e link.
 *
 * O valor segue quem está na conversa: parceiro vê o que ele recebe, cliente e
 * conta o que pagam, lead nada. O seletor pode trocar. Link: parceiro ganha o
 * do report (curto, só se o job é dele e falta o report); conta ganha o do
 * portal (/portal/jobs, /portal/quotes) quando o job ou a quote é de uma conta
 * que não é a Fixfy.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { appBaseUrl } from "@/lib/app-base-url";
import { buildPartnerJobReportUrl } from "@/lib/partner-job-report-url";
import { dataPorExtenso, janelaDeChegada } from "@/lib/client-confirmation/send";
import { fixfyAccountId } from "@/lib/certificado/regra";

export type ValorDoAnexo = "cliente" | "parceiro" | "nenhum";

export type ItemDaBusca = { tipo: "job" | "quote"; id: string; ref: string; titulo: string | null; endereco: string | null; data: string | null; status: string };

const libras = (n: number) => `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : typeof v === "string" && Number(v) > 0 ? Number(v) : null);
const limpo = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);
/** Busca no ilike: tira o que o PostgREST lê como sintaxe do `or`. */
const termo = (q: string) => q.replace(/[%,()*\\]/g, " ").trim().slice(0, 60);

const CAMPOS_JOB = "id, reference, title, property_address, scheduled_date, status, created_at";
const CAMPOS_QUOTE = "id, reference, title, property_address, status, created_at";

export async function buscarParaAnexar(sb: SupabaseClient, corpo: Record<string, unknown>): Promise<ItemDaBusca[]> {
  const q = termo(String(corpo.q ?? ""));
  const parceiroId = limpo(corpo.parceiroId);
  const clienteId = limpo(corpo.clienteId);

  // Jobs pela data marcada, a mais distante primeiro: o que vem pela frente aparece antes do histórico.
  let jobs = sb
    .from("jobs")
    .select(CAMPOS_JOB)
    .is("deleted_at", null)
    .order("scheduled_date", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(8);
  let quotes = sb.from("quotes").select(CAMPOS_QUOTE).is("deleted_at", null).order("created_at", { ascending: false }).limit(6);
  if (q) {
    const ou = `reference.ilike.%${q}%,client_name.ilike.%${q}%,property_address.ilike.%${q}%,title.ilike.%${q}%`;
    jobs = jobs.or(ou);
    quotes = quotes.or(ou);
  } else if (parceiroId) {
    // Sem busca: o que é de quem está na conversa. Parceiro não tem quote dele aqui.
    jobs = jobs.eq("partner_id", parceiroId);
    quotes = quotes.eq("partner_id", parceiroId);
  } else if (clienteId) {
    jobs = jobs.eq("client_id", clienteId);
    quotes = quotes.eq("client_id", clienteId);
  } else {
    return [];
  }

  const [j, qt] = await Promise.all([jobs, quotes]);
  const itens: ItemDaBusca[] = [
    ...(j.data ?? []).map((r) => ({
      tipo: "job" as const,
      id: r.id as string,
      ref: (r.reference as string | null) ?? "Job",
      titulo: (r.title as string | null) ?? null,
      endereco: (r.property_address as string | null) ?? null,
      data: (r.scheduled_date as string | null) ?? null,
      status: (r.status as string | null) ?? "",
    })),
    ...(qt.data ?? []).map((r) => ({
      tipo: "quote" as const,
      id: r.id as string,
      ref: (r.reference as string | null) ?? "Quote",
      titulo: (r.title as string | null) ?? null,
      endereco: (r.property_address as string | null) ?? null,
      data: null,
      status: (r.status as string | null) ?? "",
    })),
  ];
  return itens;
}

/** Conta de verdade (não a Fixfy direct) ganha o link do portal. */
const daConta = (contaId: string | null) => Boolean(contaId && contaId !== fixfyAccountId());

export async function textoDoJob(
  sb: SupabaseClient,
  id: string,
  valor: ValorDoAnexo,
  parceiroId: string | null,
): Promise<string | null> {
  const { data: j } = await sb
    .from("jobs")
    .select(
      "id, reference, title, client_id, client_name, property_address, scheduled_date, scheduled_start_at, scheduled_end_at, scope, job_type, status, partner_id, report_submitted, account_id, total_client_price, client_price, total_partner_cost, partner_cost, hourly_client_rate, hourly_partner_rate",
    )
    .eq("id", id)
    .maybeSingle();
  if (!j) return null;

  const { data: cli } = j.client_id ? await sb.from("clients").select("phone").eq("id", j.client_id).maybeSingle() : { data: null };
  const porHora = j.job_type === "hourly";
  const quando = [dataPorExtenso(j.scheduled_date as string | null), janelaDeChegada(j.scheduled_start_at as string | null, j.scheduled_end_at as string | null)]
    .filter(Boolean)
    .join(", arriving ");

  let linhaValor: string | null = null;
  if (valor === "cliente") {
    const h = num(j.hourly_client_rate);
    const t = num(j.total_client_price) ?? num(j.client_price);
    linhaValor = porHora && h ? `Price: ${libras(h)}/h` : t ? `Price: ${libras(t)}` : null;
  } else if (valor === "parceiro") {
    const h = num(j.hourly_partner_rate);
    const t = num(j.total_partner_cost) ?? num(j.partner_cost);
    linhaValor = porHora && h ? `You get: ${libras(h)}/h` : t ? `You get: ${libras(t)}` : null;
  }

  let link: string | null = null;
  if (valor === "parceiro" && parceiroId && j.partner_id === parceiroId && !j.report_submitted && !["cancelled", "deleted"].includes(String(j.status))) {
    link = `Report: ${await buildPartnerJobReportUrl(j.id as string, parceiroId)}`;
  } else if (valor === "cliente" && daConta(j.account_id as string | null)) {
    link = `Portal: ${appBaseUrl()}/portal/jobs/${j.id}`;
  }

  const scope = limpo(j.scope);
  return [
    `*${j.reference ?? "Job"}*${limpo(j.title) ? ` · ${limpo(j.title)}` : ""}`,
    limpo(j.client_name) ? `Name: ${limpo(j.client_name)}` : null,
    limpo(j.property_address) ? `Address: ${limpo(j.property_address)}` : null,
    limpo(cli?.phone) ? `Contact: ${limpo(cli?.phone)}` : null,
    quando ? `Date: ${quando}` : null,
    scope ? `Scope:\n${scope}` : null,
    linhaValor,
    link,
  ]
    .filter(Boolean)
    .join("\n");
}

export async function textoDaQuote(sb: SupabaseClient, id: string, valor: ValorDoAnexo): Promise<string | null> {
  const { data: q } = await sb.from("quotes").select("id, reference, title, property_address, postcode, scope, description, source_account_id").eq("id", id).maybeSingle();
  if (!q) return null;
  const endereco = limpo(q.property_address) ?? limpo(q.postcode);
  const scope = limpo(q.scope) ?? limpo(q.description);
  const link = valor === "cliente" && daConta(q.source_account_id as string | null) ? `Portal: ${appBaseUrl()}/portal/quotes/${q.id}` : null;
  return [
    `*${q.reference ?? "Quote"}*${limpo(q.title) ? ` · ${limpo(q.title)}` : ""}`,
    endereco ? `Address: ${endereco}` : null,
    scope ? `Scope:\n${scope}` : null,
    link,
  ]
    .filter(Boolean)
    .join("\n");
}

