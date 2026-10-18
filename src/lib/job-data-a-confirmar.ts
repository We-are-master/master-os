/**
 * Job sem data, esperando o cliente dizer o dia (dono, 18/10/2026): "o cliente fala que
 * não quer mais começar amanhã e já avisa a data que vai ser". Continua na aba Action
 * required, mas com o chip "Date TBC" no lugar de "Unassigned", para não parecer um job
 * com data marcada sem parceiro.
 */
export function jobDataAConfirmar(job: {
  status?: string | null;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
}): boolean {
  return job.status === "unassigned" && !job.scheduled_date && !job.scheduled_start_at;
}

export const DATE_TBC_BADGE = { label: "Date TBC", variant: "warning" as const, dot: true };
