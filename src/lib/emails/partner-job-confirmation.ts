/**
 * Os e-mails de job ao parceiro: oferta, job confirmado (e visita extra),
 * mudança de status (cancelado, concluído…), remarcação e on hold.
 *
 * Saem como conversa lateral no ticket do Zendesk do job (Resend quando o job
 * não tem ticket), então usam a moldura única (`emailFixfy`) na variante
 * `zendesk: true`, sem tabela interna. O texto é o de sempre; o que mudou em
 * 20/10/2026 foi o desenho ("Painel de status": chip de estado, régua da vida
 * do job, faixa de métricas, detalhes em duas colunas, um botão navy).
 */

import { emailFixfy, dataLonga, type Estado, type Metrica } from "@/lib/emails/fixfy-shell";
import {
  MARCA_FOTOS,
  PASSO_ACEITO,
  PASSO_NO_DIA,
  PASSO_OFERTA,
  PASSO_PAGO,
  agendaDaLinha,
  blocoDeFotosHtml,
  comFotos,
  metricasDaAgenda,
  notaLimpa,
  paragrafosDoEscopo,
  passosDoJob,
  saudacaoDoParceiro,
  semTravessao,
} from "@/lib/emails/partner-shell";
import { splitMoneyIncVatParts } from "@/lib/money-display-label";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE } from "@/lib/partner-job-email-notes";
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
  /** Hourly/fixed + type-of-work rules shown in the notice block. */
  partnerNotes?: string | null;
}

/** JOB-9265 → 9265 */
export function partnerJobEmailShortRef(jobReference: string): string {
  return jobReference.replace(/^JOB-/i, "").trim() || jobReference.trim();
}

/** `2026-10-21` vira `Wed 21 Oct 26`; sem data, "TBC". */
function formatPartnerJobEmailSubjectDate(scheduledDate?: string | null): string {
  const raw = scheduledDate?.trim();
  if (!raw) return "TBC";
  const ymd = raw.match(/^\d{4}-\d{2}-\d{2}/)?.[0];
  return dataLonga(ymd ?? raw) ?? raw;
}

function partnerJobEmailSubject(args: {
  kind: "offer" | "booked";
  jobTitle: string;
  scheduledDate?: string | null;
  propertyAddress: string;
}): string {
  const typeOfWork = args.jobTitle.trim() || "Job";
  const postcode = extractUkPostcode(args.propertyAddress);
  const date = formatPartnerJobEmailSubjectDate(args.scheduledDate);
  const partes = [args.kind === "offer" ? "Job offer" : "Job confirmed", typeOfWork, date, postcode].filter(Boolean);
  return semTravessao(partes.join(" · "));
}

/** e.g. Job cancelled · General Maintenance · Mon 1 Jun 26 */
export function partnerJobCancelledEmailSubject(args: {
  jobTitle: string;
  scheduledDate?: string | null;
}): string {
  const typeOfWork = args.jobTitle.trim() || "Job";
  const date = formatPartnerJobEmailSubjectDate(args.scheduledDate);
  return semTravessao(`Job cancelled · ${typeOfWork} · ${date}`);
}

/** O que o parceiro ganha: valor grande, "inc VAT · Fixed" embaixo. */
function metricaDeGanho(priceDisplay: string, pill?: string | null): Metrica {
  const { core, hasIncVat } = splitMoneyIncVatParts(priceDisplay);
  const sub = [hasIncVat ? "inc VAT" : null, pill ?? null].filter(Boolean).join(" · ");
  return { rotulo: "Your earnings", valor: core, sub: sub || null };
}

/**
 * As fotos do trabalho dentro do email de job confirmado.
 *
 * Miniaturas em fileira, e não uma coluna de fotos grandes (dono,
 * 03/09/2026). A miniatura serve para RECONHECER ("é aquela cozinha") e não
 * para inspecionar: quem quer inspecionar abre o anexo, que vem em tamanho
 * cheio no mesmo email.
 */
function fotosDoJob(photoUrls: readonly string[]): { html: string; text: string } {
  if (!photoUrls.length) return { html: "", text: "" };
  const sobra = photoUrls.length > 4 ? ` (+${photoUrls.length - 4} more attached)` : "";
  const legenda = `Site photos: attached to this email in full size${sobra}.`;
  return { html: blocoDeFotosHtml(photoUrls, { legenda, max: 4 }), text: legenda };
}

