/**
 * FEEDBACK PÓS-JOB: o e-mail "How did we do?" um dia depois do job concluído.
 * Era o WhatsApp `job_feedback` até 25/10/2026; o dono passou para e-mail
 * (aviso ao cliente sai por e-mail, WhatsApp só no informal).
 *
 * Não rodava desde 05/09/2026: o script existia, mas sem agendador nenhum.
 * Agora é varredura diária (cron da Vercel, Hobby só aceita diário) e ensaio
 * por padrão. Regras do dono (14/10/2026), na ordem em que cortam:
 *
 *   1. status `completed`, sem `feedback_requested_at` (uma vez por job, para
 *      sempre: mig 284).
 *   2. Concluído ONTEM ou antes, até `FEEDBACK_JANELA_DIAS` (7) dias atrás. A
 *      conclusão é o dia do relatório do parceiro (`resolveJobCompletionInstant`),
 *      não o dia em que a equipe aprovou o final check. O teto existe para a
 *      primeira rodada não pedir feedback do histórico inteiro.
 *   3. Só cliente B2C da Fixfy: `source_account_id` nulo ou a conta Fixfy.
 *      Cliente de conta B2B só quando a conta liga `client_feedback_whatsapp`
 *      (mig 325). O cliente final da conta é da conta, não nosso.
 *   4. Terminou bem: nenhuma reclamação no job, no banco ou no ticket do
 *      Zendesk (`reclamacao.ts`). Ticket ilegível = não pede (na dúvida, não).
 *      Cliente que já deixou avaliação no OS também não recebe.
 *   5. Um pedido por cliente por semana: quem fechou dois jobs não recebe dois.
 *   6. Só cliente final (dono, 25/10/2026): e-mail de empresa (domínio fora
 *      dos provedores pessoais, `segmentoDoEmail`) ou cliente `commercial` não
 *      recebe. MS4 Facilities e BF Property estavam na conta Fixfy como pessoa.
 *   7. E-mail do cliente e ticket do job no Zendesk: o e-mail entra no ticket
 *      (`avisarNoTicketDoJob`), e a resposta do cliente cai nele também.
 *   8. Para mandar: `CLIENT_MESSAGING_ENABLED=1` e 9h-20h de Londres.
 *
 * O botão leva a `FEEDBACK_REVIEW_URL`, padrão o perfil da Fixfy no Google
 * (`emails/client-feedback-request.ts`).
 *
 * Convivência com o e-mail de avaliação (`marketing/agente/avaliacao.ts`, 10+
 * dias depois, Google + REFER20): ficam em dias diferentes de propósito. O
 * e-mail do dia 1 é para pegar problema enquanto ainda dá para consertar; o
 * e-mail do dia 10 pede a avaliação pública a quem não reclamou (ele também
 * passou a pular cliente com reclamação, inclusive a que nasceu da resposta a
 * este pedido).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolveJobCompletionYmd } from "@/lib/job-completion-anchor";
import { mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";
import { horaEmLondres, type AvisoPorEmail } from "@/lib/client-confirmation/sweep-24h";
import { dataPorExtenso, hojeEmLondres } from "@/lib/client-confirmation/send";
import { getZendeskTicketId, isZendeskConfigured } from "@/lib/zendesk";
import { emailDoCliente } from "@/lib/um-ticket/escolha";
import { buildClientFeedbackRequestEmail, linkDoFeedback } from "@/lib/emails/client-feedback-request";
import { segmentoDoEmail } from "@/lib/marketing/segments";
import { reclamacaoNoBanco, reclamacaoNoJob, reclamacaoNoZendesk } from "./reclamacao";
import { processoDaConta, processosV2Ligado, type RegrasDoProcesso } from "@/lib/processo/conta";

const avisarDeVerdade: AvisoPorEmail = async (a) => (await import("@/lib/um-ticket/aviso-do-job")).avisarNoTicketDoJob(a);
const janelaDias = () => {
  const n = Number(process.env.FEEDBACK_JANELA_DIAS ?? 7);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 7;
};
const fixfyAccountId = () => process.env.FIXFY_ACCOUNT_ID?.trim() || "5cf896ec-ee42-441b-a698-34fdaeeb28b3";

export const FEEDBACK_HORA_INICIO = 9;
export const FEEDBACK_HORA_FIM = 20;
const DIA_MS = 24 * 60 * 60 * 1000;

export function feedbackLigado(): boolean {
  return process.env.FEEDBACK_POS_JOB?.trim() === "on";
}

/** `2026-10-14` menos `n` dias, sem fuso (aritmética de calendário). */
export function diasAntes(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) - n * DIA_MS).toISOString().slice(0, 10);
}

