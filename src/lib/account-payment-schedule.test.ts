import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_ACCOUNT_SCHEDULE,
  describeSchedule,
  blockingScheduleError,
  missingScheduleFields,
  nextPayDateForSchedule,
  paymentTermsFromSchedule,
  scheduleFromPaymentTerms,
  type AccountPaymentSchedule,
} from "./account-payment-schedule";
import { dueDateIsoFromPaymentTerms } from "./invoice-payment-terms";

/**
 * As 11 contas como estão gravadas em produção em 20/08/2026. Este é o teste
 * que importa: se o backfill não souber ler alguma destas, uma conta real perde
 * a agenda de pagamento.
 */
const CONTAS_REAIS: Array<[string, string]> = [
  ["Housekeep", "Every 2 weeks cutoff Sunday pay Friday ref 2026-04-13"],
  ["Homyze", "45 days"],
  ["Kvadrat LTD", "Net 30"],
  ["Fantastic Services", "Every 7 days"],
  ["Checkatrade", "Due on Receipt"],
  ["Fixfy", "Due on Receipt"],
  ["Express", "Due on Receipt"],
  ["The Stylesmiths", "Due on Receipt"],
  ["Good Place Lettings", "Due on Receipt"],
  ["Li & Fung", "Due on Receipt"],
  ["Teste Teste", "Net 30"],
];

describe("scheduleFromPaymentTerms — as contas reais", () => {
  it("lê todas as 11 sem deixar nenhuma sem agenda", () => {
    for (const [nome, terms] of CONTAS_REAIS) {
      const s = scheduleFromPaymentTerms(terms);
      assert.ok(s, `${nome} ficou sem agenda a partir de "${terms}"`);
    }
  });

  it("desmonta a frase inteira da Housekeep", () => {
    const s = scheduleFromPaymentTerms("Every 2 weeks cutoff Sunday pay Friday ref 2026-04-13");
    assert.deepEqual(s, {
      cadence: "biweekly",
      cutoffDow: 0,
      payDow: 5,
      referenceYmd: "2026-04-13",
    });
  });

  it("'Every 7 days' é a sua própria cadência, nem Net 7 nem 'toda sexta'", () => {
    // Vence 7 dias depois E agrupa fatura por semana. Chamar de weekly mudaria
    // o vencimento de 27/08 para 21/08; chamar de Net 7 tiraria o agrupamento.
    const s = scheduleFromPaymentTerms("Every 7 days");
    assert.equal(s?.cadence, "every_n_days");
    assert.equal(s?.netDays, 7);
    assert.equal(paymentTermsFromSchedule(s!), "Every 7 days");
  });

  it("lê '45 days' da Homyze como Net 45", () => {
    const s = scheduleFromPaymentTerms("45 days");
    assert.equal(s?.cadence, "net_days");
    assert.equal(s?.netDays, 45);
  });

  it("devolve null em vez de chutar quando não reconhece", () => {
    // O parser de vencimento chuta Net 30 aqui. Este não chuta, de propósito.
    assert.equal(scheduleFromPaymentTerms("quando der"), null);
    assert.equal(scheduleFromPaymentTerms(""), null);
    assert.equal(scheduleFromPaymentTerms(null), null);
  });
});

describe("paymentTermsFromSchedule — a volta tem que ser fiel", () => {
  it("ida e volta preserva a agenda das contas reais", () => {
    for (const [nome, terms] of CONTAS_REAIS) {
      const s = scheduleFromPaymentTerms(terms);
      assert.ok(s, nome);
      const volta = scheduleFromPaymentTerms(paymentTermsFromSchedule(s!));
      assert.deepEqual(volta, s, `${nome} não sobreviveu à ida e volta`);
    }
  });

  it("a frase gerada produz o MESMO vencimento que a original", () => {
    // É a garantia que permite não mexer no motor: se a frase gerada calcula o
    // mesmo dia, trocar a fonte não muda nenhuma fatura.
    const base = new Date(2026, 7, 20); // 20/08/2026
    for (const [nome, terms] of CONTAS_REAIS) {
      const s = scheduleFromPaymentTerms(terms)!;
      assert.equal(
        dueDateIsoFromPaymentTerms(base, paymentTermsFromSchedule(s)),
        dueDateIsoFromPaymentTerms(base, terms),
        `${nome} mudaria de vencimento`,
      );
    }
  });

  it("gera exatamente os formatos que o parser conhece", () => {
    assert.equal(
      paymentTermsFromSchedule({ cadence: "biweekly", cutoffDow: 0, payDow: 5, referenceYmd: "2026-04-13" }),
      "Every 2 weeks cutoff Sunday pay Friday ref 2026-04-13",
    );
    assert.equal(paymentTermsFromSchedule({ cadence: "monthly", cutoffDom: 26, payDow: 5 }), "Monthly cutoff 26 pay Friday");
    assert.equal(paymentTermsFromSchedule({ cadence: "weekly", payDow: 5 }), "Every Friday");
    assert.equal(paymentTermsFromSchedule({ cadence: "net_days", netDays: 45 }), "Net 45");
    assert.equal(paymentTermsFromSchedule({ cadence: "on_receipt" }), "Due on Receipt");
  });
});

