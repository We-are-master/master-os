/**
 * E-mail de cobrança na criação do job (dono, 13/10/2026; copy aprovada em
 * 20/10/2026, ids 3 sinal e 4 pagamento total).
 *
 * Não é fatura: é o último passo de uma reserva. O cliente acabou de fechar e
 * falta pagar para o horário ficar dele. Moldura única de app (`fixfy-shell`):
 * estado "Payment due", o título, a visita em destaque, as linhas da reserva,
 * UM botão com o valor e, embaixo dele, a transferência bancária com a conta
 * verificada da configuração (`fixfy-client-bank-details`, a mesma do PDF).
 * Os valores saem do total e do que se cobra agora; nada é copiado da copy.
 */
import { FIXFY_CLIENT_BANK_DETAIL_ROWS } from "@/lib/fixfy-client-bank-details";
import { displayBillingReference } from "@/lib/billing-reference";
import { emailFixfy, gbp, saudacao, type Publico } from "@/lib/emails/fixfy-shell";
import { janelaDoAviso, lerLinhaDaAgenda } from "@/lib/zendesk-job-confirmation";
import { janelaCurta, passosAte, PASSOS_PAGAMENTO_RESERVA } from "@/lib/emails/faixas-do-email";

export type BookingPaymentEmailInput = {
  clientName: string;
  jobReference: string;
  invoiceReference: string;
  serviceTitle: string;
  /** Escopo combinado com o cliente, em texto corrido ou em linhas. */
  scope?: string | null;
  /** `Wednesday 21 October 2026`. */
  dayLabel?: string | null;
  /** `between 9am and midday`. */
  windowLabel?: string | null;
  address?: string | null;
  total: number;
  amountDueNow: number;
  /** 1..100. Abaixo de 100 é sinal. */
  percent: number;
  payLink: string | null;
  /**
   * Quem recebe, pela relação da conta. Sem ele: B2C pelo primeiro nome de
   * `clientName`. Conta B2B deve passar `{ tipo: "b2b", empresa }`.
   */
  publico?: Publico;
  /**
   * O job nasceu de uma cotação aceita (copy do dono, 23/10/2026: "Quote accepted").
   * Sem cotação (booking direto) fica o texto de sempre: não se agradece um aceite que não houve.
   */
  daCotacao?: boolean;
  /** Conta para transferência. Sem ele, a conta verificada da configuração; lista vazia some com o bloco. */
  bankDetails?: ReadonlyArray<{ label: string; value: string }>;
};

function firstName(full: string): string {
  const t = full.trim().split(/\s+/)[0] ?? "";
  return t && !/^(mr|mrs|ms|miss|dr)\.?$/i.test(t) ? t : "";
}

/** Linhas do escopo. Corta o que passar de 8 linhas ou 700 caracteres, para o e-mail não virar contrato. */
export function scopeLines(scope: string | null | undefined): string[] {
  const raw = String(scope ?? "").trim();
  if (!raw) return [];
  const lines = raw
    .split(/\r?\n+/)
    .map((l) => l.replace(/^\s*(?:[-*•·]|\d+[.)])\s*/, "").trim())
    .filter(Boolean);
  const out: string[] = [];
  let used = 0;
  for (const l of lines) {
    if (out.length >= 8 || used + l.length > 700) break;
    out.push(l);
    used += l.length;
  }
  return out;
}

const r2 = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Sinal ou total, e os três valores, sempre calculados do que a fatura cobra. */
function valores(i: Pick<BookingPaymentEmailInput, "total" | "amountDueNow" | "percent">) {
  const total = r2(i.total);
  const agora = r2(i.amountDueNow);
  const sinal = i.percent < 100 && agora < total - 0.005;
  return { sinal, total, agora, saldo: Math.max(0, r2(total - agora)) };
}

export function buildBookingPaymentSubject(i: Pick<BookingPaymentEmailInput, "total" | "amountDueNow" | "percent" | "daCotacao">): string {
  const v = valores(i);
  if (v.sinal && i.daCotacao) return "Your quote is accepted: confirm your booking";
  return v.sinal ? `Confirm your booking with a ${gbp(v.agora)} deposit` : `Confirm your Fixfy booking · ${gbp(v.agora)}`;
}

