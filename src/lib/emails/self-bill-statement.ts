/**
 * O email de self-bill que o parceiro recebe.
 *
 * Morava dentro de `src/app/api/self-bills/send-email/route.ts`, e por isso a
 * única forma de VER o email era mandá-lo para um parceiro de verdade: a rota
 * arrasta `server-only` por dependência e não pode ser importada fora do Next.
 *
 * Aqui ele pode ser renderizado num script, conferido antes de sair, e testado.
 * Desde 23/10/2026 segue o padrão do parceiro (`emailParceiro`): chip
 * "Payment" ou "Paid", valor e data do pagamento, a barra com "Paid" por vir
 * (atual só quando pago), e o assunto sai daqui (`selfBillEmailSubject`). O
 * detalhamento job a job continua no PDF anexado.
 */
import { formatCurrency } from "@/lib/utils";
import type { SelfBill } from "@/types/database";
import { dataLonga, type Estado } from "./fixfy-shell";
import { ajudaDoParceiro, emailParceiro, passosDoPagamento, saudacaoDoParceiro } from "./partner-shell";

/** `2026-10-11` (ou ISO) vira `Sun 11 Oct 26`. */
function fmtSbDate(ymd?: string | null): string | null {
  const raw = ymd?.trim();
  if (!raw) return null;
  return dataLonga(raw) ?? raw.slice(0, 10);
}

type ArgsDoSelfBill = {
  partnerName?: string | null;
  companyName?: string | null;
  /**
   * Modelo de agente: o documento tem reservas da plataforma (Schedule A) e
   * vira Payout Statement, com a fatura de VAT da comissão anexada.
   * Ausente = e-mail de self-bill de sempre.
   */
  payoutStatement?: { commissionInvoiceRef?: string | null; hasClientWork?: boolean } | null;
  /** Onde o parceiro vê os self-bills (portal). Sem ele, sem botão: o PDF vai anexado. */
  viewUrl?: string | null;
};

type SituacaoDoPagamento = "pago" | "agendado" | "pendente";

function situacaoDo(sb: SelfBill, dueYmd: string | null): SituacaoDoPagamento {
  if (sb.paid_at?.trim()) return "pago";
  return dueYmd ? "agendado" : "pendente";
}

/** O chip, com as palavras da faixa antiga: Payout scheduled / pending / sent. */
function estadoDoPagamento(sb: SelfBill, dueYmd: string | null): Estado {
  const sit = situacaoDo(sb, dueYmd);
  if (sit === "pago") return { texto: "Payout sent", cor: "green", chip: true };
  return { texto: sit === "agendado" ? "Payout scheduled" : "Payout pending", cor: "navy", chip: true };
}

function periodoDo(sb: SelfBill): string {
  const a = sb.week_start ? fmtSbDate(sb.week_start) : null;
  const b = sb.week_end ? fmtSbDate(sb.week_end) : null;
  return a && b ? `${a} to ${b}` : String(sb.week_label ?? sb.period ?? "").replace(/\s*[—–]\s*/g, " to ");
}

/**
 * Assunto: `Self-bill SB-2026-0412 · Payment scheduled` / `· Paid` / `· Issued`
 * (sem data de pagamento ainda). Modelo de agente: `Payout statement SB-… · …`.
 */
export function selfBillEmailSubject(sb: SelfBill, dueYmd: string | null, args?: Pick<ArgsDoSelfBill, "payoutStatement">): string {
  // Assunto antigo (dono, 23/10/2026): o documento, a referência e o período.
  const doc = args?.payoutStatement ? "Payout statement" : "Self-bill";
  const periodo = periodoDo(sb);
  return [`${doc} ${String(sb.reference ?? "").trim()}`.trim(), periodo || null].filter(Boolean).join(" · ");
}