describe("missingScheduleFields — conta não nasce sem cut-off", () => {
  it("cobra o cut-off e a âncora numa quinzena incompleta", () => {
    const falta = missingScheduleFields({ cadence: "biweekly" });
    assert.ok(falta.some((f) => f.includes("cut-off weekday")));
    assert.ok(falta.some((f) => f.includes("reference date")));
  });

  it("aceita a quinzena completa", () => {
    const ok: AccountPaymentSchedule = {
      cadence: "biweekly",
      cutoffDow: 0,
      payDow: 5,
      referenceYmd: "2026-04-13",
    };
    assert.deepEqual(missingScheduleFields(ok), []);
  });

  it("on_receipt não precisa de cut-off nenhum", () => {
    assert.deepEqual(missingScheduleFields({ cadence: "on_receipt" }), []);
  });

  it("net_days cobra o número de dias", () => {
    assert.ok(missingScheduleFields({ cadence: "net_days" }).some((f) => f.includes("days")));
  });

  it("o padrão sugerido ainda pede a âncora, que é decisão de quem cadastra", () => {
    assert.ok(missingScheduleFields(DEFAULT_ACCOUNT_SCHEDULE).some((f) => f.includes("reference")));
  });
});

describe("nextPayDateForSchedule", () => {
  it("concorda com o motor de vencimento", () => {
    const s: AccountPaymentSchedule = {
      cadence: "biweekly",
      cutoffDow: 0,
      payDow: 5,
      referenceYmd: "2026-04-13",
    };
    const hoje = new Date(2026, 7, 20);
    assert.equal(
      nextPayDateForSchedule(s, hoje),
      dueDateIsoFromPaymentTerms(hoje, paymentTermsFromSchedule(s)),
    );
  });
});

describe("describeSchedule", () => {
  it("descreve a Housekeep em uma linha legível", () => {
    assert.equal(
      describeSchedule({ cadence: "biweekly", cutoffDow: 0, payDow: 5, referenceYmd: "2026-04-13" }),
      "Every 2 weeks, cut-off Sunday, pays Friday",
    );
  });
});

/**
 * TODA opção do dropdown de Payment Terms da tela de contas.
 *
 * O primeiro teste que escrevi cobria os 11 valores JÁ GRAVADOS e passou. Só
 * que a trava de salvamento julga o que a pessoa ESCOLHE, e duas opções
 * legítimas do dropdown quebravam: "Every Friday" era recusada por não declarar
 * cut-off (a semana fecha sozinha) e "Every 2 weeks on Friday" nem era lida
 * (é a grade da organização, cuja âncora vive no Setup).
 *
 * Se alguém acrescentar uma opção ao dropdown sem ensinar o parser, quebra aqui.
 */
const OPCOES_DO_DROPDOWN = [
  "Due on Receipt",
  "Net 7",
  "Net 15",
  "Net 30",
  "Net 45",
  "Net 60",
  "Every 7 days",
  "Every 15 days",
  "Every 30 days",
  "Every Friday",
  "Every 2 weeks on Friday",
];

describe("as opções do dropdown salvam sem serem bloqueadas", () => {
  it("nenhuma opção é recusada pela trava", () => {
    for (const o of OPCOES_DO_DROPDOWN) {
      assert.equal(blockingScheduleError(o), "", `"${o}" seria bloqueada ao salvar`);
    }
  });

  it("todas sobrevivem à ida e volta", () => {
    for (const o of OPCOES_DO_DROPDOWN) {
      const s = scheduleFromPaymentTerms(o);
      assert.ok(s, `"${o}" não foi lida`);
      assert.deepEqual(scheduleFromPaymentTerms(paymentTermsFromSchedule(s!)), s, `"${o}" mudou na volta`);
    }
  });

  it("e nenhuma muda de vencimento", () => {
    const base = new Date(2026, 7, 20);
    for (const o of OPCOES_DO_DROPDOWN) {
      const s = scheduleFromPaymentTerms(o)!;
      assert.equal(
        dueDateIsoFromPaymentTerms(base, paymentTermsFromSchedule(s)),
        dueDateIsoFromPaymentTerms(base, o),
        `"${o}" mudaria de vencimento`,
      );
    }
  });

  it("a grade da organização é reconhecida como tal, e não vira quinzena própria", () => {
    const s = scheduleFromPaymentTerms("Every 2 weeks on Friday");
    assert.equal(s?.cadence, "biweekly");
    assert.equal(s?.usesOrgGrid, true);
    // Emitir a forma com `cutoff` tiraria a conta da grade sem ninguém pedir.
    assert.equal(paymentTermsFromSchedule(s!), "Every 2 weeks on Friday");
  });
});
