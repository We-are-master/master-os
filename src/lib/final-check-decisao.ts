/**
 * Final check automático (Fase 3, dono 15/10/2026): a DECISÃO, sem banco nem rede.
 *
 * O parceiro manda o relatório, o job cai em Final Checks e, se nada pedir olho humano,
 * o sistema aprova e manda o e-mail final com o saldo. Esta função só diz "aprova" ou
 * "deixa para a equipe" (com o motivo, que vira nota interna no ticket). Quem lê o banco
 * e executa é `final-check-automatico.ts`.
 *
 * Na dúvida, fica para a equipe: aprovar errado manda cobrança para cliente com problema.
 */

const EPS = 0.02;

export type MotivoParaEquipe =
  | "complaint"
  | "report_incomplete"
  | "report_flags"
  | "partner_notes"
  | "material_extra"
  | "hourly"
  | "platform"
  | "no_price"
  | "price_mismatch"
  | "weekly_invoice"
  | "email_off"
  | "no_email";

export type EntradaFinalCheck = {
  /** `jobs.status` agora. Só `final_check` entra. */
  status: string | null | undefined;
  /** O e-mail final já saiu (`jobs.review_sent_at`): alguém já fechou. */
  reviewSentAt?: string | null;
  finalReportSubmitted?: boolean | null;
  jobType?: string | null;
  /** `report_link` do job: relatório vai para a plataforma do cliente (Housekeep etc.). */
  platformReport?: boolean;
  /** Campos do relatório final (`normalizeReport(final_report).fields`). */
  reportFields: Record<string, unknown> | null;
  /** Portão de relatório preenchido (`reportCompletionGate`). */
  reportGate: { ok: boolean; message?: string };
  /** O que o relatório cobrou de material extra do cliente (custo +30% quando em branco). */
  materialExtraCharge: number;
  /** Reclamação: ticket em Complaint, tag `com_leo`/`complaint`, ou descrição de reclamação no job. */
  complaint: boolean;
  /** Não deu para ler o ticket: sem descartar reclamação, fica para a equipe. */
  complaintUnknown?: boolean;
  /** O que o cliente deve no job (preço + extras − promoção, ou o cronograma, o maior). */
  jobTotal: number;
  /** Soma das faturas do job que contam (sem cancelada). Null = ainda não tem fatura. */
  invoicesTotal: number | null;
  /** O que o cliente já pagou (sinal + final em `job_payments`). */
  customerPaid: number;
  /** Conta de fatura semanal: não ganha fatura por job, é a equipe que fecha o lote. */
  weeklyInvoice: boolean;
  /** Política do e-mail final da conta (`email_include_invoice_on_final` / `..._report_...`). */
  emailPolicy: { canIncludeInvoice: boolean; canIncludeReport: boolean };
  billingEmail: string | null;
};

export type DecisaoFinalCheck =
  | { acao: "ignorar"; motivo: string }
  | { acao: "equipe"; codigo: MotivoParaEquipe; motivo: string }
  | { acao: "aprovar"; pagoTotal: boolean; saldo: number };

const SIM = new Set(["true", "yes", "y", "1", "sim"]);
const NAO = new Set(["false", "no", "n", "0", "nao", "não"]);

/** Booleano do relatório: o formulário grava `true`/`"true"`/`"yes"`. Fora disso, null. */
export function boolDoRelatorio(v: unknown): boolean | null {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    if (SIM.has(s)) return true;
    if (NAO.has(s)) return false;
  }
  return null;
}

