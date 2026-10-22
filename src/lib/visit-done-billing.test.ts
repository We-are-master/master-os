/**
 * Done de visita extra (dono, 22/10/2026): hourly pela chegada e saída, fixed pelo
 * combinado, material com recibo, totais sempre à vista, e o self-bill só depois
 * do Confirm.
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeVisitDoneAmounts, jobTotalsAfterVisit, visitBilledHours, visitDoneProblems } from "@/lib/visit-done-billing";
import { visitCountsForPartnerPayout } from "@/lib/job-visit-rollup";

const dia = (hm: string) => `2026-10-23T${hm}:00.000Z`;

describe("hourly: chegada e saída → horas → valores", () => {
  it("1ª hora mínima: 50 minutos cobram 1 hora", () => {
    assert.equal(visitBilledHours(dia("07:00"), dia("07:50")), 1);
  });

  it("depois de meia em meia hora: 1h40 vira 2h, 1h20 vira 1,5h", () => {
    assert.equal(visitBilledHours(dia("07:00"), dia("08:40")), 2);
    assert.equal(visitBilledHours(dia("07:00"), dia("08:20")), 1.5);
  });

  it("saída antes da chegada não tem hora", () => {
    assert.equal(visitBilledHours(dia("09:00"), dia("08:00")), null);
    assert.deepEqual(
      visitDoneProblems({ rateType: "hourly", arrivedAt: dia("09:00"), departedAt: dia("08:00") }),
      ["Departure must be after arrival"],
    );
  });

  it("General Maintenance £72/h e parceiro £35/h por 2h: cliente £144, parceiro £70", () => {
    const v = computeVisitDoneAmounts({
      rateType: "hourly", arrivedAt: dia("07:00"), departedAt: dia("08:40"), hourlyClientRate: 72, hourlyPartnerRate: 35,
    });
    assert.equal(v.billedHours, 2);
    assert.equal(v.clientPrice, 144);
    assert.equal(v.partnerCost, 70);
    assert.equal(v.clientToCharge, 144);
    assert.equal(v.partnerToPay, 70);
  });

  it("os dois valores são editáveis por cima do calculado", () => {
    const v = computeVisitDoneAmounts({
      rateType: "hourly", arrivedAt: dia("07:00"), departedAt: dia("08:40"), hourlyClientRate: 72, hourlyPartnerRate: 35,
      clientOverride: 120, partnerOverride: 0,
    });
    assert.equal(v.clientPrice, 120);
    assert.equal(v.partnerCost, 0);
  });

  it("sem horário não fecha", () => {
    assert.deepEqual(visitDoneProblems({ rateType: "hourly" }), ["Enter the arrival and departure times"]);
  });
});

describe("fixed: o combinado, editável, com extra opcional", () => {
  it("JOB-9705 V3: cliente £0, parceiro £35, e o total aparece mesmo em £0", () => {
    const v = computeVisitDoneAmounts({ rateType: "fixed", clientPrice: 0, partnerCost: 35 });
    assert.equal(v.clientToCharge, 0);
    assert.equal(v.partnerToPay, 35);
    assert.deepEqual(visitDoneProblems({ rateType: "fixed", clientPrice: 0, partnerCost: 35 }), []);
  });

  it("extra do cliente soma no preço da visita", () => {
    const v = computeVisitDoneAmounts({ rateType: "fixed", clientPrice: 100, partnerCost: 60, extraClientCharge: 25 });
    assert.equal(v.clientPrice, 125);
    assert.equal(v.partnerCost, 60);
  });

  it("valor negativo não passa", () => {
    assert.deepEqual(visitDoneProblems({ rateType: "fixed", clientPrice: -5, partnerCost: 35 }), ["Client charge cannot be negative"]);
  });
});

describe("material na visita", () => {
  it("custo do parceiro, cobrança com markup de 30% quando não informada, e recibo obrigatório", () => {
    const v = computeVisitDoneAmounts({ rateType: "fixed", clientPrice: 0, partnerCost: 35, materialsCost: 20 });
    assert.equal(v.materialsCharge, 26);
    assert.equal(v.clientToCharge, 26);
    assert.equal(v.partnerToPay, 55);
    assert.deepEqual(
      visitDoneProblems({ rateType: "fixed", clientPrice: 0, partnerCost: 35, materialsCost: 20, receiptCount: 0 }),
      ["Add a photo of the materials receipt"],
    );
    assert.deepEqual(visitDoneProblems({ rateType: "fixed", partnerCost: 35, materialsCost: 20, receiptCount: 1 }), []);
  });
});

describe("totais do job depois da visita", () => {
  it("JOB-9705: V3 fixed £0 / £35 não muda o job (já contava £35); virar £0 / £50 sobe o parceiro em £15", () => {
    const igual = jobTotalsAfterVisit({
      jobClient: 960, jobPartner: 655, visitClientBefore: 0, visitPartnerBefore: 35,
      amounts: computeVisitDoneAmounts({ rateType: "fixed", clientPrice: 0, partnerCost: 35 }),
    });
    assert.deepEqual(igual, { client: 960, partner: 655, margin: 305 });
    const maisCaro = jobTotalsAfterVisit({
      jobClient: 960, jobPartner: 655, visitClientBefore: 0, visitPartnerBefore: 35,
      amounts: computeVisitDoneAmounts({ rateType: "fixed", clientPrice: 0, partnerCost: 50 }),
    });
    assert.deepEqual(maisCaro, { client: 960, partner: 670, margin: 290 });
  });

  it("material cobrado do cliente entra no total do cliente", () => {
    const t = jobTotalsAfterVisit({
      jobClient: 960, jobPartner: 655, visitClientBefore: 0, visitPartnerBefore: 35,
      amounts: computeVisitDoneAmounts({ rateType: "fixed", partnerCost: 35, materialsCost: 20 }),
    });
    assert.equal(t.client, 986);
  });
});

describe("self-bill só depois do Confirm", () => {
  it("a visita aberta não paga; o Confirm grava status completed e aí paga", () => {
    const aberta = { status: "scheduled" as const, deleted_at: null };
    assert.equal(visitCountsForPartnerPayout(aberta), false);
    // O endpoint /visits/complete grava status completed + completed_at junto com os valores finais.
    assert.equal(visitCountsForPartnerPayout({ ...aberta, status: "completed" }), true);
  });
});
