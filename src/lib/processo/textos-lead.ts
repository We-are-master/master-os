/**
 * O texto do e-mail de boas-vindas ao lead (plano do dono, 22/10/2026, etapa 3).
 *
 * PENDENTE DE APROVAÇÃO DO DONO antes de ligar (process_rules.v2 da conta Fixfy).
 * Inglês, formal e simples; sem travessão; nunca dizer que quem escreve é IA ou bot.
 * Sai como comentário público no ticket do lead, então a assinatura do Zendesk entra
 * sozinha: aqui não vai assinatura.
 */
import { emailPessoal, saudacao } from "@/lib/emails/fixfy-shell";
import { servicoCurto } from "@/lib/zendesk-quote-sent";

export type BoasVindasDoLead = { nome: string | null; servico: string | null; checkatrade: boolean };

export function paragrafosDeBoasVindas(l: BoasVindasDoLead): string[] {
  const s = servicoCurto(l.servico);
  const origem = l.checkatrade ? " through Checkatrade" : "";
  return [
    `Thank you for your enquiry${origem}${s ? ` about ${s}` : ""}. We have received your request and our team is reviewing it.`,
    "To prepare an accurate quote, it helps to have a few photos of the work and the property postcode. You can simply reply to this email with them.",
    "We will be in touch shortly with the next steps. If you would prefer to discuss it by phone, please let us know a convenient time to call.",
  ];
}

export function emailDeBoasVindasDoLead(l: BoasVindasDoLead): { html: string; text: string } {
  const primeiro = String(l.nome ?? "").trim();
  return emailPessoal({
    preheader: "We have received your request and will be in touch shortly.",
    saudacao: saudacao({ tipo: "b2c", primeiroNome: /^(there|unnamed.*|checkatrade lead)$/i.test(primeiro) ? "" : primeiro }),
    paragrafos: paragrafosDeBoasVindas(l),
    zendesk: true,
  });
}
