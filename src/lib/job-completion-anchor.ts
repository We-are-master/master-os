/**
 * "O dia em que o job foi concluído" (dono, 09/10/2026): é ele que conta para o
 * vencimento da fatura e para a quinzena do parceiro, mesmo que a equipe aprove o
 * final check 2 ou 3 dias depois.
 *
 * Ordem de prova, da mais fiel à menos:
 *  1. envio do relatório final pelo parceiro (`final_report.submitted_at`)
 *  2. fim do cronômetro do parceiro (`partner_timer_ended_at`)
 *  3. `completed_date` (carimbada quando o job entra em final_check)
 *  4. a agenda (`scheduled_start_at`, senão `scheduled_date` ao meio-dia)
 */
import { resolveJobScheduleInstant, type JobScheduleAnchorInput } from "@/lib/job-invoice-due-anchor";

export type JobCompletionAnchorInput = JobScheduleAnchorInput & {
  completed_date?: string | null;
  partner_timer_ended_at?: string | null;
  final_report?: { submitted_at?: string | null } | null;
};

function validInstant(raw: string | null | undefined): Date | null {
  const v = raw?.trim();
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : d;
}

export function resolveJobCompletionInstant(job: JobCompletionAnchorInput): Date | null {
  const report = validInstant(job.final_report?.submitted_at ?? null);
  if (report) return report;
  const timer = validInstant(job.partner_timer_ended_at);
  if (timer) return timer;
  const done = job.completed_date?.trim().slice(0, 10) ?? "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(done)) return new Date(`${done}T12:00:00`);
  return resolveJobScheduleInstant(job);
}

/** YYYY-MM-DD in London for the completion instant (null when nothing is known). */
export function resolveJobCompletionYmd(job: JobCompletionAnchorInput): string | null {
  const d = resolveJobCompletionInstant(job);
  if (!d) return null;
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
