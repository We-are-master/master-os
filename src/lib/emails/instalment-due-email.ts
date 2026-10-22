/**
 * Copy 14: parcela do cliente vence hoje (`/api/cron/parcelas-cliente`), na moldura
 * única. Puro: a rota busca, isto escreve.
 *
 * A referência é a normalizada (INV-…), a mesma do PDF; a gravada (RCP-…) só no link.
 */
import { dataLonga, emailFixfy, gbp, saudacao, type Publico } from "./fixfy-shell";
import { dadosBancariosVerificados, referenciaDeCobranca, semTravessao } from "./billing-email-common";
import { passosAte, PASSOS_FATURA } from "./faixas-do-email";

export type InstalmentDueEmailInput = {
  publico: Publico;
  /** Referência da fatura como está gravada (vira INV- aqui). */
  invoiceReference: string;
  instalmentNumber: number;
  instalmentCount: number;
  amount: number;
  /** YYYY-MM-DD */
  dueDate: string;
  service: string | null;
  payUrl: string | null;
  /** Linhas da conta; padrão = a conta verificada da configuração. */
  bankRows?: Array<[string, string]>;
};

export function buildInstalmentDueEmail(d: InstalmentDueEmailInput): { subject: string; preheader: string; html: string; text: string } {
  const ref = referenciaDeCobranca(d.invoiceReference);
  const valor = gbp(d.amount);
  const due = dataLonga(d.dueDate.slice(0, 10)) ?? d.dueDate;
  const total = Math.max(d.instalmentCount, d.instalmentNumber);
  const service = semTravessao(d.service) || "your job";
  const banco = d.bankRows ?? dadosBancariosVerificados();
  const subject = `Your ${valor} instalment is due today · ${ref}`;
  const preheader = `Instalment ${d.instalmentNumber} of ${total} is due on ${due}.`;
  const { html, text } = emailFixfy({
    preheader,
    estado: { texto: "Payment due", cor: "red" },
    titulo: "Your next instalment",
    destaque: { linha1: `${valor} due`, linha2: `today, ${due}` },
    metricas: [
      { rotulo: "Amount due", valor, sub: `instalment ${d.instalmentNumber} of ${total}` },
      { rotulo: "Due by", valor: due, sub: "today" },
    ],
    passos: passosAte(PASSOS_FATURA, 2),
    saudacao: saudacao(d.publico),
    paragrafos: [
      `A quick reminder that instalment ${d.instalmentNumber} of ${total} for ${service} is due today, ${due}. The amount to pay is ${valor}.`,
      "You can pay using the button or bank details below. If you’ve already paid, thank you. Please reply with the payment date and reference so we can check.",
      "Any questions about the instalment? Just let us know.",
    ],
    linhas: [
      ["Reference", ref],
      ["Instalment", `${d.instalmentNumber} of ${total}`],
      ["Amount due", valor],
      ["Due date", due],
    ],
    cta: d.payUrl ? { label: `Pay ${valor}`, url: d.payUrl } : null,
    transferencia: ref && banco.length ? { dadosBancarios: banco, referencia: ref } : null,
  });
  return { subject, preheader, html, text };
}