/** Concluído de ontem até `maxDias` atrás: é a vez dele. */
export function naJanelaDoFeedback(conclusaoYmd: string | null, hojeYmd: string, maxDias: number): boolean {
  if (!conclusaoYmd) return false;
  return conclusaoYmd <= diasAntes(hojeYmd, 1) && conclusaoYmd >= diasAntes(hojeYmd, maxDias);
}

/** Cliente B2C da Fixfy: sem conta, ou na conta Fixfy. */
export function clienteDaFixfy(sourceAccountId: string | null | undefined, fixfyId: string): boolean {
  return !sourceAccountId || sourceAccountId === fixfyId;
}

/**
 * Contas com os fluxos novos (regras.v2, plano do dono 22/10/2026): quem decide é
 * `regras.feedback`, não a regra "só cliente da Fixfy" do passo 3.
 *
 *   depois_da_conclusao                 dia seguinte à conclusão, concluído OU em
 *                                       Awaiting Payment (saldo pendente não segura)
 *   depois_do_pagamento_da_plataforma   só com finance_status = paid, no dia seguinte
 *                                       ao pagamento (sem data de pagamento: a conclusão)
 *   nunca                               não pede
 *
 * `anotar`: vale uma linha na lista da rodada (fora da janela é silêncio, como hoje).
 */
export function feedbackPeloProcesso(p: {
  status: string;
  financeStatus: string | null | undefined;
  regra: RegrasDoProcesso["feedback"];
  conclusaoYmd: string | null;
  pagoYmd?: string | null;
  hojeYmd: string;
  maxDias: number;
}): { elegivel: boolean; ancora: string | null; motivo: string; anotar: boolean } {
  if (p.status !== "completed" && p.status !== "awaiting_payment") return { elegivel: false, ancora: null, motivo: "job not finished", anotar: false };
  if (p.regra === "nunca") {
    const naJanela = naJanelaDoFeedback(p.conclusaoYmd, p.hojeYmd, p.maxDias);
    return { elegivel: false, ancora: p.conclusaoYmd, motivo: "account process never sends feedback requests", anotar: naJanela };
  }
  if (p.regra === "depois_do_pagamento_da_plataforma") {
    if (p.financeStatus !== "paid") {
      const naJanela = naJanelaDoFeedback(p.conclusaoYmd, p.hojeYmd, p.maxDias);
      return { elegivel: false, ancora: p.conclusaoYmd, motivo: "waiting for the platform to pay before asking for feedback", anotar: naJanela };
    }
    const ancora = (p.pagoYmd ?? "").slice(0, 10) || p.conclusaoYmd;
    const ok = naJanelaDoFeedback(ancora, p.hojeYmd, p.maxDias);
    return { elegivel: ok, ancora, motivo: ok ? "paid by the platform" : "outside the feedback window", anotar: ok };
  }
  const ok = naJanelaDoFeedback(p.conclusaoYmd, p.hojeYmd, p.maxDias);
  return { elegivel: ok, ancora: p.conclusaoYmd, motivo: ok ? "finished" : "outside the feedback window", anotar: ok };
}

export type LinhaDoFeedback = {
  reference: string;
  resultado: "enviado" | "enviaria" | "pulado" | "falhou";
  detalhe: string;
};

const SELECT =
  "id, reference, title, status, client_id, property_address, client_name, external_source, external_ref, internal_notes, " +
  "scheduled_date, scheduled_start_at, completed_date, partner_timer_ended_at, final_report, " +
  "on_hold_reason_preset_id, on_hold_reason, on_hold_complaint_description, customer_review_submitted_at, " +
  "feedback_requested_at, account_id, finance_status, payment_status, invoice_id";

