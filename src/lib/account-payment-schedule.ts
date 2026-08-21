/**
 * A agenda de pagamento da conta, como estrutura em vez de frase.
 *
 * Até 20/08/2026 isto vivia inteiro em `accounts.payment_terms`, texto livre.
 * A Housekeep guardava o cronograma numa frase:
 *
 *     "Every 2 weeks cutoff Sunday pay Friday ref 2026-04-13"
 *
 * Funcionava porque `invoice-payment-terms.ts` sabe ler essas frases, mas
 * cobrava três preços: conta nova nascia sem cut-off nenhum, ninguém conseguia
 * perguntar ao banco quais contas pagam na sexta, e um erro de digitação virava
 * "Net 30" em silêncio (é o default do parser quando não reconhece).
 *
 * A saída aqui NÃO é trocar o motor. `paymentTermsFromSchedule` **gera** a
 * frase canônica a partir da estrutura, e o parser continua sendo quem calcula
 * vencimento. A estrutura passa a ser a fonte, a frase passa a ser derivada.
 * Motor intocado, conta nascendo completa.
 */

import { dueDateIsoFromPaymentTerms } from "@/lib/invoice-payment-terms";

export type AccountPaymentCadence =
  /** Paga quando recebe a fatura (72h, ver DUE_ON_RECEIPT_HOURS). */
  | "on_receipt"
  /** Paga N dias depois. */
  | "net_days"
  /**
   * "Every N days": vence N dias depois E agrupa as faturas por semana.
   *
   * Parece `net_days` e não é: `isWeeklyConsolidatedTerms` só reconhece esta
   * forma, então trocar por `Net 7` mudaria de uma fatura semanal para uma por
   * job. A Fantastic Services está assim, e o teste de ida e volta pegou a
   * diferença: `Every 7 days` vence em 27/08 e `Every Friday` venceria em 21/08.
   */
  | "every_n_days"
  /** Semanal: corte num dia da semana, paga no dia seguinte combinado. */
  | "weekly"
  /** Quinzenal: corte num dia da semana, paga na sexta seguinte. */
  | "biweekly"
  /** Mensal: corte num dia do mês. */
  | "monthly";

export type AccountPaymentSchedule = {
  cadence: AccountPaymentCadence;
  /** Só em `net_days`. */
  netDays?: number | null;
  /** `weekly` e `biweekly`: dia do corte. 0=domingo … 6=sábado. */
  cutoffDow?: number | null;
  /** `monthly`: dia do mês do corte, 1 a 28. */
  cutoffDom?: number | null;
  /** Dia em que o dinheiro entra. 0=domingo … 6=sábado. */
  payDow?: number | null;
  /**
   * Âncora de `biweekly` própria da conta. Sem ela o parser cai numa heurística
   * que pode errar uma semana inteira, e errar semana em quinzena é errar o
   * pagamento. Desnecessária quando `usesOrgGrid` é true.
   */
  referenceYmd?: string | null;
  /**
   * "Every 2 weeks on Friday": a conta segue a grade quinzenal da organização,
   * cuja âncora vive no Setup (`partner_payout_reference_ymd`), em vez de ter a
   * sua própria. É um preset do dropdown, e sem este caso a trava recusava uma
   * opção legítima da tela.
   */
  usesOrgGrid?: boolean;
};

const DIAS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Padrão sugerido em conta nova: a mesma quinzena que a operação já usa. */
export const DEFAULT_ACCOUNT_SCHEDULE: AccountPaymentSchedule = {
  cadence: "biweekly",
  cutoffDow: 0, // domingo
  payDow: 5, // sexta
};

function nomeDia(dow: number | null | undefined, padrao: number): string {
  const i = typeof dow === "number" && dow >= 0 && dow <= 6 ? dow : padrao;
  return DIAS[i];
}

/**
 * A frase canônica que `invoice-payment-terms.ts` sabe ler.
 *
 * Cada formato aqui é copiado dos regex de lá, não inventado. Mudar um destes
 * sem mudar o parser produz "Net 30" silencioso, que é o default dele para o
 * que não reconhece.
 */
