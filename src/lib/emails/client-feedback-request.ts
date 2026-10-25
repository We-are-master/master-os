/**
 * Pedido de feedback ao CLIENTE no dia seguinte ao job (dono, 25/10/2026).
 *
 * Substitui o WhatsApp `job_feedback`: confirmação e aviso ao cliente saem por
 * e-mail, WhatsApp fica para o informal. Vai dentro do ticket do job, então
 * "responda este e-mail" cai no mesmo ticket e a equipe vê.
 *
 * O link do botão é `FEEDBACK_REVIEW_URL` (o dono ainda escolhe qual). Sem ele,
 * não há botão: o e-mail pede a resposta, que já basta para pegar problema.
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

export function linkDoFeedback(): string | null {
  return process.env.FEEDBACK_REVIEW_URL?.trim() || null;
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
    cta: link ? { label: "Leave feedback", url: link } : null,
    zendesk: true,
  });

  return { subject: `How did your ${servico} go?`, html, text };
}
