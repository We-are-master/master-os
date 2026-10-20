import { dataLonga, emailFixfy, gbp, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { dadosBancariosVerificados, referenciaDeCobranca } from "@/lib/emails/billing-email-common";
import { passosAte, PASSOS_FATURA } from "@/lib/emails/faixas-do-email";

/**
 * Lembrete de fatura vencida (dono, 09/10/2026).
 * Dias depois do vencimento: 1, 3 e 4 = amigável; 7 = final reminder. Um por vez, em ordem.
 */
export const OVERDUE_REMINDER_DAYS = [1, 3, 4, 7] as const;
export const FINAL_REMINDER_STAGE = OVERDUE_REMINDER_DAYS.length;

/** Dias inteiros entre o vencimento e hoje (calendário de Londres). */
export function daysOverdue(dueYmd: string, todayYmd: string): number {
  const a = Date.parse(`${dueYmd}T00:00:00Z`);
  const b = Date.parse(`${todayYmd}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.floor((b - a) / 86_400_000);
}

/**
 * Fatura vencida há mais que isto sem nenhum lembrete não entra na sequência automática
 * (11/10/2026: a primeira passada mandou lembrete numa fatura de 34 dias, de cliente em
 * reclamação). Atraso velho é conversa da equipe, que sabe se há acordo ou disputa.
 */
export const MAX_DIAS_PARA_COMECAR = 14;

/**
 * Próximo estágio a mandar hoje, ou null. Respeita o intervalo da sequência (1, 3, 4, 7
 * dias) também quando a fatura está muito atrasada: antes, uma fatura velha recebia um
 * lembrete por dia até o final.
 */
export function nextReminderStage(currentStage: number, overdueDays: number, daysSinceLast: number | null = null): number | null {
  if (currentStage >= FINAL_REMINDER_STAGE) return null;
  if (currentStage === 0 && overdueDays > MAX_DIAS_PARA_COMECAR) return null;
  const next = currentStage + 1;
  if (overdueDays < OVERDUE_REMINDER_DAYS[next - 1]) return null;
  if (currentStage > 0) {
    const intervalo = OVERDUE_REMINDER_DAYS[next - 1] - OVERDUE_REMINDER_DAYS[next - 2];
    if (daysSinceLast == null || daysSinceLast < intervalo) return null;
  }
  return next;
}

export function londonTodayYmd(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

/**
 * Texto de cada estágio (copy 15 a 18, docs/copy/fixfy-client-copy.json). Os quatro são
 * distintos: dia 1 lembrete, dia 3 saldo em aberto, dia 4 pedido de atualização, dia 7
 * o último lembrete agendado (sem multa, ameaça ou corte de serviço).
 */
export function reminderCopy(
  stage: number,
  a: { reference: string; amount: string; dueLabel: string; documentName?: string },
) {
  const final = stage >= FINAL_REMINDER_STAGE;
  const doc = a.documentName ?? "invoice";
  const due = a.dueLabel ? `, due on ${a.dueLabel}` : "";
  if (final) {
    return {
      final,
      estado: "Final reminder",
      subject: `Final payment reminder · ${a.reference}`,
      preheader: a.dueLabel ? `${a.amount} remains outstanding from ${a.dueLabel}.` : `${a.amount} remains outstanding.`,
      heading: "Final payment reminder",
      body: [
        `This is our final scheduled reminder for ${doc} ${a.reference}. Our records show ${a.amount} remains outstanding${due}.`,
        "Please arrange payment today, or reply if there is a question or issue we need to resolve first.",
        "If you’ve already paid, please send the payment date and reference so we can check. Thank you for your attention.",
      ],
    };
  }
  if (stage === 1) {
    return {
      final,
      estado: "Payment reminder",
      subject: `Payment reminder · ${a.reference}`,
      preheader: `Our records show ${a.amount} outstanding${due}.`,
      heading: "A reminder about your payment",
      body: [
        `Just a reminder that ${a.amount} remains outstanding on ${doc} ${a.reference}${a.dueLabel ? `, which was due on ${a.dueLabel}` : ""}.`,
        "If you’ve already paid, thank you. Please reply with the payment date and reference so we can check. Otherwise, the payment details are below.",
        "If there’s anything you’d like us to look into, we’re happy to help.",
      ],
    };
  }
  if (stage === 2) {
    return {
      final,
      estado: "Payment outstanding",
      subject: `Payment outstanding · ${a.reference}`,
      preheader: `Please check the outstanding balance of ${a.amount}.`,
      heading: "Your outstanding balance",
      body: [
        `We’re following up on ${doc} ${a.reference}. Our records still show ${a.amount} outstanding${a.dueLabel ? `, with payment due on ${a.dueLabel}` : ""}.`,
        "Please arrange payment using the details below. If payment is on its way, or there’s a query we need to resolve, just reply and let us know.",
        "Thank you for your help.",
      ],
    };
  }
  return {
    final,
    estado: "Payment update",
    subject: `Payment update requested · ${a.reference}`,
    preheader: `Please let us know about the outstanding ${a.amount} balance.`,
    heading: "Could you update us on payment?",
    body: [
      `We haven’t yet been able to match a payment to the outstanding ${a.amount} on ${doc} ${a.reference}.`,
      "Could you please arrange payment or reply with an update? If you’ve already paid, the payment date and reference will help us check.",
      `If something on the ${doc} doesn’t look right, please tell us so we can look into it.`,
    ],
  };
}

export type OverdueReminderEmailInput = {
  stage: number;
  publico: Publico;
  /** Como está gravada; o e-mail mostra a normalizada (INV-). */
  invoiceReference: string;
  amount: number;
  /** YYYY-MM-DD */
  dueDate: string | null;
  /** invoice (Schedule B) ou statement (agente): o nome do PDF. */
  documentName: "invoice" | "statement";
  payUrl: string | null;
  bankRows?: Array<[string, string]>;
};

/** Lembrete de atraso inteiro (assunto, HTML e texto) na moldura única. */
export function buildOverdueReminderEmail(d: OverdueReminderEmailInput): { subject: string; preheader: string; html: string; text: string; final: boolean } {
  const ref = referenciaDeCobranca(d.invoiceReference);
  const valor = gbp(d.amount);
  const due = d.dueDate ? dataLonga(d.dueDate.slice(0, 10)) : null;
  const c = reminderCopy(d.stage, { reference: ref, amount: valor, dueLabel: due ?? "", documentName: d.documentName });
  const banco = d.bankRows ?? dadosBancariosVerificados();
  const { html, text } = emailFixfy({
    preheader: c.preheader,
    estado: { texto: c.estado, cor: c.final ? "orange" : "navy" },
    titulo: c.heading,
    destaque: { linha1: `${valor} outstanding`, linha2: due ? `due on ${due}` : null },
    metricas: [
      { rotulo: "Amount due", valor },
      { rotulo: "Was due", valor: due ?? "" },
    ],
    passos: passosAte(PASSOS_FATURA, 2),
    saudacao: saudacao(d.publico),
    paragrafos: c.body,
    linhas: [
      ["Reference", ref],
      ["Outstanding balance", valor],
      ["Due date", due],
    ],
    cta: d.payUrl ? { label: `Pay ${valor}`, url: d.payUrl } : null,
    transferencia: ref && banco.length ? { dadosBancarios: banco, referencia: ref } : null,
  });
  return { subject: c.subject, preheader: c.preheader, html, text, final: c.final };
}