export function buildPartnerJobConfirmationEmail(data: PartnerJobConfirmationData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = partnerJobEmailSubject({
    kind: "booked",
    jobTitle: data.jobTitle,
    scheduledDate: data.scheduledDate,
    propertyAddress: data.propertyAddress,
  });
  const pill = data.jobType === "hourly" ? "Hourly" : "Fixed";
  const partnerNotes = notaLimpa(data.partnerNotes);
  const fotos = fotosDoJob((data.photoUrls ?? []).filter((u) => typeof u === "string" && u.trim().length > 0));

  const r = emailFixfy({
    zendesk: true,
    preheader: "Job booked. Here's everything you need to get started.",
    estado: { texto: "Confirmed", cor: "green" },
    titulo: "New job booked for you",
    passos: passosDoJob(PASSO_ACEITO),
    metricas: [metricaDeGanho(data.priceDisplay, pill), ...metricasDaAgenda(data)],
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      "Here's everything you need to get started.",
      ...paragrafosDoEscopo(data.scope),
      ...(fotos.html ? [MARCA_FOTOS] : []),
    ],
    linhas: [
      ["Job", `#${data.jobReference}`],
      ["Type of work", data.jobTitle],
      ["Client", data.clientName],
      ["Phone", data.clientPhone?.trim() || null],
      ["Address", data.propertyAddress],
    ],
    nota: partnerNotes ? `Important, before you start: ${partnerNotes}` : null,
    cta: data.reportUrl ? { label: "Submit job report", url: data.reportUrl } : null,
    letraPequena: [notaLimpa(PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE), "You're receiving this email because you're registered as a partner with Fixfy."],
  });
  const { html, text } = fotos.html ? comFotos(r, fotos.html, fotos.text) : r;
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

const KIND_HEADLINE: Record<PartnerJobStatusKind, string> = {
  status_changed:       "Job status updated",
  cancelled:            "Job cancelled",
  on_hold:              "Job placed on hold",
  resumed:              "Job resumed",
  completed:            "Job marked complete",
  rescheduled:          "Job rescheduled",
  // confirmation_request / booked are handled by their own dedicated builders
  // and never hit this generic status-update layout, but they still need to
  // satisfy the Record type (unused values).
  confirmation_request: "Action required",
  booked:               "Job booked",
};

const KIND_INTRO: Record<PartnerJobStatusKind, string> = {
  status_changed:       "The status of one of your jobs has changed.",
  cancelled:            "Unfortunately, this job has been cancelled by the office.",
  on_hold:              "This job has been placed on hold.",
  resumed:              "This job has been resumed and is active again.",
  completed:            "This job has been marked as complete.",
  rescheduled:          "This job has been moved to a new date.",
  confirmation_request:
    "Be quicker than others and secure this job before it gets taken.",
  booked:               "Your job is booked.",
};

/** Cor do chip: cancelado apagado, concluído/retomado verde, espera laranja. */
const KIND_COR: Record<PartnerJobStatusKind, Estado["cor"]> = {
  status_changed:       "navy",
  cancelled:            "muted",
  on_hold:              "orange",
  resumed:              "green",
  completed:            "green",
  rescheduled:          "orange",
  confirmation_request: "navy",
  booked:               "green",
};

