import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  readSelfBillAdjustments,
  sumSelfBillAdjustments,
  withSelfBillAdjustments,
} from "@/lib/self-bill-adjustments";

describe("self-bill adjustments", () => {
  it("ignora o que não tem rótulo ou valor positivo, e ordena taxas antes de material", () => {
    const list = readSelfBillAdjustments({
      adjustments: [
        { kind: "materials", label: "Materials JOB-9556", amount: 190 },
        { kind: "cancellation_fee", label: "", amount: 70 },
        { kind: "cancellation_fee", label: "Fee JOB-9654", amount: 70 },
        { kind: "other", label: "Negativo", amount: -5 },
        { kind: "other", label: "NaN", amount: Number.NaN },
        { kind: "bogus" as never, label: "Tipo desconhecido vira other", amount: "12.5" as never },
      ],
    });
    assert.deepEqual(
      list.map((a) => [a.kind, a.label, a.amount]),
      [
        ["cancellation_fee", "Fee JOB-9654", 70],
        ["materials", "Materials JOB-9556", 190],
        ["other", "Tipo desconhecido vira other", 12.5],
      ],
    );
  });

  it("breakdown vazio, nulo ou de folha de pagamento não tem ajuste", () => {
    assert.deepEqual(readSelfBillAdjustments(null), []);
    assert.deepEqual(readSelfBillAdjustments(undefined), []);
    assert.deepEqual(readSelfBillAdjustments({ fixed_pay: 100, commission_amount: 10 }), []);
  });

  it("soma com dois decimais", () => {
    const list = readSelfBillAdjustments({ adjustments: [{ kind: "other", label: "a", amount: 0.1 }, { kind: "other", label: "b", amount: 0.2 }] });
    assert.equal(sumSelfBillAdjustments(list), 0.3);
  });

  it("troca a lista sem perder o resto do breakdown", () => {
    const next = withSelfBillAdjustments({ fixed_pay: 100 }, [{ kind: "other", label: "x", amount: 5 }]);
    assert.equal(next.fixed_pay, 100);
    assert.deepEqual(next.adjustments, [{ kind: "other", label: "x", amount: 5 }]);
  });
});
