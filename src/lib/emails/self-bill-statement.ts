/**
 * O email de self-bill que o parceiro recebe.
 *
 * Morava dentro de `src/app/api/self-bills/send-email/route.ts`, e por isso a
 * única forma de VER o email era mandá-lo para um parceiro de verdade: a rota
 * arrasta `server-only` por dependência e não pode ser importada fora do Next.
 *
 * Aqui ele pode ser renderizado num script, conferido antes de sair, e testado.
 * Desde 20/10/2026 usa a moldura única (`emailFixfy`, "Painel de status"):
 * o texto é o mesmo, o desenho mudou. O detalhamento job a job continua indo
 * no PDF anexado.
 */
import { formatCurrency } from "@/lib/utils";
import type { SelfBill } from "@/types/database";
import { emailFixfy, dataLonga, type Estado } from "./fixfy-shell";
import { PASSO_PAGO, passosDoJob, saudacaoDoParceiro } from "./partner-shell";

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
};

/** O estado do pagamento: enviado, agendado ou pendente. */
function estadoDoPagamento(sb: SelfBill, dueYmd: string | null): { estado: Estado; sub: string | null } {
  const paidAt = sb.paid_at?.trim() ? fmtSbDate(sb.paid_at) : null;
  if (paidAt) return { estado: { texto: "Payout sent", cor: "green" }, sub: `Transferred on ${paidAt}` };
  if (dueYmd) return { estado: { texto: "Payout scheduled", cor: "navy" }, sub: `Payment due ${fmtSbDate(dueYmd)}` };
  return { estado: { texto: "Payout pending", cor: "navy" }, sub: null };
}

function periodoDo(sb: SelfBill): string {
  const a = sb.week_start ? fmtSbDate(sb.week_start) : null;
  const b = sb.week_end ? fmtSbDate(sb.week_end) : null;
  return a && b ? `${a} to ${b}` : String(sb.week_label ?? sb.period ?? "").replace(/\s*[—–]\s*/g, " to ");
}

/**
 * O e-mail de self-bill (ou de Payout Statement, no modelo de agente), em HTML
 * e texto. O PDF segue anexado por quem envia.
 */
export function buildSelfBillEmail(sb: SelfBill, dueYmd: string | null, args?: ArgsDoSelfBill): { html: string; text: string } {
  const ps = args?.payoutStatement ?? null;
  const nome = args?.partnerName?.trim() || sb.partner_name?.trim() || "there";
  const payout = formatCurrency(Number(sb.net_payout ?? 0));
  const periodo = periodoDo(sb);
  const { estado, sub } = estadoDoPagamento(sb, dueYmd);

  if (ps) {
    // Payout Statement: reservas da plataforma pagas como agente, a fatura de
    // VAT da comissão junto, e o self-bill só para o trabalho B2B.
    const invoiceRef = ps.commissionInvoiceRef?.trim() || null;
    const attached = invoiceRef
      ? `Your payout statement is attached, with Fixfy's VAT invoice for its commission (${invoiceRef}).`
      : "Your payout statement is attached.";
    const partB = ps.hasClientWork ? " Part B, for Fixfy Client Work, is your self-billing invoice." : "";
    return emailFixfy({
      preheader: `Payout statement: ${payout} for this period. PDFs attached.`,
      estado,
      titulo: "Payout statement",
      passos: passosDoJob(PASSO_PAGO),
      metricas: [
        { rotulo: "Payout amount", valor: payout, sub },
        { rotulo: "Period", valor: periodo },
      ],
      saudacao: saudacaoDoParceiro(nome),
      paragrafos: [
        `${attached} Review the jobs, your prices, Fixfy's commission percentage and your net payout for Platform Bookings.${partB} Please contact us if any details need correcting.`,
      ],
      linhas: [
        ["Statement reference", sb.reference || null],
        ["Period", periodo],
        ["Commission VAT invoice", invoiceRef],
      ],
      letraPequena: ["Questions about your payout? Reply to this email.", "Getfixfy Ltd · VAT No. 478 1027 82"],
    });
  }

  return emailFixfy({
    preheader: `Self-bill issued: ${payout} for jobs completed this period. PDF attached.`,
    estado,
    titulo: "Self-bill issued",
    passos: passosDoJob(PASSO_PAGO),
    metricas: [
      { rotulo: "Payout amount", valor: payout, sub },
      { rotulo: "Period", valor: periodo },
    ],
    saudacao: saudacaoDoParceiro(nome),
    paragrafos: ["Your self-bill is attached. Review the period and payment details below, and keep the PDF for your records."],
    linhas: [
      ["Self-bill reference", sb.reference || null],
      ["Period", periodo],
    ],
    letraPequena: ["Questions about your payout? Reply to this email."],
  });
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
 * O registro curto na conversa lateral do parceiro, no ticket mestre da rodada
 * de pagamento. Conversa lateral não leva anexo: o PDF vai pela Resend.
 */
export function buildSelfBillSideConvHtml(sb: SelfBill, dueYmd: string | null, partnerEmail: string, partnerName?: string | null): string {
  const payout = formatCurrency(Number(sb.net_payout ?? 0));
  const { estado } = estadoDoPagamento(sb, dueYmd);
  return emailFixfy({
    zendesk: true,
    preheader: `Self-bill ${sb.reference} sent to ${partnerEmail}.`,
    estado,
    titulo: `Self-bill ${sb.reference} sent`,
    metricas: [
      { rotulo: "Amount", valor: payout },
      { rotulo: "Payment due", valor: dueYmd ? fmtSbDate(dueYmd) ?? dueYmd : "" },
    ],
    saudacao: saudacaoDoParceiro(partnerName ?? sb.partner_name),
    paragrafos: [`Self-bill ${sb.reference} sent to ${partnerEmail}.`],
    linhas: [
      ["Week", periodoDo(sb) || null],
      ["Sent to", partnerEmail],
    ],
    letraPequena: ["PDF was emailed via Resend (Zendesk side conversations don't carry attachments)."],
  }).html;
}