export function paymentTermsFromSchedule(s: AccountPaymentSchedule): string {
  switch (s.cadence) {
    case "on_receipt":
      return "Due on Receipt";

    case "net_days": {
      const n = Math.min(365, Math.max(0, Math.round(Number(s.netDays ?? 30))));
      return `Net ${n}`;
    }

    case "every_n_days": {
      const n = Math.min(365, Math.max(1, Math.round(Number(s.netDays ?? 7))));
      return `Every ${n} days`;
    }

    case "weekly":
      return `Every ${nomeDia(s.payDow, 5)}`;

    case "biweekly": {
      // A grade da organização tem a sua própria frase, e é ela que
      // `isAccountOrgBiweeklyGridTerms` reconhece. Emitir a forma com `cutoff`
      // aqui tiraria a conta da grade sem ninguém pedir.
      if (s.usesOrgGrid) return `Every 2 weeks on ${nomeDia(s.payDow, 5)}`;
      const base = `Every 2 weeks cutoff ${nomeDia(s.cutoffDow, 0)} pay ${nomeDia(s.payDow, 5)}`;
      const ref = s.referenceYmd?.trim();
      return ref ? `${base} ref ${ref}` : base;
    }

    case "monthly": {
      const dia = Math.min(28, Math.max(1, Math.round(Number(s.cutoffDom ?? 26))));
      return `Monthly cutoff ${dia} pay ${nomeDia(s.payDow, 5)}`;
    }
  }
}

/**
 * Lê a frase de volta para estrutura. Serve ao backfill e às contas antigas.
 *
 * Devolve null quando não reconhece, em vez de chutar. O parser de vencimento
 * chuta `Net 30`, e é justamente esse chute silencioso que se quer parar de
 * herdar: aqui, não reconhecer vira pendência visível na tela da conta.
 */
export function scheduleFromPaymentTerms(raw: string | null | undefined): AccountPaymentSchedule | null {
  const t = (raw ?? "").trim();
  if (!t) return null;

  if (/due\s+on\s+receipt/i.test(t)) return { cadence: "on_receipt" };

  const quinzenal = t.match(
    /every\s+2\s+weeks?\s+cutoff\s+(\w+)\s+pay\s+(\w+)(?:\s+ref\s+(\d{4}-\d{2}-\d{2}))?/i,
  );
  if (quinzenal) {
    return {
      cadence: "biweekly",
      cutoffDow: indiceDoDia(quinzenal[1]),
      payDow: indiceDoDia(quinzenal[2]),
      referenceYmd: quinzenal[3] ?? null,
    };
  }

  // "Every 2 weeks on Friday": quinzena que segue a grade do Setup.
  const gradeOrg = t.match(/every\s+2\s*weeks?\s+on\s+(\w+)/i);
  if (gradeOrg && indiceDoDia(gradeOrg[1]) !== null) {
    return { cadence: "biweekly", payDow: indiceDoDia(gradeOrg[1]), usesOrgGrid: true };
  }

  const mensal = t.match(/monthly\s+cutoff\s+(\d+)\s+pay\s+(\w+)/i);
  if (mensal) {
    return {
      cadence: "monthly",
      cutoffDom: Math.min(28, Math.max(1, parseInt(mensal[1], 10))),
      payDow: indiceDoDia(mensal[2]),
    };
  }

  // "Every N days" antes de "Every <dia>": o regex de dia casaria "7" como
  // palavra e a Fantastic viraria semanal com o vencimento errado.
  const aCadaNDias = t.match(/every\s+(\d+)\s+days/i);
  if (aCadaNDias) {
    return { cadence: "every_n_days", netDays: parseInt(aCadaNDias[1], 10) };
  }

  const semanal = t.match(/every\s+(\w+)$/i);
  if (semanal && indiceDoDia(semanal[1]) !== null) {
    return { cadence: "weekly", payDow: indiceDoDia(semanal[1]) };
  }

  // "Net 30", "Net 45", e o "45 days" que existe na Homyze.
  const net = t.match(/net\s+(\d+)/i) ?? t.match(/^(\d+)\s*days$/i);
  if (net) return { cadence: "net_days", netDays: parseInt(net[1], 10) };

  return null;
}

function indiceDoDia(nome: string | null | undefined): number | null {
  const i = DIAS.findIndex((d) => d.toLowerCase() === (nome ?? "").trim().toLowerCase());
  return i === -1 ? null : i;
}

/**
 * O próximo dia em que esta conta paga, contado de `hoje`.
 *
 * Reusa o motor de vencimento em vez de repetir a aritmética: a resposta é a
 * mesma que a fatura receberia se fosse emitida hoje, então a tela da conta e a
 * fatura não podem divergir.
 */
export function nextPayDateForSchedule(s: AccountPaymentSchedule, hoje = new Date()): string {
  return dueDateIsoFromPaymentTerms(hoje, paymentTermsFromSchedule(s));
}

