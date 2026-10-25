/**
 * Os e-mails de job ao parceiro: oferta, job confirmado (e visita extra),
 * mudança de status (cancelado, concluído…), remarcação e on hold.
 *
 * Saem como conversa lateral no ticket do Zendesk do job (Resend quando o job
 * não tem ticket), na moldura única variante `zendesk: true`.
 *
 * Padrão do parceiro (dono, 23/10/2026: "bater o olho e já ver se é quote, job
 * pra aceitar ou job booked, as infos, e button pra resolver"): chip do tipo,
 * título curto, 1 ou 2 números no bloco navy com a régua no passo certo,
 * detalhes só do que o tipo pede, fotos, um botão. Sem saudação nem parágrafos.
 */

import { dataLonga, type Metrica } from "@/lib/emails/fixfy-shell";
import { buildPartnerComplaintEmailAntigo } from "@/lib/emails/partner-complaint-email-antigo";
import {
  CHIP_PARCEIRO,
  PASSO_ACEITO,
  PASSO_NO_DIA,
  PASSO_RELATORIO,
  agendaDaLinha,
  ajudaDoParceiro,
  saudacaoDoParceiro,
  semFotosDoParceiro,
  agendaDoJob,
  areaDoEndereco,
  blocoDeFotosHtml,
  emailParceiro,
  notaLimpa,
  pagaDoParceiro,
  passosDoJob,
  semTravessao,
  trabalhoCurto,
} from "@/lib/emails/partner-shell";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { partnerJobEmailNotesWithoutDefaults } from "@/lib/partner-job-email-notes";
import { formatJobScheduleLine } from "@/lib/schedule-calendar";

export type PartnerJobEmailScheduleFields = {
  scheduledDate?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  scheduledFinishDate?: string | null;
};

/** Body/subject schedule line — same format as partner push notifications. */
export function formatPartnerJobEmailScheduleLine(fields: PartnerJobEmailScheduleFields): string {
  const line = formatJobScheduleLine({
    scheduled_date: fields.scheduledDate,
    scheduled_start_at: fields.scheduledStartAt,
    scheduled_end_at: fields.scheduledEndAt,
    scheduled_finish_date: fields.scheduledFinishDate,
  });
  return line?.trim() || "TBC";
}

export interface PartnerJobConfirmationData extends PartnerJobEmailScheduleFields {
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  clientName: string;
  /**
   * Telefone do cliente, só neste email.
   *
   * A confirmação vai para o parceiro que já ganhou o job e vai à casa: sem o
   * número, ele liga para o escritório para pedir o número, e o escritório
   * repassa. O convite de auto-assign continua sem, porque lá o job ainda não
   * é de ninguém e o número iria para vários parceiros de uma vez.
   */
  clientPhone?: string | null;
  propertyAddress: string;
  scope: string;
  /**
   * As fotos do trabalho, embutidas no email (dono, 03/09/2026).
   *
   * O parceiro que recebe este email é o que vai à porta, e até aqui ele saía
   * de casa tendo lido o scope e visto nada. A foto muda o que ele leva na
   * van: um "flooring installation" com foto de duas fileiras já assentadas é
   * outro serviço do que o texto sozinho sugere.
   *
   * URL pública do bucket `quote-invite-images`, e tem que ser pública: o
   * email abre no telefone dele, sem sessão nossa, e link assinado expira
   * antes de ele chegar no job.
   */
  photoUrls?: string[] | null;
  /** Either "Hourly" or "Fixed" — drives the price-pill copy. */
  jobType: "hourly" | "fixed";
  /** £ display value (e.g. "£45.00/hr" or "£280.00"). */
  priceDisplay: string;
  /**
   * Onde o parceiro envia o relatório. `null` esconde o botão inteiro: o token
   * de relatório é ligado a (job, parceiro do job), então o parceiro de uma
   * visita extra receberia 403 se clicasse.
   */
  reportUrl: string | null;
  /** Support email (o rodapé da moldura já leva o contato da Fixfy). */
  supportEmail?: string;
  /** Support phone (o rodapé da moldura já leva o contato da Fixfy). */
  supportPhone?: string;
  /** Hourly/fixed + type-of-work rules; só o texto próprio do catálogo aparece (uma linha). */
  partnerNotes?: string | null;
  /** Visita extra: o número dela (2, 3…). Muda chip, título e assunto. */
  visitNumber?: number | null;
  /** Onde o parceiro vê o job (portal). Sem ele, "View job" abre o link do relatório. */
  jobUrl?: string | null;
  /**
   * Job confirmado depois do aceite ou do lance aprovado: abre com "Here's
   * everything you need to get started." (dono, 23/10/2026).
   */
  aposAceite?: boolean;
}