const texto = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Parceiro escreveu que não terminou ("not finished", "need to come back"...). */
const NAO_TERMINOU =
  /\b(not\s+(yet\s+)?(finished|complete[d]?|done)|unfinished|incomplete|(come|go|coming|going)\s+back|return\s+visit|could\s*(n['’]?t|\s+not)\s+(finish|complete)|unable\s+to\s+(finish|complete)|half\s+done)\b/i;

/** O que o relatório final aponta como problema. Lista vazia = nada a ver. */
export function problemasDoRelatorio(fields: Record<string, unknown> | null): { flags: string[]; notas: string[] } {
  const f = fields ?? {};
  const flags: string[] = [];
  const status = texto(f.completion_status).toLowerCase();
  if (status && status !== "complete") flags.push(`completion status "${status.replace(/_/g, " ")}"`);
  if (texto(f.what_needs_completing)) flags.push("partner listed work still to complete");
  if (boolDoRelatorio(f.job_complete) === false) flags.push("job marked not complete");
  if (boolDoRelatorio(f.all_tasks_done) === false) flags.push("not all tasks done");
  if (boolDoRelatorio(f.follow_up_required) === true) flags.push("follow-up required");
  if (boolDoRelatorio(f.remedial_work_required) === true) flags.push("remedial work required");
  if (boolDoRelatorio(f.site_access_obtained) === false) flags.push("no site access");
  if (texto(f.certificate_outcome).toLowerCase() === "unsatisfactory") flags.push("certificate unsatisfactory");
  if (boolDoRelatorio(f.scope_changes) === true) flags.push("scope changed on site");
  if (boolDoRelatorio(f.pre_existing_damage) === true) flags.push("damage reported");
  if (boolDoRelatorio(f.additional_charges) === true) flags.push("additional charges on site");

  const notas: string[] = [];
  for (const chave of ["description", "additional_charges_note", "scope_changes_note", "next_visit_tasks", "notes", "partner_notes"]) {
    const t = texto(f[chave]);
    if (t && NAO_TERMINOU.test(t)) notas.push(t.length > 120 ? `${t.slice(0, 117)}...` : t);
  }
  return { flags, notas };
}

const libras = (n: number) => `£${n.toFixed(2)}`;

export function decidirFinalCheck(e: EntradaFinalCheck): DecisaoFinalCheck {
  // Fora do lugar: não é decisão, não vira nota.
  if (e.status !== "final_check") return { acao: "ignorar", motivo: `status ${e.status ?? "?"}` };
  if (e.reviewSentAt) return { acao: "ignorar", motivo: "final email already sent" };
  if (!e.finalReportSubmitted) return { acao: "ignorar", motivo: "no final report" };

  const equipe = (codigo: MotivoParaEquipe, motivo: string): DecisaoFinalCheck => ({ acao: "equipe", codigo, motivo });

  if (e.complaint) return equipe("complaint", "the job or its ticket is in Complaint / with Leo");
  if (e.complaintUnknown) return equipe("complaint", "could not read the Zendesk ticket to rule out a complaint");
  if (!e.reportGate.ok) return equipe("report_incomplete", e.reportGate.message ?? "the report is not complete");

  const { flags, notas } = problemasDoRelatorio(e.reportFields);
  if (flags.length) return equipe("report_flags", `the report flags: ${flags.join(", ")}`);
  if (notas.length) return equipe("partner_notes", `partner notes suggest the work is not finished: "${notas[0]}"`);
  if (e.materialExtraCharge > EPS) {
    return equipe("material_extra", `the report adds ${libras(e.materialExtraCharge)} of materials to the customer price`);
  }
  if (e.jobType === "hourly") return equipe("hourly", "hourly job: billed hours need confirming");
  if (e.platformReport) return equipe("platform", "platform job: the report goes to the client platform");
  if (e.weeklyInvoice) return equipe("weekly_invoice", "account billed on a weekly invoice");

  const total = Math.round(Math.max(0, e.jobTotal) * 100) / 100;
  if (total <= EPS) return equipe("no_price", "the job has no customer price");
  if (e.invoicesTotal != null && Math.abs(e.invoicesTotal - total) > EPS) {
    return equipe("price_mismatch", `job total ${libras(total)} differs from its invoices ${libras(e.invoicesTotal)}`);
  }

  if (!e.emailPolicy.canIncludeInvoice && !e.emailPolicy.canIncludeReport) {
    return equipe("email_off", "the account does not allow the completion email");
  }
  if (!e.billingEmail?.trim()) return equipe("no_email", "no billing email for the customer");

  const saldo = Math.max(0, Math.round((total - e.customerPaid) * 100) / 100);
  return { acao: "aprovar", pagoTotal: saldo <= EPS, saldo: saldo <= EPS ? 0 : saldo };
}

/** A varredura só pega relatório dos últimos 7 dias, e não o que acabou de chegar (o gatilho da submissão cuida). */
export const VARREDURA_JANELA_DIAS = 7;
export const VARREDURA_FOLGA_MIN = 10;

export function entraNaVarredura(submittedAt: string | null | undefined, agora: Date = new Date()): boolean {
  if (!submittedAt) return false;
  const t = Date.parse(submittedAt);
  if (Number.isNaN(t)) return false;
  const idade = agora.getTime() - t;
  return idade >= VARREDURA_FOLGA_MIN * 60_000 && idade <= VARREDURA_JANELA_DIAS * 86_400_000;
}