export async function varrerFeedbackPosJob(
  sb: SupabaseClient,
  opcoes?: {
    aplicar?: boolean;
    agora?: Date;
    max?: number;
    ignorarJanela?: boolean;
    /** Injeção para teste: entrega o e-mail no ticket do job. */
    avisar?: AvisoPorEmail;
    /** Injeção para teste: lê a reclamação no Zendesk. */
    lerZendesk?: (ticketId: string) => Promise<string | null>;
  },
): Promise<{ hoje: string; linhas: LinhaDoFeedback[]; modo: "ensaio" | "envio"; aviso: string | null }> {
  const agora = opcoes?.agora ?? new Date();
  const hoje = hojeEmLondres(agora);
  const maxDias = janelaDias();
  const lerZendesk = opcoes?.lerZendesk ?? reclamacaoNoZendesk;

  let aviso: string | null = null;
  let aplicar = opcoes?.aplicar === true;
  if (aplicar && !mensagensAoClienteLigadas()) {
    aviso = "CLIENT_MESSAGING_ENABLED is not 1: listing only";
    aplicar = false;
  }
  const h = horaEmLondres(agora);
  if (aplicar && !opcoes?.ignorarJanela && (h < FEEDBACK_HORA_INICIO || h >= FEEDBACK_HORA_FIM)) {
    aviso = `outside ${FEEDBACK_HORA_INICIO}h-${FEEDBACK_HORA_FIM}h London (now ${h}h): listing only`;
    aplicar = false;
  }
  if (aplicar && !opcoes?.avisar && !isZendeskConfigured()) {
    aviso = "Zendesk not configured: listing only";
    aplicar = false;
  }

  // Fluxos novos ligados (PROCESSOS_V2=on): Awaiting Payment também entra na leitura,
  // mas só conta v2 passa dele; as outras seguem exatamente a regra de antes.
  const v2Ligado = processosV2Ligado();
  const regrasPorConta = new Map<string, RegrasDoProcesso | null>();

  // Corte barato no banco (a agenda vem antes da conclusão); o fino é em JS.
  const base = sb.from("jobs").select(SELECT);
  const { data: jobs, error } = await (v2Ligado ? base.in("status", ["completed", "awaiting_payment"]) : base.eq("status", "completed"))
    .is("feedback_requested_at", null)
    .is("deleted_at", null)
    .gte("scheduled_date", diasAntes(hoje, maxDias + 30))
    .order("scheduled_date")
    .limit(500);
  if (error) throw new Error(`could not read completed jobs: ${error.message}`);

  const linhas: LinhaDoFeedback[] = [];
  const clientesDaRodada = new Set<string>();
  let enviados = 0;
  const max = opcoes?.max ?? 40;
  const contas = new Map<string, { nome: string | null; liga: boolean; erro?: string }>();

  for (const raw of jobs ?? []) {
    const j = raw as unknown as Record<string, unknown> & { id: string; reference: string };
    const conclusao = resolveJobCompletionYmd(j as Parameters<typeof resolveJobCompletionYmd>[0]);

    let regras: RegrasDoProcesso | null = null;
    if (v2Ligado) {
      let contaId = typeof j.account_id === "string" ? j.account_id : "";
      if (!contaId && typeof j.client_id === "string") {
        const { data: cl } = await sb.from("clients").select("source_account_id").eq("id", j.client_id).maybeSingle();
        contaId = (cl as { source_account_id?: string | null } | null)?.source_account_id ?? "";
      }
      if (contaId && !regrasPorConta.has(contaId)) regrasPorConta.set(contaId, await processoDaConta(sb, contaId));
      regras = contaId ? regrasPorConta.get(contaId) ?? null : null;
      if (!regras?.v2) regras = null;
    }

    let ancora = conclusao;
    if (regras) {
      const finance = (j.finance_status ?? j.payment_status ?? null) as string | null;
      let pagoYmd: string | null = null;
      if (regras.feedback === "depois_do_pagamento_da_plataforma" && finance === "paid" && typeof j.invoice_id === "string" && j.invoice_id) {
        const { data: inv } = await sb.from("invoices").select("paid_date, last_payment_date").eq("id", j.invoice_id).maybeSingle();
        const i = inv as { paid_date?: string | null; last_payment_date?: string | null } | null;
        pagoYmd = i?.paid_date ?? i?.last_payment_date ?? null;
      }
      const e = feedbackPeloProcesso({ status: String(j.status), financeStatus: finance, regra: regras.feedback, conclusaoYmd: conclusao, pagoYmd, hojeYmd: hoje, maxDias });
      if (!e.elegivel) {
        if (e.anotar) linhas.push({ reference: j.reference, resultado: "pulado", detalhe: `${e.ancora ?? conclusao} · ${e.motivo}` });
        continue;
      }
      ancora = e.ancora;
    } else {
      // Sem v2: só concluído (a leitura pode trazer Awaiting Payment quando a chave geral está ligada).
      if (j.status !== "completed") continue;
      // Fora da janela não entra nem na lista: é ruído de todo dia.
      if (!naJanelaDoFeedback(conclusao, hoje, maxDias)) continue;
    }

    const anota = (resultado: LinhaDoFeedback["resultado"], detalhe: string) =>
      linhas.push({ reference: j.reference, resultado, detalhe: `${ancora} · ${detalhe}` });

    try {
      const clientId = typeof j.client_id === "string" ? j.client_id : null;
      if (!clientId) { anota("pulado", "job has no client record"); continue; }
      if (clientesDaRodada.has(clientId)) { anota("pulado", "client already asked in this run"); continue; }

      const { data: cliente } = await sb
        .from("clients").select("full_name, email, client_type, source_account_id").eq("id", clientId).maybeSingle();
      const c = (cliente ?? {}) as { full_name?: string | null; email?: string | null; client_type?: string | null; source_account_id?: string | null };

      // 3. de quem é o cliente (conta v2: já decidido acima por regras.feedback)
      if (!regras && !clienteDaFixfy(c.source_account_id, fixfyAccountId())) {
        const id = c.source_account_id as string;
        if (!contas.has(id)) {
          const r = await sb.from("accounts").select("company_name, client_feedback_whatsapp").eq("id", id).maybeSingle();
          if (r.error) {
            // Sem a coluna (mig 325 não aplicada) ninguém de conta recebe: é o padrão desligado.
            const r2 = await sb.from("accounts").select("company_name").eq("id", id).maybeSingle();
            contas.set(id, { nome: (r2.data as { company_name?: string } | null)?.company_name ?? null, liga: false, erro: "migration 325 not applied" });
          } else {
            const d = r.data as { company_name?: string | null; client_feedback_whatsapp?: boolean | null } | null;
            contas.set(id, { nome: d?.company_name ?? null, liga: d?.client_feedback_whatsapp === true });
          }
        }
        const conta = contas.get(id)!;
        if (!conta.liga) {
          anota("pulado", `${conta.nome ?? "business account"} customer: account does not send feedback requests`);
          continue;
        }
      }

      // 4. terminou bem?
      if (j.customer_review_submitted_at) { anota("pulado", "customer already left a review"); continue; }
      const noJob = reclamacaoNoJob(j as Parameters<typeof reclamacaoNoJob>[0]);
      if (noJob) { anota("pulado", noJob); continue; }
      const noBanco = await reclamacaoNoBanco(sb, j);
      if (noBanco) { anota("pulado", noBanco); continue; }
      if (j.external_source === "zendesk" && j.external_ref) {
        let noTicket: string | null;
        try {
          noTicket = await lerZendesk(String(j.external_ref));
        } catch (e) {
          anota("pulado", `could not read ticket #${j.external_ref}: not asking blind (${e instanceof Error ? e.message.slice(0, 80) : e})`);
          continue;
        }
        if (noTicket) { anota("pulado", `${noTicket} (#${j.external_ref})`); continue; }
      }

      // 5. um pedido por cliente por semana
      const { data: recentes, error: errRec } = await sb
        .from("jobs").select("id").eq("client_id", clientId)
        .gte("feedback_requested_at", new Date(agora.getTime() - 7 * DIA_MS).toISOString()).limit(1);
      if (errRec) throw new Error(errRec.message);
      if ((recentes ?? []).length) { anota("pulado", "client was asked for feedback in the last 7 days"); continue; }

      // 6. e-mail e ticket do job
      const email = emailDoCliente(c.email ?? null);
      if (!email) { anota("pulado", "no customer email on file"); continue; }
      if (c.client_type === "commercial" || segmentoDoEmail(email) === "b2b") {
        anota("pulado", `business client (${email.split("@")[1]}): feedback is for end customers only`);
        continue;
      }
      const ticketId = Number(getZendeskTicketId(j as Parameters<typeof getZendeskTicketId>[0]));
      if (!ticketId) { anota("pulado", "the job has no Zendesk ticket"); continue; }

      const nome = String(c.full_name ?? j.client_name ?? "").trim().split(/\s+/)[0] || "";
      clientesDaRodada.add(clientId);

      if (!aplicar) { anota("enviaria", `email in ticket #${ticketId} → ${email}`); continue; }
      if (enviados >= max) { anota("pulado", `run cap reached (${max}): next run`); continue; }

      // Trava antes de mandar: só quem vira a coluna manda. Falha devolve.
      const { data: claim, error: errClaim } = await sb
        .from("jobs").update({ feedback_requested_at: agora.toISOString() })
        .eq("id", j.id).is("feedback_requested_at", null).select("id");
      if (errClaim) { anota("falhou", `could not claim: ${errClaim.message}`); continue; }
      if (!claim || (claim as unknown[]).length === 0) { anota("pulado", "already requested"); continue; }

      try {
        const { subject, html } = buildClientFeedbackRequestEmail({
          clientFirstName: nome,
          jobReference: j.reference,
          jobTitle: String(j.title ?? ""),
          completedOn: ancora ? dataPorExtenso(ancora) : null,
          propertyAddress: String(j.property_address ?? "").replace(/\s+/g, " ").trim() || null,
          feedbackUrl: linkDoFeedback(),
        });
        const avisar = opcoes?.avisar ?? avisarDeVerdade;
        await avisar({ ticketId, para: { email, nome: c.full_name ?? null }, assunto: subject, html });
        enviados++;
        anota("enviado", `email in ticket #${ticketId} → ${email}`);
      } catch (e) {
        await sb.from("jobs").update({ feedback_requested_at: null }).eq("id", j.id);
        anota("falhou", e instanceof Error ? e.message.slice(0, 160) : String(e));
      }
    } catch (e) {
      anota("falhou", e instanceof Error ? e.message.slice(0, 160) : String(e));
    }
  }

  return { hoje, linhas, modo: aplicar ? "envio" : "ensaio", aviso };
}
