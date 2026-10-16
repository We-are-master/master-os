/**
 * Histórico e reputação de um lead (dono, 11/10/2026: "todas as infos lá: de onde veio,
 * se já fez job, qual a reputação"). Reputação aqui é como o cliente se comporta com a
 * gente, tirada dos dados: jobs feitos, reclamação e fatura vencida. Não existe nota de
 * estrelas do cliente no OS.
 */
export type Reputacao = "good" | "attention" | "risk" | "new";

export type HistoricoDoLead = {
  jobs: number;
  cancelados: number;
  receita: number;
  ticketMedio: number;
  primeiroJob: string | null;
  ultimoJob: string | null;
  /** Jobs que já passaram por espera com motivo de reclamação. */
  reclamacoes: number;
  /** Reclamação aberta agora (job em espera por reclamação). */
  reclamacaoAberta: boolean;
  faturasVencidas: number;
  valorVencido: number;
  /** Dias da fatura vencida mais antiga. */
  maiorAtrasoDias: number;
  reputacao: Reputacao;
  motivos: string[];
};

export const DIAS_PARA_RISCO = 14;

export function calcularReputacao(h: Pick<HistoricoDoLead, "jobs" | "reclamacoes" | "reclamacaoAberta" | "faturasVencidas" | "maiorAtrasoDias">): { reputacao: Reputacao; motivos: string[] } {
  const motivos: string[] = [];
  if (h.reclamacaoAberta) motivos.push("open complaint");
  if (h.faturasVencidas > 0 && h.maiorAtrasoDias > DIAS_PARA_RISCO) motivos.push(`invoice ${h.maiorAtrasoDias} days overdue`);
  if (motivos.length) return { reputacao: "risk", motivos };
  if (h.faturasVencidas > 0) motivos.push(`${h.faturasVencidas} overdue invoice${h.faturasVencidas === 1 ? "" : "s"}`);
  if (h.reclamacoes > 0) motivos.push(`${h.reclamacoes} past complaint${h.reclamacoes === 1 ? "" : "s"}`);
  if (motivos.length) return { reputacao: "attention", motivos };
  if (h.jobs === 0) return { reputacao: "new", motivos: ["no jobs yet"] };
  return { reputacao: "good", motivos: ["paid on time, no complaints"] };
}

type JobDoHistorico = { reference: string; status: string; client_price: number | null; extras_amount: number | null; scheduled_date: string | null; completed_date: string | null; on_hold_reason_preset_id?: string | null };
type FaturaDoHistorico = { status: string; due_date: string | null; amount: number | null; amount_paid: number | null };

/** Junta jobs e faturas num histórico. Sem banco: testável. */
export function montarHistorico(jobs: JobDoHistorico[], faturas: FaturaDoHistorico[], hojeYmd: string): HistoricoDoLead {
  const vivos = jobs.filter((j) => j.status !== "cancelled" && j.status !== "deleted");
  const receita = vivos.reduce((t, j) => t + Number(j.client_price ?? 0) + Number(j.extras_amount ?? 0), 0);
  const datas = vivos.map((j) => (j.completed_date ?? j.scheduled_date ?? "").slice(0, 10)).filter(Boolean).sort();
  const comReclamacao = jobs.filter((j) => j.on_hold_reason_preset_id === "complaint");
  const vencidas = faturas.filter((f) => {
    const aberto = Number(f.amount ?? 0) - Number(f.amount_paid ?? 0) > 0.02;
    return aberto && !["paid", "cancelled", "void"].includes(f.status) && !!f.due_date && f.due_date.slice(0, 10) < hojeYmd;
  });
  const dias = (ymd: string) => Math.floor((Date.parse(`${hojeYmd}T00:00:00Z`) - Date.parse(`${ymd}T00:00:00Z`)) / 86_400_000);
  const base = {
    jobs: vivos.length,
    cancelados: jobs.length - vivos.length,
    receita: Math.round(receita * 100) / 100,
    ticketMedio: vivos.length ? Math.round((receita / vivos.length) * 100) / 100 : 0,
    primeiroJob: datas[0] ?? null,
    ultimoJob: datas[datas.length - 1] ?? null,
    reclamacoes: comReclamacao.length,
    reclamacaoAberta: comReclamacao.some((j) => j.status === "on_hold"),
    faturasVencidas: vencidas.length,
    valorVencido: Math.round(vencidas.reduce((t, f) => t + Number(f.amount ?? 0) - Number(f.amount_paid ?? 0), 0) * 100) / 100,
    maiorAtrasoDias: vencidas.length ? Math.max(...vencidas.map((f) => dias(f.due_date!.slice(0, 10)))) : 0,
  };
  return { ...base, ...calcularReputacao(base) };
}
