import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  amanhaEmLondres,
  confirmacaoRecente,
  dentroDaJanelaDoLembrete,
  horaEmLondres,
} from "@/lib/client-confirmation/sweep-24h";

/**
 * A janela é do relógio de LONDRES, e isso é o ponto.
 *
 * O launchd dispara no horário do Mac (São Paulo). A diferença para Londres é
 * de 4 horas no verão britânico e 3 no inverno, então um horário fixo no plist
 * andaria uma hora sozinho duas vezes por ano. Quem decide é esta função.
 */
describe("janela do lembrete de véspera", () => {
  it("18h de Londres no verão britânico manda", () => {
    // 17:00 UTC = 18:00 BST
    assert.equal(horaEmLondres(new Date("2026-08-24T17:00:00Z")), 18);
    assert.equal(dentroDaJanelaDoLembrete(new Date("2026-08-24T17:00:00Z")), true);
  });

  it("18h de Londres no inverno manda, mesmo sendo outro UTC", () => {
    // 18:00 UTC = 18:00 GMT
    assert.equal(horaEmLondres(new Date("2026-12-10T18:00:00Z")), 18);
    assert.equal(dentroDaJanelaDoLembrete(new Date("2026-12-10T18:00:00Z")), true);
  });

  it("a mesma hora do Mac cai dentro no verão e fora no inverno", () => {
    // 14:00 em São Paulo (UTC-3) = 17:00 UTC.
    const veraoBritanico = new Date("2026-08-24T17:00:00Z"); // 18:00 em Londres
    const invernoBritanico = new Date("2026-12-10T17:00:00Z"); // 17:00 em Londres
    assert.equal(dentroDaJanelaDoLembrete(veraoBritanico), true);
    assert.equal(dentroDaJanelaDoLembrete(invernoBritanico), false);
  });

  it("manhã da véspera não manda: o dia ainda vai mudar", () => {
    assert.equal(dentroDaJanelaDoLembrete(new Date("2026-08-24T09:00:00Z")), false); // 10:00 Londres
  });

  it("17h59 de Londres ainda não, 22h já não", () => {
    assert.equal(dentroDaJanelaDoLembrete(new Date("2026-08-24T16:59:00Z")), false); // 17:59
    assert.equal(dentroDaJanelaDoLembrete(new Date("2026-08-24T21:00:00Z")), false); // 22:00
    assert.equal(dentroDaJanelaDoLembrete(new Date("2026-08-24T20:59:00Z")), true);  // 21:59
  });

  it("às 18h de Londres, o alvo é o dia seguinte", () => {
    assert.equal(amanhaEmLondres(new Date("2026-08-24T17:00:00Z")), "2026-08-25");
  });
});

/**
 * Assign de última hora: a confirmação de booking que acabou de sair JÁ disse
 * data e janela de amanhã. O lembrete de véspera não pode ser a segunda
 * mensagem da mesma noite (dono, 26/08).
 */
describe("uma mensagem por noite", () => {
  const agora = new Date("2026-08-26T18:30:00Z");

  it("confirmação de 2 horas atrás cala o lembrete", () => {
    assert.equal(confirmacaoRecente("2026-08-26T16:30:00Z", agora), true);
  });

  it("confirmação de 3 dias atrás deixa o lembrete trabalhar", () => {
    assert.equal(confirmacaoRecente("2026-08-23T16:30:00Z", agora), false);
  });

  it("sem confirmação (ou data podre) não bloqueia nada", () => {
    assert.equal(confirmacaoRecente(null, agora), false);
    assert.equal(confirmacaoRecente("not-a-date", agora), false);
  });
});
