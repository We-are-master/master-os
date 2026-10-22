/**
 * Regras v2 das plataformas na criação do job (plano do dono, 22/10/2026).
 *
 * Tudo aqui é chamado por /api/jobs e só muda alguma coisa quando a conta tem
 * `regras.v2 === true` (PROCESSOS_V2=on + process_rules.v2). Fora disso as
 * funções devolvem exatamente o comportamento de antes.
 *
 *  - origem (jobs.source) da plataforma quando quem chamou não mandou;
 *  - Express: preço e custo do parceiro não são inventados (pendência aparece);
 *  - Housekeep: o mesmo booking em dois tickets é UM job (report_link é a chave);
 *  - cliente que já veio por uma plataforma e agora contrata a Fixfy é o MESMO
 *    cadastro (e-mail ou telefone provam; nome sozinho nunca junta ninguém).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const CONTA_EXPRESS = "38b48520-f116-4263-90e5-8cd5a7d39ecf";
export const CONTA_HOUSEKEEP = "9659bbfb-eb56-4a31-9773-7f5e1335d0b4";
export const CONTA_FANTASTIC = "3da39c93-4456-4ab1-9bcc-4e87d9564dbd";
export const CONTA_FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";

const ORIGEM_DA_PLATAFORMA: Record<string, string> = {
  [CONTA_EXPRESS]: "checkatrade_express",
  [CONTA_HOUSEKEEP]: "housekeep",
  [CONTA_FANTASTIC]: "fantastic",
};

const mesmo = (a: string | null | undefined, b: string) => String(a ?? "").trim().toLowerCase() === b;

export const ehExpress = (contaId: string | null | undefined) => mesmo(contaId, CONTA_EXPRESS);
export const ehHousekeep = (contaId: string | null | undefined) => mesmo(contaId, CONTA_HOUSEKEEP);

/** jobs.source (só v2): a que veio no pedido; senão a da plataforma; senão nada. */
export function origemDoJob(contaId: string, v2: boolean, origemPedida?: string | null): string | null {
  if (!v2) return null;
  const pedida = String(origemPedida ?? "").trim();
  if (pedida) return pedida;
  return ORIGEM_DA_PLATAFORMA[String(contaId).trim().toLowerCase()] ?? null;
}

/**
 * A conta e a origem que o job novo grava. A conta é SEMPRE a que contrata
 * (account_id do pedido), mesmo quando o cliente reaproveitado veio de outra.
 */
export function camposDaContaDoJob(contaId: string, v2: boolean, origemPedida?: string | null): { account_id: string; source?: string } {
  const origem = origemDoJob(contaId, v2, origemPedida);
  return origem ? { account_id: contaId, source: origem } : { account_id: contaId };
}

/**
 * Preço fixo do job.
 *
 * Antes (e fora do v2): sem custo do parceiro, o custo vira o preço menos a
 * margem alvo (40%). No Express v2 isso é inventar número: o custo fica nulo e
 * a pendência partner_cost_missing aparece; preço que não veio também fica nulo
 * (price_missing), nunca estimado.
 */
export function precoFixoDoJob(i: {
  contaId: string;
  v2: boolean;
  clientPrice: number;
  clientPriceSent: boolean;
  partnerCost: number;
  partnerCostSent: boolean;
  /** O custo estimado pela margem alvo (resolveFixedManualPricing). */
  partnerCostEstimado: number;
}): { clientPrice: number | null; partnerCost: number | null; estimado: boolean } {
  if (i.v2 && ehExpress(i.contaId)) {
    return {
      clientPrice: i.clientPriceSent && i.clientPrice > 0 ? i.clientPrice : null,
      partnerCost: i.partnerCostSent ? i.partnerCost : null,
      estimado: false,
    };
  }
  return {
    clientPrice: i.clientPrice,
    partnerCost: i.partnerCostEstimado,
    estimado: !i.partnerCostSent && i.partnerCostEstimado !== i.partnerCost,
  };
}

/**
 * Procura por report_link mesmo com ticket? Sem ticket, sempre (o caminho de
 * antes do Ruben). Com ticket, só Housekeep v2: o mesmo card chega em dois
 * e-mails, e cada e-mail vira um ticket.
 */
export function deduplicarPorReportLink(i: { ticketId: string | null; reportLink: string | null; contaId: string; v2: boolean }): boolean {
  if (!i.reportLink) return false;
  if (!i.ticketId) return true;
  return i.v2 && ehHousekeep(i.contaId);
}

export type JobExistente = { id: string; reference: string; status: string; report_link: string | null };

/** O job que já existe para este pedido: pelo ticket e, quando vale, pelo report_link. */
export async function acharJobExistente(
  sb: SupabaseClient,
  i: { ticketId: string | null; reportLink: string | null; porReportLink: boolean },
): Promise<JobExistente | null> {
  if (i.ticketId) {
    const { data } = await sb
      .from("jobs")
      .select("id, reference, status, report_link")
      .eq("external_source", "zendesk")
      .eq("external_ref", i.ticketId)
      .maybeSingle();
    if (data) return data as JobExistente;
  }
  if (i.porReportLink && i.reportLink) {
    const { data } = await sb
      .from("jobs")
      .select("id, reference, status, report_link")
      .eq("report_link", i.reportLink)
      .is("deleted_at", null)
      .order("created_at", { ascending: true })
      .limit(1);
    const linha = (data ?? [])[0] as JobExistente | undefined;
    if (linha) return linha;
  }
  return null;
}

