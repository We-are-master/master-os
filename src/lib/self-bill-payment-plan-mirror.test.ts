import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { partnerInstalmentsMirroringClient } from "./self-bill-payment-plan";

describe("partnerInstalmentsMirroringClient", () => {
  it("mesma proporção e mesmas datas, soma exata", () => {
    const r = partnerInstalmentsMirroringClient(
      [
        { amount: 60, due_date: "2026-10-20" },
        { amount: 60, due_date: "2026-11-03" },
        { amount: 60, due_date: "2026-11-17" },
      ],
      100,
    );
    assert.deepEqual(r.map((x) => x.due_date), ["2026-10-20", "2026-11-03", "2026-11-17"]);
    assert.deepEqual(r.map((x) => x.amount), [33.33, 33.33, 33.34]);
  });
  it("parcelas desiguais seguem o peso do cliente", () => {
    const r = partnerInstalmentsMirroringClient(
      [
        { amount: 90, due_date: "2026-10-12" },
        { amount: 90, due_date: "2026-10-26" },
      ],
      100,
    );
    assert.deepEqual(r.map((x) => x.amount), [50, 50]);
  });
  it("sem plano ou sem valor não gera nada", () => {
    assert.deepEqual(partnerInstalmentsMirroringClient([], 100), []);
    assert.deepEqual(partnerInstalmentsMirroringClient([{ amount: 10, due_date: "2026-10-12" }], 0), []);
  });
});