/** JOB-9265 → 9265 */
export function partnerJobEmailShortRef(jobReference: string): string {
  return jobReference.replace(/^JOB-/i, "").trim() || jobReference.trim();
}

/** `2026-10-21` vira `Wed 21 Oct 26`; sem data, null. */
function dataDoJob(scheduledDate?: string | null): string | null {
  const raw = scheduledDate?.trim();
  if (!raw) return null;
  const ymd = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dataLonga(ymd ?? raw) ?? raw;
}

/** Assunto: tipo primeiro, a referência inteira sempre. Partes vazias somem. */
function assunto(...partes: Array<string | null | undefined>): string {
  return semTravessao(partes.map((p) => String(p ?? "").trim()).filter(Boolean).join(" · "));
}

/** e.g. Job cancelled · General Maintenance · Mon 1 Jun 26 · JOB-9265 (assunto antigo + referência) */
export function partnerJobCancelledEmailSubject(args: {
  jobReference?: string | null;
  jobTitle: string;
  scheduledDate?: string | null;
}): string {
  return assunto("Job cancelled", args.jobTitle.trim() || "Job", dataDoJob(args.scheduledDate), args.jobReference);
}

/** Uma linha só com o que o catálogo pede para este serviço (os padrões saem). */
function notaDoCatalogo(partnerNotes: string | null | undefined): string[] {
  const t = notaLimpa(partnerJobEmailNotesWithoutDefaults(partnerNotes));
  return t ? [`Note: ${t}`] : [];
}

/** Métrica do valor do parceiro: "£35.00/h" ou "£70.00" com "Fixed price" embaixo. */
function metricaDaPaga(priceDisplay: string): Metrica {
  const p = pagaDoParceiro(priceDisplay);
  return { rotulo: "Your earnings", valor: p?.valor ?? "TBC", sub: p?.tipo ?? null };
}

/** O escopo inteiro, uma linha por item (o quadro preserva a quebra). */
function escopoInteiro(escopo: string | null | undefined): string | null {
  const t = String(escopo ?? "")
    .split(/\n+/)
    .map((l) => semTravessao(l.trim()))
    .filter((l) => l && !/^\(no scope provided\)$/i.test(l))
    .join("\n");
  return t || null;
}

const enderecoOuNada = (e: string | null | undefined) => (e?.trim() && e.trim() !== "—" ? e.trim() : null);

/**
 * As fotos do trabalho dentro do email de job confirmado.
 *
 * Miniaturas em fileira, e não uma coluna de fotos grandes (dono,
 * 03/09/2026). A miniatura serve para RECONHECER ("é aquela cozinha") e não
 * para inspecionar: quem quer inspecionar abre o anexo, que vem em tamanho
 * cheio no mesmo email.
 */
function fotosDoJob(photoUrls: readonly string[]): { html: string; text: string } | null {
  if (!photoUrls.length) return null;
  const legenda = `Site photos: attached to this email in full size${photoUrls.length > 4 ? ` (+${photoUrls.length - 4} more attached)` : ""}.`;
  return { html: blocoDeFotosHtml(photoUrls, { legenda, max: 4 }), text: legenda };
}

/** Referência sem o sufixo antigo " · Visit N" e o número da visita, se houver. */
function referenciaEVisita(jobReference: string, visitNumber?: number | null): { ref: string; visita: number | null } {
  const m = jobReference.match(/^(.*?)\s*·\s*Visit\s+(\d+)\s*$/i);
  const ref = (m ? m[1]! : jobReference).trim();
  const n = visitNumber ?? (m ? Number(m[2]) : null);
  return { ref, visita: n && n > 1 ? n : null };
}

