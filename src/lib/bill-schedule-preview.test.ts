import { strict as assert } from "node:assert";
import { test } from "node:test";
import { generateRecurringDueDates } from "./bill-recurrence";

/**
 * O preview do formulário de conta e a criação das linhas chamam esta mesma
 * função. Estes testes travam o comportamento de que o dois dependem: o que a
 * revisão promete é o que entra no Cash-Flow.
 */

test("conta recorrente que termina para exatamente no fim, sem passar", () => {
  // Checkatrade, todo dia 18, começando em maio e terminando em janeiro.
  const dates = generateRecurringDueDates("2026-05-18", "monthly", 120, "2027-01-18");
  assert.equal(dates.length, 9);
  assert.equal(dates[0], "2026-05-18");
  assert.equal(dates[dates.length - 1], "2027-01-18");
  assert.ok(dates.every((d) => d <= "2027-01-18"), "nenhuma ocorrência depois do fim");
});

test("o dia do vencimento não escorrega ao longo da série", () => {
  const dates = generateRecurringDueDates("2026-05-05", "monthly", 6, null);
  assert.deepEqual(dates, [
    "2026-05-05",
    "2026-06-05",
    "2026-07-05",
    "2026-08-05",
    "2026-09-05",
    "2026-10-05",
  ]);
});

test("fim antes do primeiro vencimento não cria linha nenhuma", () => {
  // O formulário barra isso antes, e o serviço também: uma série vazia viraria
  // uma conta que existe no banco e nunca aparece no Cash-Flow.
  assert.equal(generateRecurringDueDates("2026-05-18", "monthly", 12, "2026-04-01").length, 0);
});

test("fim no mesmo dia do primeiro vencimento cria uma linha só", () => {
  assert.deepEqual(generateRecurringDueDates("2026-05-18", "monthly", 12, "2026-05-18"), ["2026-05-18"]);
});

test("sem data de fim, a série para no horizonte pedido", () => {
  // "Ongoing" não é infinito: agenda o horizonte e mostra até onde foi.
  assert.equal(generateRecurringDueDates("2026-05-18", "monthly", 12, null).length, 12);
});

test("o total da revisão é a contagem real vezes o valor", () => {
  const dates = generateRecurringDueDates("2026-05-18", "monthly", 120, "2027-01-18");
  assert.equal(Math.round(640 * dates.length * 100) / 100, 5760);
});
