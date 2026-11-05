/**
 * O relatório não entrou na plataforma do cliente e precisa de alguém
 * (dono, 05/11/2026). O status do job NÃO volta para Final checks (fatura e
 * e-mail final já saíram): a etiqueta "Report failed" no kanban e na lista é
 * o aviso, e some sozinha quando o envio entra ou é marcado como feito à mão.
 */
export type JobComEnvioExterno = {
  external_report_error?: string | null;
  external_report_submitted_at?: string | null;
  external_report_manual_at?: string | null;
};

export function relatorioFalhou(job: JobComEnvioExterno | null | undefined): boolean {
  if (!job) return false;
  return Boolean(job.external_report_error) && !job.external_report_submitted_at && !job.external_report_manual_at;
}
