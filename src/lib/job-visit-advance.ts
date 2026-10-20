/**
 * Depois de um "Done" numa visita, o que acontece com o job (dono, 19/10/2026).
 *
 * Antes, o Done da visita 1 levava o job direto para Final review mesmo com a
 * visita 2 marcada para amanhã. Agora:
 *  - ainda tem visita pela frente → o job fica Scheduled na data da próxima;
 *  - era a última → Final review.
 *
 * Puro, para o servidor e o teste usarem a mesma regra.
 */

export type VisitaParaAvancar = {
  id: string;
  visit_index: number;
  status: string;
  scheduled_date?: string | null;
  scheduled_start_at?: string | null;
  scheduled_end_at?: string | null;
  deleted_at?: string | null;
};

export type ProximoPasso =
  | { kind: "primary_pending" }
  | { kind: "next_visit"; visit: VisitaParaAvancar }
  | { kind: "finish" };

const PENDENTE = new Set(["scheduled", "in_progress"]);

function chave(v: VisitaParaAvancar): string {
  return v.scheduled_start_at ?? (v.scheduled_date ? `${v.scheduled_date}T00:00:00` : "9999");
}

export function proximoPassoDasVisitas(args: {
  /** A visita 1 (o job) já está feita: ou foi ela agora, ou ficou registrada antes. */
  primaryDone: boolean;
  visits: readonly VisitaParaAvancar[];
}): ProximoPasso {
  if (!args.primaryDone) return { kind: "primary_pending" };
  const pendentes = args.visits
    .filter((v) => !v.deleted_at && PENDENTE.has(v.status))
    .sort((a, b) => chave(a).localeCompare(chave(b)) || a.visit_index - b.visit_index);
  return pendentes[0] ? { kind: "next_visit", visit: pendentes[0] } : { kind: "finish" };
}
