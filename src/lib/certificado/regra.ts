/**
 * Certificado só com o job pago (dono, 22/10/2026).
 *
 * - Cliente da Fixfy (sem conta ou na conta Fixfy): o certificado (EICR, gas safety...)
 *   só vai para o cliente quando o job está pago. Fechou em Awaiting Payment com saldo:
 *   o e-mail final vai com o report e SEM o certificado, e diz que ele sai com o
 *   pagamento. Quando o pagamento entra, sai um e-mail sozinho confirmando o pagamento
 *   com o certificado e o report anexados (`liberar.ts`).
 * - Qualquer outra conta (B2B, plataformas): o certificado vai junto com o report, como sempre.
 *
 * Puro, sem banco: as funções recebem o que o chamador já leu.
 */
import { certificateAttachmentUrls } from "@/lib/certificate-expiry";
import { isCertificateTypeOfWork } from "@/lib/type-of-work";

export const FIXFY_ACCOUNT_ID_PADRAO = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
export const fixfyAccountId = () => process.env.FIXFY_ACCOUNT_ID?.trim() || FIXFY_ACCOUNT_ID_PADRAO;

/** Chave em `outbound_messages`: o certificado deste job ficou retido esperando o pagamento. */
export const finalidadeRetido = "certificate_withheld";
/** Chave em `outbound_messages`: o e-mail do pagamento com o certificado já saiu. */
export const finalidadeLiberado = "certificate_after_payment";

export type JobParaCertificado = {
  title?: string | null;
  status?: string | null;
  finance_status?: string | null;
  payment_status?: string | null;
  final_report?: unknown;
};

/** Job de certificado: report no modelo de certificado, arquivo no slot do certificado, ou tipo de trabalho. */
export function ehJobDeCertificado(job: JobParaCertificado): boolean {
  const fr = job.final_report as { template?: unknown } | null | undefined;
  if (fr && fr.template === "certificate") return true;
  if (certificateAttachmentUrls(job.final_report).length > 0) return true;
  return isCertificateTypeOfWork(job.title ?? null);
}

/** Cliente da Fixfy: sem conta, ou a conta Fixfy (mesma regra do feedback pós-job). */
export function contaDaFixfy(accountId: string | null | undefined, fixfyId = fixfyAccountId()): boolean {
  return !accountId || accountId === fixfyId;
}

/** Pago de verdade: o job fechou como Completed ou o financeiro marcou pago. */
export function jobPago(job: JobParaCertificado): boolean {
  return job.status === "completed" || job.finance_status === "paid" || job.payment_status === "paid";
}

/**
 * Retém o certificado no e-mail final? Só job de certificado, cliente da Fixfy, ainda não pago.
 * `forcarAnexo` = o e-mail do pagamento (`liberar.ts`), que é justamente o que leva o certificado.
 */
export function reterCertificado(
  job: JobParaCertificado,
  accountId: string | null | undefined,
  opts: { forcarAnexo?: boolean; fixfyId?: string } = {},
): boolean {
  if (opts.forcarAnexo) return false;
  if (!ehJobDeCertificado(job)) return false;
  if (!contaDaFixfy(accountId, opts.fixfyId)) return false;
  return !jobPago(job);
}
