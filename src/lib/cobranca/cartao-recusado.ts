/**
 * Cartão recusado: 7 dias de recuperação (plano do dono, 22/10/2026, etapa 4).
 *
 * Só conta direct com os fluxos novos (regras.v2) e que cobra do cliente. Job em
 * Awaiting Payment com o cartão recusado (ou pedindo confirmação do banco):
 *
 *   dia 1, 3 e 7 depois da 1ª recusa   e-mail ao cliente no ticket do job com o
 *                                      link /pay/<fatura>; chave
 *                                      `cobranca-cartao:<job>:<dia>`, um por dia
 *   pago (finance_status = paid)       para na hora: nada sai
 *   dia 7 em diante                    abre `payment_unsuccessful` (pendências),
 *                                      card_retry_at = null (acabam as tentativas
 *                                      automáticas) e nota interna "needs a person"
 *
 * Rodada perdida não acumula: no dia 4 sai só o e-mail do dia 3, não o do 1 junto.
 * Ensaio por padrão; mandar pede `aplicar` e CLIENT_MESSAGING_ENABLED=1. As novas
 * tentativas no cartão continuam na rota /api/internal/payments/card-retry.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { emailFixfy, saudacao } from "@/lib/emails/fixfy-shell";
import { processosV2Ligado, regrasDoProcesso, tipoDaConta, type RegrasDoProcesso, type ExcecoesDaConta } from "@/lib/processo/conta";
import { DIAS_ATE_PAGAMENTO_SEM_SUCESSO, motivosDoJob, sincronizarPendencias, type JobParaPendencias } from "@/lib/pendencias/motivos";
import { confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";
import { emailDoCliente } from "@/lib/um-ticket/escolha";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import type { AvisoNoTicket } from "@/lib/um-ticket/aviso-do-job";

/** Os dias de e-mail, contados da 1ª recusa. O último é o mesmo do payment_unsuccessful. */
export const DIAS_DA_COBRANCA = [1, 3, DIAS_ATE_PAGAMENTO_SEM_SUCESSO] as const;
export type DiaDaCobranca = (typeof DIAS_DA_COBRANCA)[number];

const DIA_MS = 86_400_000;
const RECUSADO = new Set(["refused", "requires_action"]);

/** O e-mail que vale hoje: o maior dia da régua já alcançado, ou null antes do dia 1. */
export function diaDaCobranca(diasDesdeARecusa: number | null | undefined): DiaDaCobranca | null {
  if (diasDesdeARecusa == null || !Number.isFinite(diasDesdeARecusa)) return null;
  let dia: DiaDaCobranca | null = null;
  for (const d of DIAS_DA_COBRANCA) if (diasDesdeARecusa >= d) dia = d;
  return dia;
}

export function chaveDaCobranca(jobId: string, dia: DiaDaCobranca | "pessoa"): string {
  return `cobranca-cartao:${jobId}:${dia}`;
}

/** A 1ª tentativa recusada depois da última que passou (mesma régua do scripts/pendencias.mts). */
export function primeiraRecusaDesde(tentativas: Array<{ status: string; created_at: string }>): string | null {
  const ordenadas = [...tentativas].sort((a, b) => a.created_at.localeCompare(b.created_at));
  const ultimaBoa = ordenadas.filter((t) => t.status === "succeeded").pop()?.created_at ?? "";
  return ordenadas.find((t) => t.status !== "succeeded" && t.created_at > ultimaBoa)?.created_at ?? null;
}

export function diasDesde(iso: string | null | undefined, agora: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return null;
  return Math.floor((agora.getTime() - t) / DIA_MS);
}

export type JobDaCobranca = JobParaPendencias & { status: string };

export type DecisaoDaCobranca =
  | { acao: "fora"; motivo: string }
  | { acao: "pago"; motivo: string }
  | { acao: "esperar"; motivo: string }
  | { acao: "cobrar"; dia: DiaDaCobranca; precisaDePessoa: boolean };

