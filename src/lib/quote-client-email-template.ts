import { addDays, parseISO, isValid, format } from "date-fns";
import type { QuotePDFData, CompanyBranding, QuoteLineItem } from "@/lib/pdf/quote-template";
import type { Publico } from "@/lib/emails/fixfy-shell";
import { emailDaCotacao } from "@/lib/zendesk-quote-sent";

/**
 * A cotação que sai pela Resend, sem ticket (copy 21). Mesmo miolo do comentário
 * do Zendesk (copy 20, zendesk-quote-sent.ts) na moldura de e-mail. O antigo
 * quote-client.html (botões verde e vermelho, "How to accept") não é mais lido.
 */

export type QuoteClientEmailContext = {
  propertyAddress?: string | null;
  postcode?: string | null;
  serviceType?: string | null;
};

export interface QuoteEmailOptions {
  acceptUrl?: string;
  rejectUrl?: string;
  customMessage?: string;
  context?: QuoteClientEmailContext;
  /**
   * Schedule A (modelo de agente): preço do profissional, Fixfy como agente.
   * Ausente/false = Schedule B, e-mail de sempre.
   */
  agentModel?: boolean;
  /**
   * Quem recebe, da relação da conta (nunca do nome ou do domínio). Cotação
   * cobrada da conta: B2B com o nome da empresa. Ausente: B2C pelo primeiro nome.
   */
  publico?: Publico;
  /** O PDF vai anexado. Padrão true (o send-pdf sempre anexa). */
  pdfAttached?: boolean;
}

/** OS quotes: line 0 = labour, line 1+ = materials (inc VAT totals). */
export function splitQuoteLabourMaterials(
  items: QuoteLineItem[] | undefined,
  totalValue: number,
): { labour: number; materials: number } {
  const rows = items?.filter((r) => Number(r.total) > 0) ?? [];
  if (rows.length === 0) {
    return { labour: totalValue, materials: 0 };
  }
  if (rows.length === 1) {
    return { labour: Number(rows[0]!.total) || totalValue, materials: 0 };
  }
  const labour = Number(rows[0]!.total) || 0;
  const materials = rows.slice(1).reduce((s, r) => s + (Number(r.total) || 0), 0);
  const sum = labour + materials;
  if (sum > 0.01 && Math.abs(sum - totalValue) > 0.05) {
    return { labour: totalValue - materials, materials };
  }
  return { labour, materials };
}

/** Validade: a da cotação, senão 14 dias da criação (regra de sempre deste e-mail). YYYY-MM-DD. */
export function validadeDaCotacao(createdAt: string, expiresAt?: string): string | null {
  if (expiresAt?.trim()) {
    const d = parseISO(expiresAt);
    if (isValid(d)) return expiresAt;
  }
  const created = parseISO(createdAt);
  return isValid(created) ? format(addDays(created, 14), "yyyy-MM-dd") : null;
}

function enderecoCompletoDoContexto(context?: QuoteClientEmailContext): string | null {
  const rua = context?.propertyAddress?.trim() ?? "";
  const pc = context?.postcode?.trim() ?? "";
  if (!rua) return pc || null;
  if (!pc || rua.toUpperCase().replace(/\s+/g, "").includes(pc.toUpperCase().replace(/\s+/g, ""))) return rua;
  return `${rua}, ${pc}`;
}

/** A cotação pronta pela Resend: assunto, HTML e texto puro do mesmo conteúdo. */
export function buildQuoteClientEmail(
  data: QuotePDFData,
  options?: QuoteEmailOptions,
  context?: QuoteClientEmailContext,
): { assunto: string; preheader: string; html: string; text: string } {
  const ctx = context ?? options?.context;
  const items =
    data.items?.length
      ? data.items
      : [{ description: data.title || "Services", quantity: 1, unitPrice: data.totalValue, total: data.totalValue }];
  return emailDaCotacao({
    publico: options?.publico ?? { tipo: "b2c", primeiroNome: data.clientName },
    referencia: String(data.reference ?? ""),
    servico: ctx?.serviceType?.trim() || data.serviceType?.trim() || data.title || null,
    endereco: enderecoCompletoDoContexto(ctx) ?? data.propertyAddress ?? null,
    escopo: typeof data.scope === "string" && data.scope.trim() ? data.scope.trim() : null,
    itens: items,
    total: Number(data.totalValue) || 0,
    entrada: data.depositRequired ?? null,
    validoAte: validadeDaCotacao(data.createdAt, data.expiresAt),
    acceptUrl: options?.acceptUrl ?? null,
    rejectUrl: options?.rejectUrl ?? null,
    agentModel: options?.agentModel === true,
    pdfAnexado: options?.pdfAttached !== false,
    mensagem: options?.customMessage ?? null,
  });
}

/**
 * Fixfy client quote email (HTML body), used by send-pdf and email-preview.
 * PDF attachment remains the react-pdf quote; invoice template is separate.
 */
export function buildQuoteClientEmailHTML(
  data: QuotePDFData,
  _branding: CompanyBranding,
  options?: QuoteEmailOptions,
  context?: QuoteClientEmailContext,
): string {
  return buildQuoteClientEmail(data, options, context).html;
}
