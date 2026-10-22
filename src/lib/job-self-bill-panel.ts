import type { JobVisit, SelfBill } from "@/types/database";
import { jobShareOfVisitSelfBill } from "@/lib/job-visit-rollup";

/**
 * O painel "Partner self-bill" do card do job (22/10/2026, dono, JOB-9705).
 *
 * Cada parceiro tem um self-bill por quinzena, com todos os jobs dele no
 * período. O card mostra, por parceiro, só o que ESTE job põe no documento; a
 * referência e o total da quinzena ficam como texto secundário
 * ("SB-14535 · this job £140.00 · fortnight total £1,309.66"). Billing mostra o
 * documento inteiro.
 *
 * Documento rejeitado ou cancelado não paga nada: aparece como "no self-bill",
 * sem valor (a Fixfy, time da casa, tinha SB-14546 rejeitado e o card mostrava
 * £340), e não decide o selo do cabeçalho quando outro parceiro tem documento vivo.
 */

/** Documento que não paga mais: rejeitado ou anulado pelo ciclo do job. */
export const DEAD_SELF_BILL_STATUSES = new Set<string>(["rejected", "payout_cancelled", "payout_lost", "payout_archived"]);

export function isDeadSelfBill(sb: Pick<SelfBill, "status">): boolean {
  return DEAD_SELF_BILL_STATUSES.has(String(sb.status));
}

export type SelfBillPanelRow = {
  selfBillId: string;
  reference: string;
  partnerName: string;
  /** "V1", "V2, V3"… quais visitas deste job estão no documento. */
  visitsLabel: string;
  /** O que este job já põe no pagamento (feito/aprovado). */
  thisJob: number;
  /** O que ainda espera o Done de uma visita. */
  pending: number;
  /** Total do documento da quinzena (texto secundário). */
  fortnightTotal: number;
  dead: boolean;
  status: SelfBill["status"];
};

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * As linhas do painel, na ordem: o documento do parceiro da V1 primeiro, depois
 * um por parceiro de visita.
 *
 * `primaryJobLine` é o que a V1 põe no documento do parceiro dela (o card já
 * calcula: valor combinado + material). Visitas do mesmo parceiro da V1 caem no
 * mesmo documento e somam ali.
 */
export function selfBillPanelRows(args: {
  primary: SelfBill | null;
  visitDocs: readonly SelfBill[];
  visits: readonly JobVisit[];
  primaryJobLine: number;
  primaryPartnerName?: string | null;
}): SelfBillPanelRow[] {
  const rows: SelfBillPanelRow[] = [];
  const linha = (sb: SelfBill, base: number, nome: string | null | undefined, comV1: boolean): SelfBillPanelRow => {
    const parte = jobShareOfVisitSelfBill(args.visits, sb.id);
    const dead = isDeadSelfBill(sb);
    const indices = [...(comV1 ? [1] : []), ...parte.visitIndexes];
    return {
      selfBillId: sb.id,
      reference: sb.reference,
      partnerName: sb.partner_name?.trim() || nome?.trim() || "Partner",
      visitsLabel: indices.map((i) => `V${i}`).join(", "),
      thisJob: dead ? 0 : round2(base + parte.gross),
      pending: dead ? 0 : parte.pending,
      fortnightTotal: round2(Number(sb.net_payout ?? 0)),
      dead,
      status: sb.status,
    };
  };
  if (args.primary) rows.push(linha(args.primary, Math.max(0, args.primaryJobLine), args.primaryPartnerName, true));
  for (const sb of args.visitDocs) {
    if (args.primary && sb.id === args.primary.id) continue;
    rows.push(linha(sb, 0, null, false));
  }
  return rows;
}

/**
 * De onde sai o selo do cabeçalho: dos documentos vivos. Só quando todos estão
 * mortos o selo diz cancelado. `null` = nenhum documento.
 */
export function selfBillHeaderSource(rows: readonly Pick<SelfBillPanelRow, "dead" | "status">[]):
  | { kind: "live"; status: SelfBill["status"] }
  | { kind: "all_dead" }
  | null {
  if (rows.length === 0) return null;
  const vivo = rows.find((r) => !r.dead);
  return vivo ? { kind: "live", status: vivo.status } : { kind: "all_dead" };
}
