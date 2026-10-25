/**
 * Pedido de feedback ao CLIENTE no dia seguinte ao job (dono, 25/10/2026).
 *
 * Substitui o WhatsApp `job_feedback`: confirmação e aviso ao cliente saem por
 * e-mail, WhatsApp fica para o informal. Vai dentro do ticket do job, então
 * "responda este e-mail" cai no mesmo ticket e a equipe vê.
 *
 * O link do botão é `FEEDBACK_REVIEW_URL`; por ora, o perfil da Fixfy no Google
 * (dono, 25/10/2026, o mesmo do e-mail de avaliação). Sem link, não há botão:
 * o e-mail pede a resposta.
 */
import { emailFixfy, saudacao } from "./fixfy-shell";
import { passosAte, PASSOS_VISITA } from "./faixas-do-email";

export type ClientFeedbackData = {
  clientFirstName: string;
  jobReference: string;
  jobTitle: string;
  /** "Monday 19 October 2026", quando houver. */
  completedOn?: string | null;
  propertyAddress?: string | null;
  /** Sem link, sem botão. */
  feedbackUrl?: string | null;
};

export const PERFIL_DO_GOOGLE = "https://share.google/xs9HzIccBF88TgZoj";

export function linkDoFeedback(): string {
  return process.env.FEEDBACK_REVIEW_URL?.trim() || PERFIL_DO_GOOGLE;
}

export function buildClientFeedbackRequestEmail(d: ClientFeedbackData): { subject: string; html: string; text: string } {
  const servico = d.jobTitle.trim() || "job";
  const link = d.feedbackUrl?.trim() || null;
  const quando = d.completedOn?.trim() ? ` on ${d.completedOn.trim()}` : "";

  const { html, text } = emailFixfy({
    preheader: "Was everything done the way you wanted?",
    estado: { texto: "Completed", cor: "green" },
    titulo: "How did we do?",
    passos: passosAte(PASSOS_VISITA, 3),
    saudacao: saudacao({ tipo: "b2c", primeiroNome: d.clientFirstName }),
    paragrafos: [
      `Your ${servico} was completed${quando}. We hope everything was done the way you wanted.`,
      "If anything isn’t quite right, just reply to this email and we’ll sort it out.",
      link
        ? "If you were happy, it would mean a lot if you told us how it went. It takes less than a minute."
        : "If you were happy, a quick reply telling us how it went would mean a lot.",
    ],
    linhas: [
      ["Service", servico],
      ["Property", d.propertyAddress],
      ["Booking", d.jobReference],
    ],
    cta: link ? { label: "Leave a review", url: link } : null,
    zendesk: true,
  });

  return { subject: `How did your ${servico} go?`, html, text };
}