/** Puro: o que fazer com este job hoje. */
export function decidirCobranca(
  job: JobDaCobranca,
  regras: Pick<RegrasDoProcesso, "v2" | "tipo" | "cobraDoCliente"> | null | undefined,
  diasDesdeARecusa: number | null | undefined,
): DecisaoDaCobranca {
  if (!regras?.v2 || regras.tipo !== "direct" || !regras.cobraDoCliente) return { acao: "fora", motivo: "account is not on the new direct flow" };
  if ((job.finance_status ?? job.payment_status) === "paid") return { acao: "pago", motivo: "paid: dunning stops" };
  if (job.status !== "awaiting_payment") return { acao: "fora", motivo: `job is ${job.status}, not awaiting payment` };
  if (!RECUSADO.has(String(job.card_charge_status ?? ""))) return { acao: "fora", motivo: "card not declined" };
  const dia = diaDaCobranca(diasDesdeARecusa);
  if (dia == null) return { acao: "esperar", motivo: diasDesdeARecusa == null ? "no declined attempt on record" : "first email goes out on day 1" };
  return { acao: "cobrar", dia, precisaDePessoa: (diasDesdeARecusa ?? 0) >= DIAS_ATE_PAGAMENTO_SEM_SUCESSO };
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** Os três e-mails. Inglês, sem travessão, sem falar de VAT (é B2C). */
export function emailDaCobranca(dia: DiaDaCobranca, p: { primeiroNome: string; referencia: string; servico?: string | null; link: string }): { assunto: string; html: string } {
  const job = p.servico ? `${p.servico} (${p.referencia})` : p.referencia;
  const base = {
    saudacao: saudacao({ tipo: "b2c", primeiroNome: p.primeiroNome }),
    cta: { label: "Pay securely", url: p.link },
    linhas: [["Service", p.servico ?? null], ["Booking", p.referencia]] as Array<[string, string | null]>,
    letraPequena: ["If you have already paid, please ignore this message."],
    zendesk: true,
  };
  if (dia === 1) {
    const { html } = emailFixfy({
      ...base,
      preheader: "Your card payment did not go through. You can pay in a minute with the secure link.",
      estado: { texto: "Payment due", cor: "red" },
      titulo: "Your payment didn’t go through",
      paragrafos: [
        `We tried to take the balance for ${job} from your saved card, but the payment did not go through. This can happen when the bank asks for a confirmation or the card has changed.`,
        "You can pay the balance in a minute using the secure link below.",
      ],
    });
    return { assunto: `Your Fixfy payment did not go through (${p.referencia})`, html };
  }
  if (dia === 3) {
    const { html } = emailFixfy({
      ...base,
      preheader: `The balance for ${p.referencia} is still outstanding.`,
      estado: { texto: "Payment overdue", cor: "red" },
      titulo: "Your payment is still outstanding",
      paragrafos: [
        `A quick reminder that the balance for ${job} is still outstanding, as the payment from your saved card did not go through.`,
        "If something is not right with the work or the amount, just reply to this email and we will help.",
      ],
    });
    return { assunto: `Reminder: payment still outstanding for ${p.referencia}`, html };
  }
  const { html } = emailFixfy({
    ...base,
    preheader: `Final reminder: the balance for ${p.referencia} is still outstanding.`,
    estado: { texto: "Final reminder", cor: "red" },
    titulo: "Final reminder about your payment",
    paragrafos: [
      `We have still not been able to take the balance for ${job}. Please pay using the secure link below.`,
      "A member of our team will also be in touch. If you would like to talk it through, just reply to this email.",
    ],
  });
  return { assunto: `Final reminder: payment for ${p.referencia}`, html };
}

export type AvisoDaCobranca = (a: AvisoNoTicket) => Promise<unknown>;
export type NotaInterna = (ticketId: number, texto: string) => Promise<unknown>;

export type LinhaDaCobranca = { reference: string; resultado: "enviado" | "enviaria" | "pulado" | "falhou" | "parado"; detalhe: string };

const SELECT =
  "id, reference, title, status, account_id, client_id, client_name, invoice_id, external_source, external_ref, " +
  "scheduled_date, scheduled_start_at, partner_id, client_price, partner_cost, customer_deposit, customer_deposit_paid, " +
  "finance_status, payment_status, card_charge_status, card_retry_at, final_report_submitted, final_report_skipped, report_1_uploaded, report_submitted";

export async function varrerCartaoRecusado(
  sb: SupabaseClient,
  opcoes: { aplicar?: boolean; agora?: Date; avisar?: AvisoDaCobranca; nota?: NotaInterna } = {},
): Promise<{ linhas: LinhaDaCobranca[]; modo: "ensaio" | "envio"; aviso: string | null }> {
  const agora = opcoes.agora ?? new Date();
  const linhas: LinhaDaCobranca[] = [];
  if (!processosV2Ligado()) return { linhas, modo: "ensaio", aviso: "PROCESSOS_V2 is not on: nothing to do" };
  const aplicar = opcoes.aplicar === true;
  let aviso: string | null = null;
  const podeMandar = aplicar && mensagensAoClienteLigadas();
  if (aplicar && !podeMandar) aviso = "CLIENT_MESSAGING_ENABLED is not 1: no customer emails, internal steps still apply";

  const avisar: AvisoDaCobranca = opcoes.avisar ?? (async (a) => (await import("@/lib/um-ticket/aviso-do-job")).avisarNoTicketDoJob(a));
  const nota: NotaInterna =
    opcoes.nota ?? (async (ticketId, texto) => (await import("@/lib/zendesk")).updateTicket({ ticketId, commentBody: texto, publicComment: false }));

  const { data: contas, error: errContas } = await sb.from("accounts").select("id, process_type, process_rules");
  if (errContas) throw new Error(`could not read accounts: ${errContas.message}`);
  const regraDaConta = new Map<string, RegrasDoProcesso | null>();
  for (const c of (contas ?? []) as Array<{ id: string; process_type: string | null; process_rules: ExcecoesDaConta | null }>) {
    const tipo = tipoDaConta(c);
    regraDaConta.set(c.id, tipo ? regrasDoProcesso(tipo, c.process_rules) : null);
  }
  const algumaV2 = [...regraDaConta.values()].some((r) => r?.v2 && r.tipo === "direct" && r.cobraDoCliente);
  if (!algumaV2) return { linhas, modo: aplicar ? "envio" : "ensaio", aviso: "no direct account has v2 on" };

  const { data: jobs, error } = await sb
    .from("jobs")
    .select(SELECT)
    .eq("status", "awaiting_payment")
    .in("card_charge_status", ["refused", "requires_action"])
    .is("deleted_at", null)
    .limit(200);
  if (error) throw new Error(`could not read declined jobs: ${error.message}`);

  for (const raw of jobs ?? []) {
    const j = raw as unknown as Record<string, unknown> & JobDaCobranca & { id: string; reference: string };
    const anota = (resultado: LinhaDaCobranca["resultado"], detalhe: string) => linhas.push({ reference: j.reference, resultado, detalhe });
    try {
      let contaId = typeof j.account_id === "string" ? j.account_id : "";
      let cliente: { full_name?: string | null; email?: string | null; source_account_id?: string | null } = {};
      if (typeof j.client_id === "string" && j.client_id) {
        const { data } = await sb.from("clients").select("full_name, email, source_account_id").eq("id", j.client_id).maybeSingle();
        cliente = (data ?? {}) as typeof cliente;
      }
      if (!contaId) contaId = cliente.source_account_id ?? "";
      const regras = contaId ? regraDaConta.get(contaId) ?? null : null;

      const { data: tentativas } = await sb.from("stripe_charge_attempts").select("status, created_at").eq("job_id", j.id);
      const dias = diasDesde(primeiraRecusaDesde((tentativas ?? []) as Array<{ status: string; created_at: string }>), agora);
      const d = decidirCobranca(j, regras, dias);
      if (d.acao === "fora") continue;
      if (d.acao === "pago") { anota("parado", d.motivo); continue; }
      if (d.acao === "esperar") { anota("pulado", d.motivo); continue; }

      const ticketId = getZendeskTicketId(j as never);

      // Dia 7 em diante: pendência, fim das tentativas automáticas e alguém da equipe.
      if (d.precisaDePessoa) {
        const motivos = motivosDoJob(j, regras, { diasDesdeARecusa: dias });
        await sincronizarPendencias(sb, j.id, motivos, { aplicar });
        if (aplicar) {
          if (j.card_retry_at) await sb.from("jobs").update({ card_retry_at: null }).eq("id", j.id);
          if (ticketId && isZendeskConfigured()) {
            const chaveNota = chaveDaCobranca(j.id, "pessoa");
            const r = await reservarEnvio(sb, { chave: chaveNota, finalidade: "cobranca-cartao", canal: "zendesk_note", jobId: j.id, ticketId: Number(ticketId) || null, motivo: "payment unsuccessful after 7 days" }, agora);
            if (r.reservado) {
              try {
                await nota(Number(ticketId), `💳 ${j.reference}: card payment still unsuccessful ${dias} days after the first decline. Automatic retries have stopped and the job is marked Payment Unsuccessful. This needs a person to contact the customer.`);
                await confirmarEnvio(sb, chaveNota);
              } catch (e) {
                await falhouEnvio(sb, chaveNota, e).catch(() => undefined);
              }
            }
          }
        }
      }

      // O e-mail do dia.
      const email = emailDoCliente(cliente.email ?? null);
      if (!email) { anota("pulado", `day ${d.dia}: no customer email on file`); continue; }
      if (!ticketId) { anota("pulado", `day ${d.dia}: job has no Zendesk ticket`); continue; }
      let refFatura: string | null = null;
      if (typeof j.invoice_id === "string" && j.invoice_id) {
        const { data: inv } = await sb.from("invoices").select("reference").eq("id", j.invoice_id).maybeSingle();
        refFatura = (inv as { reference?: string | null } | null)?.reference ?? null;
      }
      if (!refFatura) { anota("pulado", `day ${d.dia}: no invoice to link`); continue; }
      const link = invoicePayLinkUrl(refFatura);
      const primeiroNome = String(cliente.full_name ?? j.client_name ?? "").trim().split(/\s+/)[0] || "there";
      const { assunto, html } = emailDaCobranca(d.dia, { primeiroNome, referencia: j.reference, servico: (j.title as string | null) ?? null, link });

      if (!podeMandar) { anota("enviaria", `day ${d.dia} · ${email} · ${link}`); continue; }
      if (!isZendeskConfigured()) { anota("pulado", "Zendesk not configured"); continue; }

      const chave = chaveDaCobranca(j.id, d.dia);
      const reserva = await reservarEnvio(sb, { chave, finalidade: "cobranca-cartao", canal: "email", jobId: j.id, ticketId: Number(ticketId) || null, destinatario: email, motivo: `card declined, day ${d.dia}` }, agora);
      if (!reserva.reservado) { anota("pulado", `day ${d.dia}: already handled (${reserva.motivo ?? "reserved"})`); continue; }
      try {
        await avisar({ ticketId: Number(ticketId), para: { email, nome: cliente.full_name ?? null }, assunto, html });
        await confirmarEnvio(sb, chave);
        anota("enviado", `day ${d.dia} · ${email}`);
      } catch (e) {
        await falhouEnvio(sb, chave, e).catch(() => undefined);
        anota("falhou", e instanceof Error ? e.message.slice(0, 140) : String(e));
      }
    } catch (e) {
      anota("falhou", e instanceof Error ? e.message.slice(0, 140) : String(e));
    }
  }
  return { linhas, modo: podeMandar ? "envio" : "ensaio", aviso };
}
