/**
 * Quando um job pode entrar em Scheduled (plano do dono, 22/10/2026, etapa 4).
 *
 * Conta direct com os fluxos novos ligados (regras.v2) e `agendarSoComSinal`: o job
 * só entra em Scheduled com parceiro, data confirmada e sinal pago. Pagamento
 * completo (finance_status = paid, a reserva do site que nasce paga) dispensa o
 * sinal. Plataforma e B2B nunca são barradas aqui.
 *
 * A mesma regra mora no banco (migration 347, gatilho em jobs): esta função é para
 * a tela e as rotinas explicarem ANTES de tentar, o gatilho é a trava de verdade.
 * Os dois precisam dizer a mesma coisa; se mudar um, mude o outro.
 */
import type { RegrasDoProcesso } from "@/lib/processo/conta";

export type JobParaAgendar = {
  partner_id?: string | null;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  customer_deposit?: number | string | null;
  customer_deposit_paid?: boolean | null;
  finance_status?: string | null;
  payment_status?: string | null;
};

export type FaltaParaAgendar = "partner" | "confirmed_date" | "deposit";

export const ROTULO_DA_FALTA: Record<FaltaParaAgendar, string> = {
  partner: "a partner",
  confirmed_date: "a confirmed date",
  deposit: "the deposit paid",
};

export type ResultadoDoAgendamento = { pode: true; faltando: [] } | { pode: false; faltando: FaltaParaAgendar[]; mensagem: string };

/** A regra vale para esta conta? Igual ao gatilho: v2, direct e agendarSoComSinal. */
export function exigeSinalParaAgendar(regras: Pick<RegrasDoProcesso, "v2" | "tipo" | "agendarSoComSinal"> | null | undefined): boolean {
  return !!regras && regras.v2 === true && regras.tipo === "direct" && regras.agendarSoComSinal === true;
}

export function mensagemDoAgendamento(faltando: FaltaParaAgendar[], referencia?: string | null): string {
  const lista = faltando.map((f) => ROTULO_DA_FALTA[f]);
  const juntos = lista.length > 1 ? `${lista.slice(0, -1).join(", ")} and ${lista[lista.length - 1]}` : lista[0] ?? "";
  return `${referencia ? `${referencia} ` : "This job "}cannot be scheduled yet: it needs ${juntos}.`;
}

export function podeAgendar(
  job: JobParaAgendar,
  regras: Pick<RegrasDoProcesso, "v2" | "tipo" | "agendarSoComSinal"> | null | undefined,
  referencia?: string | null,
): ResultadoDoAgendamento {
  if (!exigeSinalParaAgendar(regras)) return { pode: true, faltando: [] };
  const faltando: FaltaParaAgendar[] = [];
  if (!String(job.partner_id ?? "").trim()) faltando.push("partner");
  if (!job.scheduled_date && !job.scheduled_start_at) faltando.push("confirmed_date");
  const pago = (job.finance_status ?? job.payment_status) === "paid";
  if (!pago && job.customer_deposit_paid !== true) faltando.push("deposit");
  if (!faltando.length) return { pode: true, faltando: [] };
  return { pode: false, faltando, mensagem: mensagemDoAgendamento(faltando, referencia) };
}