/* ===================== cliente entre contas ===================== */

export type ClienteCandidato = {
  id: string;
  full_name: string | null;
  email: string | null;
  phone: string | null;
  source_account_id: string | null;
  created_at?: string | null;
};

export function emailNormalizado(e: string | null | undefined): string | null {
  const t = String(e ?? "").trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t)) return null;
  if (/@getfixfy\.com$/.test(t)) return null;
  return t;
}

/** Os últimos 10 dígitos (07700 900123 e +44 7700 900123 viram o mesmo). Menos que 10: null. */
export function telefoneNormalizado(t: string | null | undefined): string | null {
  const d = String(t ?? "").replace(/\D/g, "");
  return d.length >= 10 ? d.slice(-10) : null;
}

const palavras = (n: string | null | undefined) =>
  String(n ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z]+/)
    .filter((p) => p.length >= 2);

/**
 * Os dois nomes podem ser a mesma pessoa? Nome não junta ninguém, só veta: com
 * os dois preenchidos e nenhuma palavra em comum, e-mail ou telefone iguais são
 * um telefone de família ou de imobiliária, não o mesmo cliente.
 */
export function nomesCompativeis(a: string | null | undefined, b: string | null | undefined): boolean {
  const x = palavras(a);
  const y = new Set(palavras(b));
  if (x.length === 0 || y.size === 0) return true;
  return x.some((p) => y.has(p));
}

/**
 * O cliente que já existe, em QUALQUER conta, para este e-mail ou telefone.
 *
 * Ordem: o da conta que contrata (se houver), depois e-mail e telefone
 * batendo, depois só e-mail, depois só telefone; empate, o mais antigo.
 * Cadastro que é placeholder de empresa (nome = nome de uma conta) não serve.
 */
export function escolherClienteEntreContas(
  candidatos: ClienteCandidato[],
  i: { email: string | null; telefone: string | null; nome: string; contaId: string; nomesProibidos?: string[] },
): ClienteCandidato | null {
  const email = emailNormalizado(i.email);
  const fone = telefoneNormalizado(i.telefone);
  if (!email && !fone) return null;
  const proibidos = new Set((i.nomesProibidos ?? []).map((n) => n.trim().toLowerCase()).filter(Boolean));
  const pontuados = candidatos
    .map((c) => {
      const bateEmail = !!email && emailNormalizado(c.email) === email;
      const bateFone = !!fone && telefoneNormalizado(c.phone) === fone;
      return { c, bateEmail, bateFone };
    })
    .filter(({ c, bateEmail, bateFone }) => {
      if (!c.id || !(bateEmail || bateFone)) return false;
      if (proibidos.has(String(c.full_name ?? "").trim().toLowerCase())) return false;
      return nomesCompativeis(c.full_name, i.nome);
    })
    .map(({ c, bateEmail, bateFone }) => ({
      c,
      pontos: (mesmo(c.source_account_id, String(i.contaId).trim().toLowerCase()) ? 8 : 0) + (bateEmail ? 2 : 0) + (bateFone ? 1 : 0) + (bateEmail && bateFone ? 2 : 0),
    }));
  pontuados.sort((a, b) => b.pontos - a.pontos || Date.parse(a.c.created_at ?? "") - Date.parse(b.c.created_at ?? ""));
  return pontuados[0]?.c ?? null;
}

/** `7700900123` → `%7%7%0%0%9%0%0%1%2%3`: casa o número com qualquer espaço ou traço no meio. */
export function padraoDoTelefone(ultimos10: string): string {
  return `%${ultimos10.split("").join("%")}`;
}

/**
 * Busca no banco e escolhe. Não muda nada no cliente achado (source_account_id
 * fica como está): a conta que contrata vai em jobs.account_id.
 */
export async function acharClienteEntreContas(
  sb: SupabaseClient,
  i: { email: string | null; telefone: string | null; nome: string; contaId: string; nomesProibidos?: string[] },
): Promise<ClienteCandidato | null> {
  const email = emailNormalizado(i.email);
  const fone = telefoneNormalizado(i.telefone);
  if (!email && !fone) return null;
  const colunas = "id, full_name, email, phone, source_account_id, created_at";
  const linhas: ClienteCandidato[] = [];
  if (email) {
    const { data, error } = await sb.from("clients").select(colunas).ilike("email", email).is("deleted_at", null).order("created_at", { ascending: true }).limit(20);
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as ClienteCandidato[]));
  }
  if (fone) {
    const { data, error } = await sb.from("clients").select(colunas).ilike("phone", padraoDoTelefone(fone)).is("deleted_at", null).order("created_at", { ascending: true }).limit(20);
    if (error) throw new Error(error.message);
    linhas.push(...((data ?? []) as ClienteCandidato[]));
  }
  const unicos = [...new Map(linhas.map((l) => [l.id, l])).values()];
  return escolherClienteEntreContas(unicos, i);
}