export function buildPartnerJobStatusUpdateEmail(data: PartnerJobStatusUpdateData): {
  subject: string;
  html: string;
  text: string;
} {
  const headline = KIND_HEADLINE[data.kind];
  const intro = KIND_INTRO[data.kind];
  const cancelado = data.kind === "cancelled";
  const subject = cancelado
    ? partnerJobCancelledEmailSubject({ jobTitle: data.jobTitle, scheduledDate: data.scheduledDate })
    : semTravessao(`${headline} · ${data.jobReference}`);

  // Cancelled nunca leva motivo (dono, 24/08): o mesmo email cobre cancelamento
  // de verdade, unassign e swap. Do lado do parceiro é tudo "o job saiu", e o
  // motivo interno não é assunto dele.
  const reason = !cancelado && data.reason?.trim() ? semTravessao(data.reason.trim()) : null;
  const data_ = data.scheduledDate?.trim() ? formatPartnerJobEmailSubjectDate(data.scheduledDate) : null;

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: semTravessao(`${headline} · ${data.jobReference}`),
    estado: { texto: data.newStatusLabel, cor: KIND_COR[data.kind] },
    titulo: cancelado ? "This job has been cancelled." : headline,
    passos: data.kind === "completed" ? passosDoJob(PASSO_PAGO) : null,
    metricas: data_ ? [{ rotulo: "Date", valor: data_ }] : null,
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      cancelado ? "The following job has been cancelled and will no longer be going ahead." : intro,
      ...(reason ? [`Reason: ${reason}`] : []),
      ...paragrafosDoEscopo(data.scope),
    ],
    linhas: [
      ["Job", `#${data.jobReference}`],
      ["Type of work", data.jobTitle],
      ["Client", data.clientName],
      ["Phone", data.clientPhone?.trim() || null],
      ["Address", data.propertyAddress],
      ["Status", data.newStatusLabel],
    ],
    nota: "Questions? Reply to this email, we'll respond as soon as we can.",
    // Cancelado não tem botão: não há nada para o parceiro fazer.
    cta: cancelado ? null : { label: "Open job in app", url: data.reportUrl },
  });
  return { subject, html, text };
}

