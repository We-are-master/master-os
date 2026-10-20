/**
 * O que os e-mails de cobrança ao cliente (fatura, recibo, final, parcela,
 * lembrete de atraso) dividem: quem é o destinatário, o nome do documento, a
 * referência que aparece e a conta para transferência.
 *
 * Regras do handoff (docs/copy/CLAUDE-HANDOFF.md, "Financial and state rules"):
 *  - UMA referência em assunto, corpo, PDF e transferência: `displayBillingReference`
 *    (RCP gravado vira INV na tela, igual ao PDF).
 *  - O nome do documento é o do PDF: Schedule B = "invoice" (INVOICE no PDF),
 *    Schedule A (agente) = "statement" (Statement from {profissional}); pago =
 *    "receipt". Nada de chamar statement de VAT invoice.
 *  - Conta bancária só a verificada da configuração (`FIXFY_CLIENT_BANK_DETAIL_ROWS`,
 *    a mesma do PDF); sem ela, o bloco de transferência some.
 */
import { displayBillingReference } from "@/lib/billing-reference";
import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import { primeiroNome, type Publico } from "./fixfy-shell";

export type DocumentoDeCobranca = "invoice" | "statement" | "receipt";

/** Documento ainda em aberto: invoice (Schedule B) ou statement (agente). Pago: receipt. */
export function nomeDoDocumento(a: { pago: boolean; agente: boolean }): DocumentoDeCobranca {
  if (a.pago) return "receipt";
  return a.agente ? "statement" : "invoice";
}

/** O documento de cobrança em si (para "no remaining balance on this invoice"). */
export function nomeDoDocumentoAberto(agente: boolean): Exclude<DocumentoDeCobranca, "receipt"> {
  return agente ? "statement" : "invoice";
}

/**
 * Cobrança para a conta (billing mode "account") = B2B, saudação com o nome da
 * empresa. Senão B2C, primeiro nome. Nunca deduz pelo nome ou pelo domínio.
 */
export function publicoDaCobranca(
  mode: "account" | "end_client" | null | undefined,
  nome: string | null | undefined,
  /** Nome da empresa (companyName do resolver). Em B2B manda ele; ausente = "Hi team,", nunca a pessoa. */
  empresa?: string | null,
): Publico {
  return mode === "account" ? { tipo: "b2b", empresa: empresa ?? null } : { tipo: "b2c", primeiroNome: primeiroNome(nome) };
}

/** A referência que o cliente vê (INV-2026-999), ou "" sem referência. */
export function referenciaDeCobranca(reference: string | null | undefined): string {
  const r = String(reference ?? "").trim();
  return r ? displayBillingReference(r) : "";
}

/** Linhas da conta verificada (as do PDF). Vazio se a configuração não tiver. */
export function dadosBancariosVerificados(): Array<[string, string]> {
  return FIXFY_CLIENT_BANK_DETAIL_ROWS.map((r) => [r.label, String(r.value ?? "").trim()] as [string, string]).filter(([, v]) => v.length > 0);
}

/** Texto livre (título do job, endereço) sem travessão: o e-mail não leva — nem –. */
export function semTravessao(s: string | null | undefined): string {
  return String(s ?? "")
    .replace(/\s*[–—]\s*/g, ", ")
    .replace(/\s+/g, " ")
    .trim();
}
