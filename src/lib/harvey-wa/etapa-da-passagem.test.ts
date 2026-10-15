import { test } from "node:test";
import assert from "node:assert/strict";
import { etapaDaPassagem, textoDaPassagem } from "./etapa-da-passagem";

test("o que o Harvey declara em need manda", () => {
  assert.equal(etapaDaPassagem("call", "anything"), "call");
  assert.equal(etapaDaPassagem("quote", "anything"), "quote");
  assert.equal(etapaDaPassagem("other", "customer asked for a call back"), null);
});

test("sem need, o motivo escrito decide", () => {
  assert.equal(etapaDaPassagem(undefined, "Customer asked for a call back. Needs person to review."), "call");
  assert.equal(etapaDaPassagem(undefined, "Customer wants a call about the job"), "call");
  assert.equal(etapaDaPassagem(undefined, "job needs a proper quote: bathroom ceiling repair, outside catalogue"), "quote");
  assert.equal(etapaDaPassagem(undefined, "Dimmer switch is electrical work, needs a person"), "quote");
  assert.equal(etapaDaPassagem(undefined, "Gas hob ignition, team to take over"), "quote");
});

test("reclamação vira complaint; reserva existente e transferência vão para o Leo", () => {
  assert.equal(etapaDaPassagem("complaint", "anything"), "complaint");
  assert.equal(etapaDaPassagem("booking", "anything"), "booking");
  assert.equal(etapaDaPassagem(undefined, "Customer is unhappy with the clean and wants a refund"), "complaint");
  assert.equal(etapaDaPassagem("other", "Complaint: partner did not turn up"), "complaint");
  assert.equal(etapaDaPassagem(undefined, "Wants to pay by bank transfer"), "booking");
  assert.equal(etapaDaPassagem(undefined, "Wants to reschedule an existing booking"), "booking");
});

test("preocupação genérica e pedido de pessoa não mudam a etapa", () => {
  assert.equal(etapaDaPassagem(undefined, "Customer raised concern about recent reviews"), null);
  assert.equal(etapaDaPassagem(undefined, "Harvey asked for a person"), null);
});

test("promessa feita ao cliente sem chamar a ferramenta também decide", () => {
  const semFerramenta = "Harvey said he would get the team (no tool call): check the conversation";
  assert.equal(etapaDaPassagem(undefined, `${semFerramenta} Of course, I'll get someone from the team to give you a call now.`), "call");
  assert.equal(etapaDaPassagem(undefined, `${semFerramenta} That is electrical work rather than a handyman job. Let me grab someone from the team.`), "quote");
  assert.equal(etapaDaPassagem(undefined, `${semFerramenta} Let me grab someone from the team for this.`), null);
});

test("a linha da fila de ação diz o que fazer e por quê", () => {
  assert.equal(textoDaPassagem("call", "Customer asked  for a call back"), "Harvey handed over (call the customer): Customer asked for a call back");
  assert.equal(textoDaPassagem("complaint", "unhappy with the tiling"), "Harvey handed over (complaint, Leo to handle): unhappy with the tiling");
  assert.equal(textoDaPassagem(undefined, ""), "Harvey handed over (pick up the chat)");
});
