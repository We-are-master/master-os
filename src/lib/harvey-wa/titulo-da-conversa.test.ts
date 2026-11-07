/** Toda conversa com Title (dono, 07/11/2026): sem ticket anterior, "WhatsApp · <nome>". */
import assert from "node:assert/strict";
import { test } from "node:test";
import { tituloDeReserva } from "./zendesk-wa";

test("Title de reserva tira o 'Conversation with' do Zendesk", () => {
  assert.equal(tituloDeReserva("Conversation with Damilola"), "WhatsApp · Damilola");
  assert.equal(tituloDeReserva("conversation with   Dawn🌹"), "WhatsApp · Dawn🌹");
});

test("Sem assunto ainda tem Title", () => {
  assert.equal(tituloDeReserva(null), "WhatsApp · new conversation");
  assert.equal(tituloDeReserva("Conversation with "), "WhatsApp · new conversation");
});