export function buildPartnerJobConfirmationEmail(data: PartnerJobConfirmationData): {
  subject: string;
  html: string;
  text: string;
} {
  const { ref, visita } = referenciaEVisita(data.jobReference, data.visitNumber);
  const ag = agendaDoJob(data);
  const paga = pagaDoParceiro(data.priceDisplay);
  const tipo = data.jobTitle.trim() || "Job";
  const subject = assunto(visita ? `Visit ${visita} booked` : "Job booked", tipo, ag.data ?? "Date TBC", extractUkPostcode(data.propertyAddress), ref);
  const fotos = fotosDoJob((data.photoUrls ?? []).filter((u) => typeof u === "string" && u.trim().length > 0));
  const verJob = data.jobUrl?.trim() || data.reportUrl;
  const cliente = data.clientName?.trim() && data.clientName.trim() !== "—" ? data.clientName.trim() : null;

  const { html, text } = emailParceiro({
    preheader: semTravessao(`${tipo} on ${ag.data ?? "a date to be confirmed"}${ag.chegada ? `, ${ag.chegada}` : ""}. ${ref}.`),
    estado: visita ? { ...CHIP_PARCEIRO.booked, texto: `Visit ${visita} booked` } : CHIP_PARCEIRO.booked,
    // Copy da versão antiga (dono, 23/10/2026).
    titulo: "New job booked for you",
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: ["Here's everything you need to get started."],
    passos: passosDoJob(PASSO_ACEITO),
    metricas: [
      { rotulo: "Date", valor: ag.data ?? "TBC", sub: ag.fim ? `Expected finish ${ag.fim}` : null },
      { rotulo: "Arrival", valor: ag.chegada ?? (ag.data ? "TBC" : "") },
      { rotulo: "Your earnings", valor: paga?.valor ?? "TBC", sub: paga?.tipo ?? null },
    ],
    linhas: [
      ["Job", `#${ref}${visita ? ` · Visit ${visita}` : ""}`],
      ["Type of work", tipo],
      ["Client", cliente],
      ["Phone", data.clientPhone?.trim() || null],
      ["Address", enderecoOuNada(data.propertyAddress)],
      ["Scope of work", escopoInteiro(data.scope)],
    ],
    antesDoBotao: fotos ?? semFotosDoParceiro(),
    cta: data.reportUrl ? { label: "Submit job report", url: data.reportUrl } : verJob ? { label: "Open job in app", url: verJob } : null,
    linksSecundarios: data.jobUrl?.trim() && data.reportUrl ? [{ label: "Open job in app", url: data.jobUrl }] : [],
    letraPequena: notaDoCatalogo(data.partnerNotes),
  });
  return { subject, html, text };
}

/**
 * Status-update email — sent on cancelled / on_hold / status_changed /
 * resumed / completed events.
 */
export type PartnerJobStatusKind = "status_changed" | "cancelled" | "on_hold" | "resumed" | "completed" | "rescheduled" | "confirmation_request" | "booked";

export interface PartnerJobStatusUpdateData {
  kind: PartnerJobStatusKind;
  partnerFirstName: string;
  jobReference: string;
  jobTitle: string;
  /** YYYY-MM-DD — used in cancelled email subject. */
  scheduledDate?: string | null;
  clientName: string;
  /**
   * Telefone do cliente. O parceiro já é o dono deste job: reagendamento e
   * on-hold são exatamente as horas em que ele precisa falar com a pessoa, e
   * sem o número a ligação vem para o escritório repassar.
   */
  clientPhone?: string | null;
  propertyAddress: string;
  scope: string;
  /** Display label for the new status (e.g. "Cancelled", "On Hold", "In Progress"). */
  newStatusLabel: string;
  /** Optional reason line (cancellation reason, hold reason). */
  reason?: string | null;
  /** Where the partner submits the report — included for status changes that need it. */
  reportUrl: string;
  supportEmail?: string;
  supportPhone?: string;
}


