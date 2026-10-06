/**
 * O recibo do cliente numa reserva da plataforma (Schedule A), como dado puro.
 *
 * As regras vêm do 04-booking-copy, seção (d), e do Invoicing and Payment
 * Collection Agreement 2026-10-06, seção 4.2:
 *
 *   1. O recibo é do PROFISSIONAL. A Fixfy só o emite, como agente dele:
 *      "Issued by GETFIXFY LTD (Fixfy) as agent for {professional}".
 *   2. Nome e endereço comercial do profissional. VAT só se ELE for
 *      registrado (número e VAT incluído); se não, "No VAT charged".
 *   3. Nenhum dado de VAT da Fixfy, nenhuma "platform fee": a comissão é
 *      cobrada do profissional e nunca aparece para o cliente.
 *   4. Linhas de serviço pelo preço cheio do profissional. Promoção da Fixfy
 *      é linha separada, paga pela Fixfy em nome do cliente.
 *   5. O pagamento foi recebido pela Fixfy como agente de cobrança.
 *
 * O PDF (`invoice-template.tsx`) e o e-mail (`invoice-client-email-template.ts`)
 * leem daqui, para os dois nunca dizerem coisas diferentes.
 */
import { vatFromInclusive } from "./commission";

export type AgentReceiptParty = {
  /** Nome comercial do profissional (`partners.company_name`, ou o contato). Nulo = ainda sem profissional. */
  professionalName: string | null;
  /** Endereço comercial do profissional. Nulo = não cadastrado (sai só o nome). */
  businessAddress: string | null;
  /** VAT number do profissional, só quando ele é registrado. */
  vatNumber: string | null;
};

export type AgentReceiptLine = { label: string; amount: number };

export type AgentReceiptView = {
  /** Como o profissional é chamado no texto ("Jane Clean Ltd" ou uma descrição genérica). */
  professionalLabel: string;
  professionalName: string | null;
  businessAddress: string | null;
  vatNumber: string | null;
  /** "Issued by GETFIXFY LTD (Fixfy) as agent for …" */
  issuerLine: string;
  /** Linhas de serviço, pelo preço cheio do profissional. */
  lines: AgentReceiptLine[];
  /** Soma das linhas: o preço do profissional. */
  professionalPrice: number;
  /** "Includes VAT at 20%" | "No VAT charged: … is not VAT registered." | null sem profissional. */
  vatLine: string | null;
  /** VAT incluído no preço, só para profissional registrado. */
  vatAmount: number | null;
  /** Promoção da Fixfy paga em nome do cliente (0 = sem promoção). */
  promotion: number;
  /** Valor deste documento (a invoice do OS). */
  documentAmount: number;
  /** True quando o documento cobre só parte do preço (sinal, saldo). */
  partOfPrice: boolean;
  /** Frase do pagamento recebido pela Fixfy como agente. */
  paymentNote: string;
  /** "Com quem você contratou": o texto de plataforma divulgada dos termos novos. */
  bookingNote: string;
};

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

const GENERIC_PROFESSIONAL = "the independent professional who does your job";

/** Texto de quem contratou, alinhado aos termos de 6 de outubro de 2026. */
export function agentBookingNote(professionalName: string | null): string {
  const name = professionalName?.trim();
  if (!name) {
    return (
      "Your job is carried out by an independent, vetted professional. GETFIXFY LTD (Fixfy) arranges the booking " +
      "as their agent and receives your payment on their behalf, so paying Fixfy counts as paying them. " +
      "Your receipt, in your professional's name, comes once they are confirmed."
    );
  }
  return (
    `Your contract for this job is with ${name}, an independent trader. GETFIXFY LTD (Fixfy) arranged the booking ` +
    `as their agent and receives your payment on their behalf, so paying Fixfy counts as paying them. ` +
    `Your rights under the Consumer Rights Act 2015 are against ${name} as the trader, and we will help you resolve any problem.`
  );
}

export function buildAgentReceiptView(args: {
  party: AgentReceiptParty;
  jobTitle: string | null | undefined;
  clientPrice?: number | null;
  extrasAmount?: number | null;
  /** `invoices.amount`: o que este documento cobra. */
  invoiceAmount: number;
  paid: boolean;
  /**
   * Promoção da Fixfy paga em nome do cliente.
   * TODO(agent-model): o OS ainda não grava o valor da promoção do site
   * (o checkout hoje baixa o preço da linha). Quando o site mandar o valor e
   * o job tiver onde guardar, passar aqui e a linha aparece sozinha.
   */
  promotionAmount?: number | null;
}): AgentReceiptView {
  const name = args.party.professionalName?.trim() || null;
  const label = name ?? GENERIC_PROFESSIONAL;
  const title = String(args.jobTitle ?? "").trim() || "Service";
  const invoiceAmount = round2(args.invoiceAmount);
  const promotion = Math.max(0, round2(args.promotionAmount ?? 0));

  const base = round2(args.clientPrice ?? 0);
  const extras = round2(args.extrasAmount ?? 0);
  let lines: AgentReceiptLine[] = [];
  if (base > 0.02) {
    lines.push({ label: title, amount: base });
    if (extras > 0.02) lines.push({ label: "Extras", amount: extras });
  }
  let professionalPrice = round2(lines.reduce((s, l) => s + l.amount, 0));
  // Sem preço no job, ou documento maior que o job (lote, visitas): o documento é o preço.
  if (lines.length === 0 || invoiceAmount > professionalPrice - promotion + 0.02) {
    lines = [{ label: title, amount: round2(invoiceAmount + promotion) }];
    professionalPrice = round2(invoiceAmount + promotion);
  }

  const vatNumber = name ? args.party.vatNumber?.trim() || null : null;
  let vatLine: string | null = null;
  let vatAmount: number | null = null;
  if (name) {
    if (vatNumber) {
      vatAmount = vatFromInclusive(professionalPrice).vat;
      vatLine = "Includes VAT at 20%";
    } else {
      vatLine = `No VAT charged: ${name} is not VAT registered.`;
    }
  }

  const partOfPrice = Math.abs(invoiceAmount - round2(professionalPrice - promotion)) > 0.02;
  const settles = partOfPrice ? "the amount paid" : "the services above";
  const paymentNote = args.paid
    ? `Payment received by GETFIXFY LTD (Fixfy) as limited payment collection agent for ${label}. ` +
      `Your payment settles what you owe ${name ?? "them"} for ${settles}. No Fixfy fee is charged to you.`
    : `Payment is collected by GETFIXFY LTD (Fixfy) as limited payment collection agent for ${label}. ` +
      `Paying Fixfy counts as paying ${name ?? "them"}. No Fixfy fee is charged to you.`;

  return {
    professionalLabel: label,
    professionalName: name,
    businessAddress: name ? args.party.businessAddress?.trim() || null : null,
    vatNumber,
    issuerLine: `Issued by GETFIXFY LTD (Fixfy) as agent for ${label}`,
    lines,
    professionalPrice,
    vatLine,
    vatAmount,
    promotion,
    documentAmount: invoiceAmount,
    partOfPrice,
    paymentNote,
    bookingNote: agentBookingNote(name),
  };
}
