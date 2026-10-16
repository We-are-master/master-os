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

export function reminderCopy(stage: number, a: { name: string; reference: string; amount: string; dueLabel: string; jobLabel: string; payUrl: string | null }) {
  const final = stage >= FINAL_REMINDER_STAGE;
  const subject = final
    ? `Final reminder: invoice ${a.reference} is overdue`
    : stage === 1
      ? `Payment reminder · ${a.reference} · due ${a.dueLabel}`
      : `Payment outstanding · ${a.reference}`;
  const opening = final
    ? `This is a final reminder that invoice ${a.reference} for ${a.amount} (${a.jobLabel}) was due on ${a.dueLabel} and is still unpaid.`
    : stage === 1
      ? `Our records show ${a.amount} outstanding on invoice ${a.reference} (${a.jobLabel}), due on ${a.dueLabel}. If you have already paid, please reply with the payment date and reference so we can check.`
      : `Our records still show ${a.amount} outstanding on invoice ${a.reference} (${a.jobLabel}), due on ${a.dueLabel}. If payment is on its way, please reply with the payment date and reference.`;
  const closing = final
    ? "Please arrange payment today, or reply to this email if there's anything we need to resolve first."
    : "Please pay the outstanding balance using the details below, or reply if you need help with this invoice.";
  return { subject, opening, closing, final };
}
