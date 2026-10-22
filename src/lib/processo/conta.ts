/**
 * O processo de cada conta, num lugar só (plano do dono, 22/10/2026, item 11).
 *
 * A decisão vai nesta ordem: tipo da conta (accounts.process_type, migration 341)
 * → exceções da conta (accounts.process_rules) → características do pedido (quem
 * chama). A origem (jobs.source) serve para atribuição e análise; nunca troca a
 * regra.
 *
 *   direct    a Fixfy vende: quote, sinal, cobrança do saldo, lembrete, report e
 *             feedback são nossos (Fixfy, Checkatrade de clientes diretos).
 *   platform  a plataforma vende e paga a Fixfy: nada de sinal nem cobrança ao
 *             cliente; feedback só depois que a plataforma pagou.
 *   b2b       empresa por fatura: depois do reconhecimento, atendimento humano.
 *
 * Nesta etapa nada lê `regrasDoProcesso` para mudar comportamento: o módulo
 * existe para os fluxos das etapas 3 a 5 e para a fila de pendências.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export type TipoDeProcesso = "direct" | "platform" | "b2b";

/** As mesmas contas da migration 341, para quando a coluna não vier na leitura. */
const TIPO_PELO_ID: Record<string, TipoDeProcesso> = {
  "5cf896ec-ee42-441b-a698-34fdaeeb28b3": "direct", // Fixfy
  "8060fcf3-a538-4e5a-9318-1b49ee59f432": "direct", // Checkatrade (clientes diretos)
  "38b48520-f116-4263-90e5-8cd5a7d39ecf": "platform", // Express
  "9659bbfb-eb56-4a31-9773-7f5e1335d0b4": "platform", // Housekeep
  "3da39c93-4456-4ab1-9bcc-4e87d9564dbd": "platform", // Fantastic Services
};

export type RegrasDoProcesso = {
  tipo: TipoDeProcesso;
  /** Quem conduz a quote depois do pedido: o sistema (Harvey e parceiros) ou só gente. */
  conducaoDaQuote: "automatica" | "humana";
  /** Só entra em Scheduled com o sinal pago (fluxo Fixfy com sinal). */
  agendarSoComSinal: boolean;
  /** Cobra sinal e saldo do cliente (cartão salvo, link). */
  cobraDoCliente: boolean;
  /** Quando o pedido de feedback pode sair. */
  feedback: "depois_da_conclusao" | "depois_do_pagamento_da_plataforma" | "nunca";
  /** Lembrete, welcome e mensagens de serviço ao cliente final. */
  mensagensAoCliente: boolean;
  /** Canais permitidos com o cliente (Housekeep é 100% e-mail). */
  canais: Array<"email" | "whatsapp">;
};

const PADRAO: Record<TipoDeProcesso, Omit<RegrasDoProcesso, "tipo">> = {
  direct: { conducaoDaQuote: "automatica", agendarSoComSinal: true, cobraDoCliente: true, feedback: "depois_da_conclusao", mensagensAoCliente: true, canais: ["email", "whatsapp"] },
  platform: { conducaoDaQuote: "automatica", agendarSoComSinal: false, cobraDoCliente: false, feedback: "depois_do_pagamento_da_plataforma", mensagensAoCliente: true, canais: ["email", "whatsapp"] },
  b2b: { conducaoDaQuote: "humana", agendarSoComSinal: false, cobraDoCliente: false, feedback: "nunca", mensagensAoCliente: false, canais: ["email"] },
};

/** Exceções aceitas em accounts.process_rules. Chave desconhecida é ignorada. */
export type ExcecoesDaConta = Partial<{
  b2b_human_only: boolean;
  schedule_requires_deposit: boolean;
  feedback: RegrasDoProcesso["feedback"];
  client_messages: boolean;
  channels: Array<"email" | "whatsapp">;
}>;

export function tipoDaConta(conta: { id?: string | null; process_type?: string | null } | null | undefined): TipoDeProcesso | null {
  const t = String(conta?.process_type ?? "").trim();
  if (t === "direct" || t === "platform" || t === "b2b") return t;
  const id = String(conta?.id ?? "").trim().toLowerCase();
  return TIPO_PELO_ID[id] ?? null;
}

export function regrasDoProcesso(tipo: TipoDeProcesso, excecoes: ExcecoesDaConta | null | undefined = {}): RegrasDoProcesso {
  const r: RegrasDoProcesso = { tipo, ...PADRAO[tipo], canais: [...PADRAO[tipo].canais] };
  const e = excecoes ?? {};
  if (typeof e.b2b_human_only === "boolean") r.conducaoDaQuote = e.b2b_human_only ? "humana" : "automatica";
  if (typeof e.schedule_requires_deposit === "boolean") r.agendarSoComSinal = e.schedule_requires_deposit;
  if (e.feedback === "depois_da_conclusao" || e.feedback === "depois_do_pagamento_da_plataforma" || e.feedback === "nunca") r.feedback = e.feedback;
  if (typeof e.client_messages === "boolean") r.mensagensAoCliente = e.client_messages;
  if (Array.isArray(e.channels)) {
    const canais = e.channels.filter((c): c is "email" | "whatsapp" => c === "email" || c === "whatsapp");
    if (canais.length) r.canais = canais;
  }
  return r;
}

type LinhaDaConta = { id: string; process_type: string | null; process_rules: ExcecoesDaConta | null };

/** As regras de uma conta pelo banco. Conta desconhecida ou sem leitura: null (quem chama decide, nunca supõe). */
export async function processoDaConta(sb: SupabaseClient, contaId: string | null | undefined): Promise<RegrasDoProcesso | null> {
  const id = String(contaId ?? "").trim();
  if (!id) return null;
  const { data } = await sb.from("accounts").select("id, process_type, process_rules").eq("id", id).maybeSingle<LinhaDaConta>();
  const tipo = tipoDaConta(data ?? { id });
  return tipo ? regrasDoProcesso(tipo, data?.process_rules ?? null) : null;
}

/** A conta que contratou o job: jobs.account_id (migration 342), senão a do cliente. */
export async function contaDoJob(sb: SupabaseClient, job: { account_id?: string | null; client_id?: string | null }): Promise<string | null> {
  if (job.account_id) return job.account_id;
  if (!job.client_id) return null;
  const { data } = await sb.from("clients").select("source_account_id").eq("id", job.client_id).maybeSingle<{ source_account_id: string | null }>();
  return data?.source_account_id ?? null;
}