/** Uma linha legível para a tela da conta. */
export function describeSchedule(s: AccountPaymentSchedule): string {
  switch (s.cadence) {
    case "on_receipt":
      return "Pays on receipt (72h)";
    case "net_days":
      return `Pays ${s.netDays ?? 30} days after invoice`;
    case "every_n_days":
      return `Every ${s.netDays ?? 7} days, invoices grouped per week`;
    case "weekly":
      return `Weekly, every ${nomeDia(s.payDow, 5)}`;
    case "biweekly":
      return s.usesOrgGrid
        ? `Every 2 weeks on ${nomeDia(s.payDow, 5)} (org grid)`
        : `Every 2 weeks, cut-off ${nomeDia(s.cutoffDow, 0)}, pays ${nomeDia(s.payDow, 5)}`;
    case "monthly":
      return `Monthly, cut-off day ${s.cutoffDom ?? 26}, pays ${nomeDia(s.payDow, 5)}`;
  }
}

/**
 * O que falta para a agenda estar completa. Vazio = pode salvar.
 *
 * O dono pediu explicitamente que conta sem cut-off não nasça: cut-off é o que
 * decide em qual pagamento o trabalho cai, e sem ele a data de vencimento é
 * chute com cara de número.
 */
export function missingScheduleFields(s: Partial<AccountPaymentSchedule>): string[] {
  const falta: string[] = [];
  if (!s.cadence) return ["payment cadence"];

  if ((s.cadence === "net_days" || s.cadence === "every_n_days") && !(Number(s.netDays) > 0)) {
    falta.push("number of days");
  }
  if (s.cadence === "monthly" && !(Number(s.cutoffDom) >= 1)) falta.push("cut-off day of month");
  // Só a quinzena PRÓPRIA precisa de cut-off declarado. Em `weekly` a semana
  // fecha sozinha, e na grade da organização o corte vem do Setup.
  if (s.cadence === "biweekly" && !s.usesOrgGrid && typeof s.cutoffDow !== "number") {
    falta.push("cut-off weekday");
  }
  if (
    s.cadence !== "on_receipt" &&
    s.cadence !== "net_days" &&
    s.cadence !== "every_n_days" &&
    typeof s.payDow !== "number"
  ) {
    falta.push("payment weekday");
  }
  if (s.cadence === "biweekly" && !s.usesOrgGrid && !s.referenceYmd?.trim()) {
    falta.push("reference date (anchors the 14-day rhythm)");
  }
  return falta;
}

/**
 * As colunas da conta a partir da frase que o `PaymentTermsBuilder` emite.
 *
 * Existe para os dois pontos de escrita da tela de contas (criar e editar)
 * gravarem a MESMA coisa. Coluna nova que só um dos caminhos preenche é como
 * `whatsapp_job_alerts` e `payment_status` viraram campos órfãos neste banco:
 * existem, aparecem no formulário, e ninguém os mantém.
 *
 * `payment_terms` continua sendo gravada, porque é ela que o motor de
 * vencimento lê. A estrutura ao lado é o que passa a ser consultável.
 */
export type AccountScheduleColumns = {
  payment_terms: string;
  payment_cadence: AccountPaymentCadence | null;
  payment_net_days: number | null;
  payment_cutoff_dow: number | null;
  payment_cutoff_dom: number | null;
  payment_pay_dow: number | null;
  payment_reference_ymd: string | null;
};

export function accountScheduleColumns(paymentTerms: string): AccountScheduleColumns {
  const s = scheduleFromPaymentTerms(paymentTerms);
  return {
    payment_terms: paymentTerms,
    payment_cadence: s?.cadence ?? null,
    payment_net_days: s?.netDays ?? null,
    payment_cutoff_dow: s?.cutoffDow ?? null,
    payment_cutoff_dom: s?.cutoffDom ?? null,
    payment_pay_dow: s?.payDow ?? null,
    payment_reference_ymd: s?.referenceYmd ?? null,
  };
}

/**
 * O que impede esta conta de ser salva, ou string vazia quando pode.
 *
 * O dono pediu que conta não nasça sem cut-off. Aqui a frase é traduzida antes
 * de julgar, para a trava valer igual em quem digita "Net 30" e em quem monta a
 * quinzena no builder.
 */
export function blockingScheduleError(paymentTerms: string): string {
  const s = scheduleFromPaymentTerms(paymentTerms);
  if (!s) return "Payment terms not recognised. Pick one of the presets or build a cycle.";
  const falta = missingScheduleFields(s);
  return falta.length ? `Payment schedule is incomplete: ${falta.join(", ")}.` : "";
}