/** Título curto de cada tipo genérico (o resto tem builder próprio). */
const KIND_TITULO: Record<PartnerJobStatusKind, string> = {
  status_changed:       "Job status updated",
  cancelled:            "Job cancelled",
  on_hold:              "Job on hold",
  resumed:              "Job resumed",
  completed:            "Job complete",
  rescheduled:          "New date for this job",
  confirmation_request: "New job for you",
  booked:               "You're booked",
};

export function buildPartnerJobStatusUpdateEmail(data: PartnerJobStatusUpdateData): {
  subject: string;
  html: string;
  text: string;
} {
  const tipo = data.jobTitle.trim() || "Job";
  const dia = dataDoJob(data.scheduledDate);

  // Cancelled nunca leva motivo (dono, 24/08): o mesmo email cobre cancelamento
  // de verdade, unassign e swap. Do lado do parceiro é tudo "o job saiu". E sem
  // nome, telefone nem escopo do cliente: o job não é mais dele.
  if (data.kind === "cancelled") {
    const { html, text } = emailParceiro({
      preheader: semTravessao(`Job cancelled · ${data.jobReference}`),
      estado: CHIP_PARCEIRO.cancelado,
      titulo: "This job has been cancelled",
      saudacao: saudacaoDoParceiro(data.partnerFirstName),
      paragrafos: ["The following job has been cancelled and will no longer be going ahead."],
      metricas: dia ? [{ rotulo: "Date", valor: dia, riscado: true }] : null,
      linhas: [
        ["Job", `#${data.jobReference}`],
        ["Type of work", tipo],
        ["Area", areaDoEndereco(data.propertyAddress)],
      ],
      avisos: [ajudaDoParceiro("Reply to this email. We'll respond as soon as we can.")],
    });
    return { subject: partnerJobCancelledEmailSubject({ jobReference: data.jobReference, jobTitle: tipo, scheduledDate: data.scheduledDate }), html, text };
  }

  if (data.kind === "completed") {
    const { html, text } = emailParceiro({
      preheader: semTravessao(`Job marked complete · ${data.jobReference}`),
      estado: { texto: "Completed", cor: "green", chip: true },
      titulo: "Job marked complete",
      saudacao: saudacaoDoParceiro(data.partnerFirstName),
      paragrafos: ["This job has been marked as complete."],
      passos: passosDoJob(PASSO_RELATORIO),
      metricas: dia ? [{ rotulo: "Date", valor: dia }] : null,
      linhas: [
        ["Job", `#${data.jobReference}`],
        ["Type of work", tipo],
        ["Address", enderecoOuNada(data.propertyAddress)],
      ],
      avisos: [ajudaDoParceiro("Reply to this email. We'll respond as soon as we can.")],
      cta: { label: "Open job in app", url: data.reportUrl },
    });
    return { subject: assunto("Job marked complete", data.jobReference), html, text };
  }

  const reason = data.reason?.trim() ? semTravessao(data.reason.trim()) : null;
  const titulo = KIND_TITULO[data.kind];
  const { html, text } = emailParceiro({
    preheader: semTravessao(`${titulo} · ${data.jobReference}`),
    estado: { texto: data.newStatusLabel, cor: data.kind === "resumed" ? "green" : "navy", chip: true },
    titulo,
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    metricas: dia ? [{ rotulo: "Date", valor: dia }] : null,
    linhas: [
      ["Job", `#${data.jobReference}`],
      ["Type of work", tipo],
      ["Reason", reason],
      ["Address", enderecoOuNada(data.propertyAddress)],
    ],
    cta: { label: "Open job in app", url: data.reportUrl },
  });
  return { subject: assunto(titulo, data.jobReference), html, text };
}

/**
 * Booking rescheduled email — sent when a job's scheduled date/window changes.
 * A data nova em destaque, a antiga riscada ao lado.
 */
export interface PartnerJobRescheduledData {
  /** First name of the recipient (partner first name, or customer first name when sending the customer variant). */
  recipientFirstName: string;
  jobReference: string;
  jobTitle: string;
  propertyAddress: string;
  /** Pre-formatted display strings (e.g. "Wed 21 Oct 26 · Arrival time 9AM – 12PM"). */
  oldDateLine: string;
  oldTimeLine?: string | null;
  newDateLine: string;
  newTimeLine?: string | null;
  /** Onde o parceiro vê o job (portal). Sem ele, sem botão. */
  jobUrl?: string | null;
  supportEmail?: string;
  supportPhone?: string;
}

