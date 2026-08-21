import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ORG_PARTNER_PAYOUT_STANDARD_TERMS,
  computePartnerSelfBillDueIso,
  workPeriodBoundsForPayoutFriday,
  workPeriodForJobStartYmd,
} from "./partner-payout-schedule";
import { getWeekBoundsForDate } from "./self-bill-period";
import { jobSelfBillPeriodAnchorYmd, resolveJobSelfBillWeekAnchor } from "@/services/self-bills";

describe("workPeriodBoundsForPayoutFriday", () => {
  it("maps pay 12 Jun 2026 to work 25 May – 7 Jun", () => {
    const period = workPeriodBoundsForPayoutFriday("2026-06-12");
    assert.equal(period.periodStartYmd, "2026-05-25");
    assert.equal(period.periodEndYmd, "2026-06-07");
    assert.equal(period.payoutDueYmd, "2026-06-12");
  });

  it("maps pay 26 Jun 2026 to work 8 Jun – 21 Jun", () => {
    const period = workPeriodBoundsForPayoutFriday("2026-06-26");
    assert.equal(period.periodStartYmd, "2026-06-08");
    assert.equal(period.periodEndYmd, "2026-06-21");
  });
});

describe("workPeriodForJobStartYmd", () => {
  const terms = ORG_PARTNER_PAYOUT_STANDARD_TERMS;
  const ref = "2026-06-12";

  it("places job start 28 May in pay-12-Jun period", () => {
    const period = workPeriodForJobStartYmd("2026-05-28", terms, ref);
    assert.ok(period);
    assert.equal(period!.payoutDueYmd, "2026-06-12");
    assert.equal(period!.periodStartYmd, "2026-05-25");
    assert.equal(period!.periodEndYmd, "2026-06-07");
  });

  it("places job start 10 Jun in pay-26-Jun period", () => {
    const period = workPeriodForJobStartYmd("2026-06-10", terms, ref);
    assert.ok(period);
    assert.equal(period!.payoutDueYmd, "2026-06-26");
    assert.equal(period!.periodStartYmd, "2026-06-08");
    assert.equal(period!.periodEndYmd, "2026-06-21");
  });
});

describe("biweekly due from ISO week ends", () => {
  const terms = ORG_PARTNER_PAYOUT_STANDARD_TERMS;
  const ref = "2026-06-12";

  it("maps both weeks in the same pay period to 12 Jun", () => {
    const dueW23 = computePartnerSelfBillDueIso("2026-05-31", null, terms, ref);
    const dueW24 = computePartnerSelfBillDueIso("2026-06-07", null, terms, ref);
    assert.equal(dueW23, "2026-06-12");
    assert.equal(dueW24, "2026-06-12");
  });
});

describe("jobSelfBillPeriodAnchorYmd", () => {
  it("uses scheduled_start_at for ISO week bucket", () => {
    assert.equal(
      jobSelfBillPeriodAnchorYmd({ scheduled_start_at: "2026-06-01T09:00:00Z", scheduled_date: "2026-05-27" }),
      "2026-06-01",
    );
    const anchor = resolveJobSelfBillWeekAnchor({
      scheduled_start_at: "2026-06-01T09:00:00Z",
      scheduled_date: "2026-05-27",
    });
    assert.ok(anchor);
    const { weekStart, weekEnd, weekLabel } = getWeekBoundsForDate(anchor!);
    assert.equal(weekStart, "2026-06-01");
    assert.equal(weekEnd, "2026-06-07");
    assert.equal(weekLabel, "2026-W23");
  });
});

/**
 * O período de pagamento como o dono o descreve, em 20/08/2026:
 *
 *   "o partner vai receber amanhã dia 21 de agosto, mas o cut off foi domingo
 *    dia 16. Tudo que ele fez entre 3 ao 16."
 *
 * Estes casos existem porque o self-bill nascia por SEMANA ISO enquanto o
 * pagamento é quinzenal, e por isso um mesmo parceiro terminava com quatro
 * documentos vencendo no mesmo dia. Se alguém trocar a âncora ou a cadência da
 * organização sem querer, é aqui que quebra primeiro.
 */
describe("workPeriodForJobStartYmd — a quinzena do dono", () => {
  const TERMS = "Every 2 weeks on Friday";
  const REF = "2026-06-12";

  it("junta 03 a 16 de agosto no mesmo pagamento de sexta 21", () => {
    for (const dia of ["2026-08-03", "2026-08-05", "2026-08-10", "2026-08-16"]) {
      const p = workPeriodForJobStartYmd(dia, TERMS, REF);
      assert.ok(p, `sem período para ${dia}`);
      assert.equal(p!.periodStartYmd, "2026-08-03", `início errado para ${dia}`);
      assert.equal(p!.periodEndYmd, "2026-08-16", `cut-off errado para ${dia}`);
      assert.equal(p!.payoutDueYmd, "2026-08-21", `pagamento errado para ${dia}`);
    }
  });

  it("o dia seguinte ao cut-off já é a quinzena seguinte", () => {
    const p = workPeriodForJobStartYmd("2026-08-17", TERMS, REF);
    assert.equal(p!.periodStartYmd, "2026-08-17");
    assert.equal(p!.periodEndYmd, "2026-08-30");
    assert.equal(p!.payoutDueYmd, "2026-09-04");
  });

  it("o cut-off cai sempre em domingo e o pagamento sempre em sexta", () => {
    const dow = (ymd: string) => new Date(`${ymd}T12:00:00Z`).getUTCDay();
    for (const dia of ["2026-08-05", "2026-08-19", "2026-09-02", "2026-12-01"]) {
      const p = workPeriodForJobStartYmd(dia, TERMS, REF);
      assert.ok(p);
      assert.equal(dow(p!.periodEndYmd), 0, `cut-off não é domingo para ${dia}`);
      assert.equal(dow(p!.payoutDueYmd), 5, `pagamento não é sexta para ${dia}`);
    }
  });

  it("períodos são contíguos e não se sobrepõem", () => {
    const a = workPeriodForJobStartYmd("2026-08-05", TERMS, REF)!;
    const b = workPeriodForJobStartYmd("2026-08-19", TERMS, REF)!;
    const diaSeguinte = new Date(`${a.periodEndYmd}T12:00:00Z`);
    diaSeguinte.setUTCDate(diaSeguinte.getUTCDate() + 1);
    assert.equal(b.periodStartYmd, diaSeguinte.toISOString().slice(0, 10));
  });
});