export function buildBookingPaymentEmail(i: BookingPaymentEmailInput): { subject: string; html: string; text: string } {
  const v = valores(i);
  const publico: Publico = i.publico ?? { tipo: "b2c", primeiroNome: firstName(i.clientName) };
  const referencia = displayBillingReference(i.invoiceReference);
  const visita = lerLinhaDaAgenda(i.dayLabel ?? null, null).data;
  const janela = janelaDoAviso(i.windowLabel);
  const quando = visita ? [visita, janela].filter(Boolean).join(" · ") : null;
  const escopo = scopeLines(i.scope).join("; ");
  const banco = (i.bankDetails ?? FIXFY_CLIENT_BANK_DETAIL_ROWS)
    .filter((r) => String(r.value ?? "").trim())
    .map((r) => [r.label, r.value] as [string, string]);

  const comuns = {
    estado: { texto: "Payment due", cor: "red" as const },
    destaque: quando ? { linha1: visita!, linha2: janela } : null,
    metricas: [
      { rotulo: v.sinal ? "Deposit now" : "Pay now", valor: gbp(v.agora), sub: v.sinal ? `of ${gbp(v.total)} total` : null },
      { rotulo: "Visit date", valor: visita ?? "", sub: janelaCurta(janela) },
    ],
    passos: passosAte(PASSOS_PAGAMENTO_RESERVA, 1),
    saudacao: saudacao(publico),
    transferencia: banco.length ? { dadosBancarios: banco, referencia, booking: true } : null,
  };

  const corpo = v.sinal && i.daCotacao
    ? emailFixfy({
        ...comuns,
        estado: { texto: "Quote accepted", cor: "green" },
        preheader: `Pay your ${gbp(v.agora)} deposit to confirm your booking.`,
        titulo: "Let’s get your booking confirmed",
        paragrafos: [
          `Thanks for accepting your quote. Please pay your ${gbp(v.agora)} deposit to confirm your booking.`,
          `Your deposit goes towards the ${gbp(v.total)} total, with the remaining ${gbp(v.saldo)} due once the agreed work is complete.`,
        ],
        resumo: {
          titulo: "Your booking at a glance",
          texto: escopo ? `Work included: ${escopo}` : null,
          linhas: [
            ["Service", i.serviceTitle],
            ["Proposed visit", quando],
            ["Property", i.address?.trim()],
          ],
        },
        cta: { label: `Pay ${gbp(v.agora)} deposit`, url: i.payLink },
        nota: "We’ll send your booking confirmation once we’ve received your deposit. Need to change any details? Reply to this email before paying and we’ll be happy to help.",
        assinatura: "The Fixfy team",
      })
    : v.sinal
    ? emailFixfy({
        ...comuns,
        preheader: `${gbp(v.agora)} now, with ${gbp(v.saldo)} due after the work is complete.`,
        titulo: "One last step to confirm",
        paragrafos: [
          `Your booking details are ready. Please have a look below, then pay your ${gbp(v.agora)} deposit to confirm.`,
          `The remaining ${gbp(v.saldo)} is due once the agreed work is complete.`,
          "Once payment is received, we’ll confirm the next steps. If you’d like to change anything before paying, just reply.",
        ],
        linhas: [
          ["Service", i.serviceTitle],
          ["Work included", escopo],
          ["Proposed visit", quando],
          ["Property", i.address?.trim()],
          ["Total", gbp(v.total)],
          ["Deposit", gbp(v.agora)],
          ["Remaining balance", gbp(v.saldo)],
          ["Booking", i.jobReference],
        ],
        cta: { label: `Pay ${gbp(v.agora)} deposit`, url: i.payLink },
      })
    : emailFixfy({
        ...comuns,
        preheader: `Review your booking details and pay ${gbp(v.agora)} to confirm.`,
        titulo: "Your booking is ready to confirm",
        paragrafos: [
          `Thanks for choosing Fixfy. Your booking details are ready below. Please check everything looks right, then pay ${gbp(v.agora)} to confirm.`,
          "Once payment is received, we’ll confirm the next steps.",
          "Need to make a change or ask a question first? Just reply and we’ll help.",
        ],
        linhas: [
          ["Service", i.serviceTitle],
          ["Work included", escopo],
          ["Proposed visit", quando],
          ["Property", i.address?.trim()],
          ["Amount due", gbp(v.agora)],
          ["Booking", i.jobReference],
        ],
        cta: { label: `Pay ${gbp(v.agora)} and confirm`, url: i.payLink },
      });

  return { subject: buildBookingPaymentSubject(i), ...corpo };
}

export function buildBookingPaymentEmailHTML(i: BookingPaymentEmailInput): string {
  return buildBookingPaymentEmail(i).html;
}