/**
 * Booking rescheduled email — sent when a job's scheduled date/window changes.
 * A agenda nova em destaque, a antiga riscada embaixo.
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
  supportEmail?: string;
  supportPhone?: string;
}

export function buildJobRescheduledEmail(data: PartnerJobRescheduledData): {
  subject: string;
  html: string;
  text: string;
} {
  const subject = semTravessao(`Booking rescheduled · ${data.jobReference}`);
  const nova = agendaDaLinha(data.newDateLine, data.newTimeLine);
  const antiga = agendaDaLinha(data.oldDateLine, data.oldTimeLine);
  const novaTexto = [nova.data, nova.chegada].filter(Boolean).join(", ");
  const antigaTexto = [antiga.data, antiga.chegada].filter(Boolean).join(", ");

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: `Your booking ${data.jobReference} has been rescheduled to ${novaTexto || "a new date"}.`,
    estado: { texto: "Rescheduled", cor: "orange" },
    titulo: "Your booking has been rescheduled",
    passos: passosDoJob(PASSO_NO_DIA),
    metricas: [
      { rotulo: "New date", valor: nova.data || "TBC" },
      { rotulo: "Arrival", valor: nova.chegada ?? "" },
    ],
    destaque: { linha1: nova.data || "TBC", riscado: antigaTexto || null },
    saudacao: saudacaoDoParceiro(data.recipientFirstName),
    paragrafos: [
      "Quick heads up: this job has moved. The new schedule is above and the old one is crossed out. Please update your calendar.",
    ],
    linhas: [
      ["Booking", `#${data.jobReference}`],
      ["Type of work", data.jobTitle],
      ["Address", data.propertyAddress],
    ],
    nota: "The new date doesn't work? Just reply to this email and we'll sort it.",
  });
  return { subject, html, text };
}

export function partnerJobOnHoldIsComplaint(presetId: string | null | undefined): boolean {
  return (presetId ?? "").trim() === "complaint";
}

/** Complaint: `Action required · Complaint for 9267`. Other reasons: `Job on hold · 9267`. */
export function partnerJobOnHoldEmailSubject(args: {
  jobReference: string;
  presetId: string | null | undefined;
}): string {
  const shortRef = partnerJobEmailShortRef(args.jobReference);
  if (partnerJobOnHoldIsComplaint(args.presetId)) {
    return `Action required · Complaint for ${shortRef}`;
  }
  return `Job on hold · ${shortRef}`;
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
  const subject = partnerJobOnHoldEmailSubject({ jobReference: data.jobReference, presetId: data.presetId });
  const rawReason = (data.complaintReason ?? "").trim();
  const showReason = isComplaint && rawReason.length > 0 && !/^customer complaint/i.test(rawReason);
  const local = data.propertyAddress?.trim() || null;

  if (isComplaint) {
    const { html, text } = emailFixfy({
      zendesk: true,
      preheader: `Job ${data.jobReference}: complaint raised. Please reply within 12 hours.`,
      estado: { texto: "Action required · reply within 12 hours", cor: "orange" },
      titulo: "A complaint was raised on this job",
      metricas: [
        { rotulo: "Reply within", valor: "12 hours" },
        { rotulo: "Payment", valor: "On hold", sub: "until resolved" },
      ],
      saudacao: saudacaoDoParceiro(data.partnerFirstName),
      paragrafos: [
        "We need your help to resolve it.",
        "A complaint has come in about the job below, so we've placed it on hold while we look into it. We've committed to the customer that we'll resolve this within 24 hours, so we'll need your reply with the evidence below within 12 hours.",
        "Payment on hold until resolved. Your payment for this job is paused until we receive the evidence and close the case.",
        "What we need from you. Tap the button below and reply in the complaint journal with:",
        "· A short written summary of what was done and how you can resolve the issue",
        "· Photos of the work area / completed work",
        "· Anything relevant: receipts for materials, certificates (CP12, electrical), etc.",
      ],
      linhas: [
        ["Job", `#${data.jobReference}`],
        ["Type of work", data.jobTitle],
        ["Status", "On hold"],
        ["Location", local],
      ],
      nota: showReason ? `What the customer reported: ${semTravessao(rawReason)}` : null,
      cta: { label: "Reply in the journal", url: data.resolveUrl },
      letraPequena: [
        "Opens your partner portal already signed in, on this job. Write what happened and add photos.",
        "Please respond within 12 hours so we can resolve this for the customer in time.",
        `Button not working? Paste this link into your browser: ${data.resolveUrl}`,
        "You're receiving this email because you're registered as a partner with Fixfy.",
      ],
    });
    return { subject, html, text };
  }

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: `Job ${data.jobReference} is on hold, awaiting next stage.`,
    estado: { texto: "On hold", cor: "orange" },
    titulo: "This job is on hold, awaiting next stage",
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      "We've placed this job on hold while we coordinate the next step. No action is needed from you right now. We'll be in touch when the job is ready to move forward.",
    ],
    linhas: [
      ["Job", `#${data.jobReference}`],
      ["Type of work", data.jobTitle],
      ["Status", "Awaiting next stage"],
      ["Location", local],
    ],
    letraPequena: ["You're receiving this email because you're registered as a partner with Fixfy."],
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
  const subject = partnerJobEmailSubject({
    kind: "offer",
    jobTitle: data.jobTitle,
    scheduledDate: data.scheduledDate,
    propertyAddress: data.propertyAddress,
  });
  const postcode = extractUkPostcode(data.propertyAddress);
  const partnerNotes = notaLimpa(data.partnerNotes);

  const { html, text } = emailFixfy({
    zendesk: true,
    preheader: "Be quicker than others and secure this job before it gets taken.",
    estado: { texto: "Action required", cor: "navy" },
    titulo: semTravessao(`Job offer · ${data.jobTitle.trim() || "Job"}`),
    passos: passosDoJob(PASSO_OFERTA),
    metricas: [metricaDeGanho(data.priceDisplay), ...metricasDaAgenda(data)],
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      "Be quicker than others and secure this job before it gets taken.",
      "We've allocated the live job below for you. Tap Accept Job Now so we can immediately confirm the booking with the customer.",
      "The faster you accept, the higher your chances of securing the work.",
      ...paragrafosDoEscopo(data.scope),
    ],
    linhas: [
      ["Job", `#${data.jobReference}`],
      ["Area", postcode ?? "TBC"],
    ],
    nota: partnerNotes ? `Important, before you start: ${partnerNotes}` : null,
    cta: { label: "Accept Job Now", url: data.acceptUrl },
    linksSecundarios: data.portalUrl ? [{ label: "See it in your partner portal", url: data.portalUrl }] : [],
    letraPequena: [notaLimpa(PARTNER_JOB_EMAIL_NOTES_REPORT_DEADLINE), "Can't take it? Reply to this email and we'll reallocate."],
  });
  return { subject, html, text };
}
