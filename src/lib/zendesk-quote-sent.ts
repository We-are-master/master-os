import { moneyIncVatLabel } from "@/lib/money-display-label";
import { dataLonga, emailFixfy, gbp, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { passosAte, PASSOS_COTACAO } from "@/lib/emails/faixas-do-email";

/**
 * O e-mail "a cotação está pronta" (copy 20 e 21, docs/copy/fixfy-client-copy.json).
 *
 * Um só miolo para os dois caminhos: comentário público no ticket do Zendesk
 * (`zendesk: true`, sem tabela interna) e e-mail solto pela Resend
 * (quote-client-email-template.ts). Desenho de app aprovado pelo dono em
 * 20/10/2026: estado "Quote ready", o título é a frase, o total em destaque,
 * as linhas do orçamento, UM botão para aceitar e o recusar como link de texto.
 *
 * A frase de pagamento sai da cotação real: com entrada, entrada e saldo; sem
 * entrada, só os termos acordados quando existem. Nunca inventa entrada.
 */

export interface QuoteLineItem {
  description: string;
  quantity:    number;
  unitPrice:   number;
  total:       number;
}

/** O saldo da cotação com entrada vence no fim do trabalho (termo de sempre). */
export const TERMOS_DO_SALDO = "when the job is done";

/** "General Maintenance" vira "general maintenance"; sigla (EICR) fica como está. */
export function servicoCurto(servico: string | null | undefined): string {
  return String(servico ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .map((p) => (/^[A-Z][a-z'’]+$/.test(p) ? p.toLowerCase() : p))
    .join(" ");
}

/** "12 Albert Road, London NW5 1AB" vira "12 Albert Road". */
export function imovelCurto(endereco: string | null | undefined): string {
  return String(endereco ?? "").split(",")[0]?.replace(/\s+/g, " ").trim() ?? "";
}

/**
 * quote_payment_sentence (handoff): com entrada, "A deposit of £90.00 is required
 * to confirm your booking. The remaining £90.00 is due when the job is done.";
 * entrada igual ao total, pagamento cheio; sem entrada, os termos acordados ou nada.
 */
export function fraseDePagamentoDaCotacao(a: {
  total: number;
  entrada?: number | null;
  termosDoSaldo?: string | null;
  termosAcordados?: string | null;
}): string | null {
  const total = Math.round((Number(a.total) || 0) * 100) / 100;
  const entrada = Math.round((Number(a.entrada) || 0) * 100) / 100;
  if (entrada > 0.02 && entrada < total - 0.02) {
    return `A deposit of ${gbp(entrada)} is required to confirm your booking. The remaining ${gbp(total - entrada)} is due ${a.termosDoSaldo?.trim() || TERMOS_DO_SALDO}.`;
  }
  if (entrada > 0.02) return `Payment of ${gbp(entrada)} is required to confirm your booking.`;
  const termos = a.termosAcordados?.trim();
  return termos ? termos : null;
}

export type DadosDaCotacao = {
  publico:          Publico;
  referencia:       string;
  /** Tipo de trabalho (service_type) ou, sem ele, o título da cotação. */
  servico:          string | null;
  endereco:         string | null;
  escopo:           string | null;
  itens?:           QuoteLineItem[];
  total:            number;
  entrada?:         number | null;
  termosAcordados?: string | null;
  /** ISO ou YYYY-MM-DD; sem data a linha some. */
  validoAte:        string | null;
  acceptUrl?:       string | null;
  rejectUrl?:       string | null;
  /** Schedule A (modelo de agente): sem "inc VAT" e com a linha de agente. */
  agentModel?:      boolean;
  /** Só fala do PDF quando ele foi gerado e vai anexado. */
  pdfAnexado?:      boolean;
  /** Texto que a equipe escreveu no envio: entra no lugar do primeiro parágrafo. */
  mensagem?:        string | null;
  zendesk?:         boolean;
};

const AVISO_DE_AGENTE =
  "This is the price of the independent, vetted professional who will carry out your job. Your contract for the work is with them: GETFIXFY LTD (Fixfy) arranges the booking and receives your payment as their agent. No Fixfy fee and no VAT added on top. If your professional is VAT registered, their VAT is included and shown on your receipt.";

function totalRotulo(total: number, agente: boolean): string {
  return agente ? gbp(total) : moneyIncVatLabel(gbp(total));
}

/** Uma linha só com os itens, quando há mais de um (com um só, o total já diz tudo). */
function itensRotulo(itens: QuoteLineItem[] | undefined): string | null {
  const linhas = (itens ?? []).filter((it) => it && String(it.description ?? "").trim() && Number(it.total) > 0);
  if (linhas.length < 2) return null;
  return linhas
    .map((it) => `${String(it.description).replace(/\s+/g, " ").trim()}${it.quantity > 1 ? ` x ${it.quantity}` : ""} ${gbp(Number(it.total))}`)
    .join(" · ");
}

/** Assunto da copy: "Your handyman quote is ready · QT-2026-1200". */
export function assuntoDaCotacao(servico: string | null | undefined, referencia: string): string {
  const s = servicoCurto(servico);
  const ref = String(referencia ?? "").trim();
  return [`Your ${s ? `${s} ` : ""}quote is ready`, ref].filter(Boolean).join(" · ");
}

export function emailDaCotacao(d: DadosDaCotacao): { assunto: string; preheader: string; html: string; text: string } {
  const agente = d.agentModel === true;
  const servico = servicoCurto(d.servico);
  const total = totalRotulo(d.total, agente);
  const preheader = `${total} for the work outlined below.`;
  const pagamento = fraseDePagamentoDaCotacao({ total: d.total, entrada: d.entrada, termosAcordados: d.termosAcordados });
  const primeiro = d.mensagem?.trim()
    ? d.mensagem.trim()
    : `Thanks for telling us what you need. We’ve put together your quote${servico ? ` for ${servico}` : ""}, with the work included and price set out below.`;
  const temBotao = Boolean(d.acceptUrl);
  const paragrafos = [
    primeiro,
    temBotao
      ? "Have a look through the details. If everything looks right, you can accept the quote using the button."
      : "Have a look through the details. If everything looks right, just reply to accept the quote.",
    pagamento,
    "If you’d like to ask a question or adjust the work included, just reply. We’ll be happy to help.",
  ].filter((p): p is string => Boolean(p));

  const letraPequena = [
    agente ? AVISO_DE_AGENTE : "All prices include VAT.",
    d.pdfAnexado ? "A PDF copy of this quote is attached for your records." : "",
  ].filter(Boolean);

  const { html, text } = emailFixfy({
    preheader,
    estado: { texto: "Quote ready", cor: "orange" },
    titulo: "Your quote is ready",
    destaque: { linha1: servico ? `Quote for ${servico}` : "Quote total", linha2: total },
    metricas: [
      { rotulo: "Total", valor: gbp(d.total), sub: agente ? null : "inc VAT" },
      { rotulo: "Valid until", valor: dataLonga(d.validoAte) ?? "" },
    ],
    passos: passosAte(PASSOS_COTACAO, 1),
    saudacao: saudacao(d.publico),
    paragrafos,
    linhas: [
      ["Reference", d.referencia],
      ["Property", d.endereco],
      ["Work included", d.escopo],
      ["Itemised pricing", itensRotulo(d.itens)],
      ["Total", total],
      ["Valid until", dataLonga(d.validoAte)],
    ],
    cta: d.acceptUrl ? { label: "Review and accept quote", url: d.acceptUrl } : null,
    linksSecundarios: d.rejectUrl ? [{ label: "Decline quote", url: d.rejectUrl }] : [],
    letraPequena,
    zendesk: d.zendesk,
  });
  return { assunto: assuntoDaCotacao(d.servico, d.referencia), preheader, html, text };
}

interface QuoteSentArgs {
  customerName:    string;
  reference:       string;
  title:           string;
  propertyAddress: string | null;
  scope:           string | null;
  totalGbp:        number;
  /** ISO timestamp; when present, drives the "Valid until" row. */
  expiresAt:       string | null;
  items?:          QuoteLineItem[];
  acceptUrl?:      string;
  rejectUrl?:      string;
  agentModel?:     boolean;
  /** Tipo de trabalho do catálogo; sem ele vale o título. */
  serviceType?:    string | null;
  /** Entrada que o aceite cobra (deposit_required). */
  depositRequired?: number | null;
  /** B2B quando a cotação é da conta (cobrança em nome da empresa). Ausente: B2C pelo nome. */
  publico?:        Publico;
  /** O PDF vai anexado ao comentário. Padrão true (os dois caminhos do send-pdf anexam). */
  pdfAttached?:    boolean;
}

/** Comentário público do Zendesk com a cotação (copy 20). */
export function buildQuoteSentHtml(args: QuoteSentArgs): string {
  return montarQuoteSent(args).html;
}

/** O mesmo, com assunto e texto puro (para o e-mail que abre conversa lateral no ticket). */
export function montarQuoteSent(args: QuoteSentArgs): { assunto: string; preheader: string; html: string; text: string } {
  return emailDaCotacao({
    publico: args.publico ?? { tipo: "b2c", primeiroNome: args.customerName },
    referencia: args.reference,
    servico: args.serviceType?.trim() || args.title,
    endereco: args.propertyAddress,
    escopo: args.scope,
    itens: args.items,
    total: args.totalGbp,
    entrada: args.depositRequired ?? null,
    validoAte: args.expiresAt,
    acceptUrl: args.acceptUrl ?? null,
    rejectUrl: args.rejectUrl ?? null,
    agentModel: args.agentModel,
    pdfAnexado: args.pdfAttached !== false,
    zendesk: true,
  });
}
