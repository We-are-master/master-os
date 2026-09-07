import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { podeRemarcar, hojeEmLondres } from "./remarcacao";

const HOJE = "2026-09-07";

describe("podeRemarcar", () => {
  test("job que ainda não foi executado pode mudar de data", () => {
    for (const s of ["unassigned", "auto_assigning", "scheduled", "late", "need_attention"]) {
      assert.deepEqual(podeRemarcar(s, "2026-09-14", HOJE), { pode: true }, `deveria deixar ${s}`);
    }
  });

  test("visita já feita nunca é remarcada — foi o JOB-9444", () => {
    // O e-mail de 14/08/2026 pedia 17/08 e casou com um job em `awaiting_payment`.
    // Aplicar teria avisado parceiro e conta sobre um trabalho já entregue.
    for (const s of ["in_progress", "final_check", "awaiting_payment", "completed", "on_hold"]) {
      assert.deepEqual(
        podeRemarcar(s, "2026-09-14", HOJE),
        { pode: false, motivo: "ja_aconteceu" },
        `deveria travar ${s}`,
      );
    }
  });

  test("data no passado é e-mail velho voltando, não instrução", () => {
    assert.deepEqual(podeRemarcar("scheduled", "2026-08-17", HOJE), {
      pode: false,
      motivo: "data_no_passado",
    });
  });

  test("hoje ainda vale: remarcar para daqui a pouco é legítimo", () => {
    assert.deepEqual(podeRemarcar("scheduled", HOJE, HOJE), { pode: true });
  });

  test("o status pesa mais que a data: job feito não passa nem com data futura", () => {
    assert.deepEqual(podeRemarcar("completed", "2027-01-01", HOJE), {
      pode: false,
      motivo: "ja_aconteceu",
    });
  });
});

describe("hojeEmLondres", () => {
  test("é o dia de Londres, não o do servidor", () => {
    // 23:30 em Londres no dia 7 é 22:30 UTC. Um servidor em UTC concorda.
    assert.equal(hojeEmLondres(new Date("2026-09-07T22:30:00Z")), "2026-09-07");
    // Mas 00:30 BST do dia 8 é 23:30 UTC do dia 7: quem usar UTC erra o dia.
    assert.equal(hojeEmLondres(new Date("2026-09-07T23:30:00Z")), "2026-09-08");
  });

  test("formato é o que a coluna scheduled_date usa", () => {
    assert.match(hojeEmLondres(new Date("2026-01-15T12:00:00Z")), /^\d{4}-\d{2}-\d{2}$/);
  });
});
