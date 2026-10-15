import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ACTION_REQUIRED_FIELD_ID, ACTION_REQUIRED_NO, ACTION_REQUIRED_YES, jaAnotado, notaDaAcao, passoDoNao, passoDoSim, valorDoCampo } from "./fila-de-acao";

describe("fila de ação", () => {
  it("a nota é uma linha só, com o prefixo uma vez", () => {
    assert.equal(notaDaAcao("No bids after 26h:\n invite more partners  or call"), "⚡ Action Required: No bids after 26h: invite more partners or call");
    assert.equal(notaDaAcao("⚡ Action Required: call the customer"), "⚡ Action Required: call the customer");
    assert.equal(notaDaAcao("   "), "⚡ Action Required: check this ticket");
    assert.ok(notaDaAcao("x".repeat(400)).length <= "⚡ Action Required: ".length + 280);
  });

  it("lê o valor do campo", () => {
    assert.equal(valorDoCampo([{ id: 1, value: "a" }, { id: ACTION_REQUIRED_FIELD_ID, value: ACTION_REQUIRED_YES }]), ACTION_REQUIRED_YES);
    assert.equal(valorDoCampo([{ id: ACTION_REQUIRED_FIELD_ID, value: null }]), null);
    assert.equal(valorDoCampo(undefined), null);
  });

  it("não repete a mesma nota interna recente", () => {
    const agora = new Date("2026-10-15T12:00:00Z");
    const nota = notaDaAcao("call the customer");
    const recente = { body: nota, created_at: "2026-10-15T09:00:00Z", public: false };
    assert.equal(jaAnotado([recente], nota, agora), true);
    // Pela reserva (ticket do lead), o texto vem com prefixo: ainda conta.
    assert.equal(jaAnotado([{ ...recente, body: `(From WhatsApp ticket #1, which Harvey is still handling.)\n\n${nota}` }], nota, agora), true);
    assert.equal(jaAnotado([{ ...recente, created_at: "2026-10-13T09:00:00Z" }], nota, agora), false);
    assert.equal(jaAnotado([{ ...recente, public: true }], nota, agora), false);
    assert.equal(jaAnotado([{ ...recente, body: notaDaAcao("send the quote") }], nota, agora), false);
  });

  it("Yes: escreve, a menos que já esteja igual ou o ticket esteja fechado", () => {
    assert.equal(passoDoSim({ status: "open", valorAtual: null, jaTemANota: false }), "escrever");
    assert.equal(passoDoSim({ status: "open", valorAtual: ACTION_REQUIRED_NO, jaTemANota: true }), "escrever");
    assert.equal(passoDoSim({ status: "open", valorAtual: ACTION_REQUIRED_YES, jaTemANota: false }), "escrever");
    assert.equal(passoDoSim({ status: "pending", valorAtual: ACTION_REQUIRED_YES, jaTemANota: true }), "nada");
    assert.equal(passoDoSim({ status: "closed", valorAtual: null, jaTemANota: false }), "fechado");
  });

  it("No: só escreve o que muda", () => {
    assert.equal(passoDoNao({ status: "open", valorAtual: ACTION_REQUIRED_YES, temNota: false }), "escrever");
    assert.equal(passoDoNao({ status: "open", valorAtual: null, temNota: false }), "escrever");
    assert.equal(passoDoNao({ status: "open", valorAtual: ACTION_REQUIRED_NO, temNota: false }), "nada");
    assert.equal(passoDoNao({ status: "open", valorAtual: ACTION_REQUIRED_NO, temNota: true }), "escrever");
    assert.equal(passoDoNao({ status: "closed", valorAtual: ACTION_REQUIRED_YES, temNota: false }), "fechado");
  });
});