/**
 * Por que este self-bill NÃO gera e-mail ao parceiro (null = manda).
 *
 * Dono, 23/10/2026: nada de e-mail quando o self-bill é marcado como pago, e o
 * e-mail de Payout Statement (modelo de agente) saiu também (a fatura de VAT da
 * comissão continua sendo emitida pela rota). Só o "Self-bill issued" continua.
 */
export function motivoSemEmailDoSelfBill(sb: Pick<SelfBill, "paid_at">, opts?: { payoutStatement?: boolean }): string | null {
  if (sb.paid_at?.trim()) return "Already paid: no partner email is sent for paid self-bills";
  if (opts?.payoutStatement) return "Payout statement: partner email switched off";
  return null;
}

function montar(sb: SelfBill, dueYmd: string | null, args: ArgsDoSelfBill | undefined, zendesk: boolean): { html: string; text: string } {
  const ps = args?.payoutStatement ?? null;
  const nome = args?.partnerName?.trim() || sb.partner_name?.trim() || null;
  const payout = formatCurrency(Number(sb.net_payout ?? 0));
  const periodo = periodoDo(sb);
  const sit = situacaoDo(sb, dueYmd);
  const doc = ps ? "Payout statement" : "Self-bill";
  const quando =
    sit === "pago"
      ? { rotulo: "Paid on", valor: fmtSbDate(sb.paid_at) ?? "" }
      : { rotulo: "Payment due", valor: dueYmd ? fmtSbDate(dueYmd) ?? dueYmd : "TBC" };
  const invoiceRef = ps?.commissionInvoiceRef?.trim() || null;
  const viewUrl = args?.viewUrl?.trim() || null;

  // O conteúdo do e-mail antigo (dono, 23/10/2026), na moldura nova e mínima.
  return emailParceiro({
    zendesk,
    preheader: `${doc} issued: ${payout}${sit === "agendado" && dueYmd ? `, payment due ${fmtSbDate(dueYmd)}` : ""}. PDF attached.`,
    estado: estadoDoPagamento(sb, dueYmd),
    titulo: `${doc} issued`,
    saudacao: saudacaoDoParceiro(nome),
    paragrafos: [
      ps
        ? "Your payout statement is attached. Review the period and payment details below, and keep the PDF for your records."
        : "Your self-bill is attached. Review the period and payment details below, and keep the PDF for your records.",
    ],
    passos: passosDoPagamento(sit === "pago"),
    metricas: [{ rotulo: "Payout", valor: payout }, quando],
    linhas: [
      [ps ? "Statement reference" : "Self-bill reference", sb.reference || null],
      ["Period", periodo || null],
      ["Commission VAT invoice", invoiceRef],
    ],
    avisos: [ajudaDoParceiro(undefined, "Questions about your payout?")],
    cta: viewUrl ? { label: "View self-bill", url: viewUrl } : null,
  });
}

/**
 * O e-mail de self-bill (ou de Payout Statement, no modelo de agente), em HTML
 * e texto. O PDF segue anexado por quem envia.
 */
export function buildSelfBillEmail(sb: SelfBill, dueYmd: string | null, args?: ArgsDoSelfBill): { html: string; text: string } {
  return montar(sb, dueYmd, args, false);
}

/**
 * Exportado para poder ser RENDERIZADO sem disparar envio.
 *
 * Devolve só o HTML, como sempre; o texto sai de `buildSelfBillEmail`.
 */
export function buildSelfBillEmailHtml(sb: SelfBill, dueYmd: string | null, args?: ArgsDoSelfBill): string {
  return buildSelfBillEmail(sb, dueYmd, args).html;
}

/**
 * A conversa lateral do parceiro no ticket mestre da rodada de pagamento: o
 * mesmo e-mail, na variante do Zendesk (sem anexo: o PDF vai pela Resend).
 */
export function buildSelfBillSideConvHtml(sb: SelfBill, dueYmd: string | null, _partnerEmail: string, partnerName?: string | null, args?: ArgsDoSelfBill): string {
  return montar(sb, dueYmd, { ...args, partnerName }, true).html;
}