export function buildJobRescheduledEmail(data: PartnerJobRescheduledData): {
  subject: string;
  html: string;
  text: string;
} {
  const nova = agendaDaLinha(data.newDateLine, data.newTimeLine);
  const antiga = agendaDaLinha(data.oldDateLine, data.oldTimeLine);
  const novaTexto = [nova.data, nova.chegada].filter(Boolean).join(", ");
  // Assunto e copy da versão antiga (dono, 23/10/2026).
  const subject = assunto("Booking rescheduled", data.jobReference);

  const { html, text } = emailParceiro({
    preheader: semTravessao(`Your booking ${data.jobReference} has been rescheduled to ${novaTexto || "a new date"}.`),
    estado: CHIP_PARCEIRO.remarcado,
    titulo: "Your booking has been rescheduled",
    saudacao: saudacaoDoParceiro(data.recipientFirstName),
    paragrafos: ["Quick heads up: this job has moved. Please update your calendar."],
    passos: passosDoJob(PASSO_NO_DIA),
    metricas: [
      { rotulo: "New schedule", valor: nova.data || "TBC", sub: nova.chegada ?? null },
      { rotulo: "Was", valor: antiga.data || "", sub: antiga.data && antiga.chegada ? antiga.chegada : null, riscado: true },
    ],
    linhas: [
      ["Booking", `#${data.jobReference}`],
      ["Type of work", data.jobTitle?.trim() || null],
      ["Address", enderecoOuNada(data.propertyAddress)],
    ],
    avisos: [ajudaDoParceiro("The new date doesn't work? Just reply to this email and we'll sort it.", "")],
    cta: data.jobUrl?.trim() ? { label: "Open job in app", url: data.jobUrl } : null,
  });
  return { subject, html, text };
}

export function partnerJobOnHoldIsComplaint(presetId: string | null | undefined): boolean {
  return (presetId ?? "").trim() === "complaint";
}

/** Complaint: `Action required · Complaint for JOB-9267`. Other reasons: `Job on hold · JOB-9267`. */
export function partnerJobOnHoldEmailSubject(args: {
  jobReference: string;
  presetId: string | null | undefined;
  jobTitle?: string | null;
  propertyAddress?: string | null;
}): string {
  // Assuntos antigos (já distintos), com a referência inteira.
  return partnerJobOnHoldIsComplaint(args.presetId)
    ? assunto("Action required", `Complaint for ${args.jobReference}`)
    : assunto("Job on hold", args.jobReference);
}

/**
 * On-hold email — complaint variant (urgent) or general (awaiting next stage).
 */
export interface PartnerJobOnHoldData {
  partnerFirstName: string;
  jobReference:     string;
  jobTitle:         string;
  propertyAddress:  string;
  /** On-hold reason preset id from `jobs.on_hold_reason_preset_id`. */
  presetId:         string | null | undefined;
  /** Partner-scoped resolve form — complaint variant only. */
  resolveUrl:       string;
  /** What the customer reported — complaint variant only. */
  complaintReason?: string | null;
  supportEmail?:    string;
  supportPhone?:    string;
}

export function buildPartnerJobOnHoldEmail(data: PartnerJobOnHoldData): {
  subject: string;
  html:    string;
  text:    string;
} {
  const isComplaint = partnerJobOnHoldIsComplaint(data.presetId);
  const subject = partnerJobOnHoldEmailSubject({ jobReference: data.jobReference, presetId: data.presetId, jobTitle: data.jobTitle, propertyAddress: data.propertyAddress });
  const local = data.propertyAddress?.trim() && data.propertyAddress.trim() !== "—" ? data.propertyAddress.trim() : null;

  if (isComplaint) {
    // Exatamente o e-mail antigo (dono, 23/10/2026): ver partner-complaint-email-antigo.ts.
    const { html, text } = buildPartnerComplaintEmailAntigo({
      partnerFirstName: data.partnerFirstName,
      jobReference: data.jobReference,
      jobTitle: data.jobTitle,
      propertyAddress: data.propertyAddress,
      resolveUrl: data.resolveUrl,
      complaintReason: data.complaintReason,
      supportEmail: data.supportEmail,
      supportPhone: data.supportPhone,
    });
    return { subject, html, text };
  }

  const { html, text } = emailParceiro({
    preheader: `Job ${data.jobReference} is on hold, awaiting next stage.`,
    estado: CHIP_PARCEIRO.emEspera,
    titulo: "This job is on hold",
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: ["No action is needed from you right now. We'll be in touch when the job is ready to move forward."],
    linhas: [
      ["Job", `#${data.jobReference}`],
      ["Type of work", data.jobTitle?.trim() || null],
      ["Status", "Awaiting next stage"],
      ["Location", local],
    ],
    avisos: [ajudaDoParceiro("Reply to this email or message us on", "Need to talk this through?")],
  });
  return { subject, html, text };
}

/**
 * "Please confirm this job within 24h".
 * Sent when OS directly assigns a partner to a job that did NOT come from
 * an approved bid (manual assignment). Includes an Accept link bound to
 * (jobId, partnerId). Partner clicks → POST /api/jobs/confirm-acceptance →
 * jobs.partner_confirmed_at stamped → booked email follows.
 */
export interface PartnerJobConfirmationRequestData extends PartnerJobEmailScheduleFields {
  partnerFirstName: string;
  jobReference:     string;
  jobTitle:         string;
  clientName:       string;
  /**
   * Sem telefone, e de propósito: este é o convite, o job ainda não é de
   * ninguém, e o número iria para vários parceiros que talvez nem aceitem.
   * O telefone entra na confirmação, quando já há um dono.
   */
  propertyAddress:  string;
  scope:            string;
  /** £ display value (e.g. "£280.00"). */
  priceDisplay:     string;
  /** Tokenised accept URL — required. */
  acceptUrl:        string;
  /** Portal de parceiros (oportunidades): ver a oferta, o prazo e as outras. */
  portalUrl?:       string | null;
  /** Hours within which the partner is expected to accept. Default 24. */
  responseHours?:   number;
  /** Hourly/fixed + type-of-work rules shown before the Accept CTA. */
  partnerNotes?:    string | null;
  supportEmail?:    string;
  supportPhone?:    string;
}

export function buildPartnerJobConfirmationRequestEmail(
  data: PartnerJobConfirmationRequestData,
): { subject: string; html: string; text: string } {
  const tipo = data.jobTitle.trim() || "Job";
  const ag = agendaDoJob(data);
  // Assunto antigo ("Job offer", já distinto) e copy antiga (dono, 23/10/2026).
  const subject = assunto("Job offer", tipo, ag.data ?? "Date TBC", extractUkPostcode(data.propertyAddress));

  // Oferta enxuta e diferente do job booked (dono, 23/10/2026): sem saudação,
  // régua, escopo nem tabela. Só onde, quando, quanto e o botão de aceitar.
  const postcode = extractUkPostcode(data.propertyAddress) ?? areaDoEndereco(data.propertyAddress) ?? "TBC";
  const { html, text } = emailParceiro({
    preheader: semTravessao(`${tipo} · ${postcode} · ${ag.data ?? "Date TBC"}${ag.chegada ? `, ${ag.chegada}` : ""}. Tap to accept.`),
    estado: { texto: "New job available", cor: "green", chip: true },
    titulo: "A new job is available. Interested?",
    paragrafos: [`A ${tipo} job is available in your area. Review the details below and accept if you're available.`],
    metricas: [
      { rotulo: "Location", valor: postcode },
      { ...metricaDaPaga(data.priceDisplay), rotulo: "Your rate" },
      { rotulo: "Date & time", valor: ag.data ?? "TBC", sub: ag.chegada ?? null },
    ],
    cta: { label: "Accept this job →", url: data.acceptUrl },
    linksSecundarios: data.portalUrl ? [{ label: "View full job details", url: data.portalUrl }] : [],
    letraPequena: ["This job is offered on a first-come, first-served basis. Once accepted, it will no longer be available to other professionals."],
  });
  return { subject, html, text };
}

