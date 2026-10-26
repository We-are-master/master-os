/**
 * A linha da nota no ticket do job: quem falou e o quê.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { linhaDaMensagem } from "./espelho-no-job";
import type { MensagemSc } from "./sunshine";

const m = (p: Partial<MensagemSc>): MensagemSc => ({ id: "1", received: "", author: { type: "user" }, content: { type: "text" }, ...p });

test("cliente, Harvey, equipe e mídia", () => {
  assert.equal(linhaDaMensagem(m({ content: { type: "text", text: "Ok" } }), "Diana Delbridge"), "💬 Diana Delbridge on WhatsApp: Ok");
  assert.equal(linhaDaMensagem(m({ author: { type: "business", displayName: "Harvey White" }, metadata: { harvey: true }, content: { type: "text", text: "Thanks." } }), null), "🤖 Harvey on WhatsApp: Thanks.");
  assert.equal(linhaDaMensagem(m({ author: { type: "business", displayName: "Leonardo" }, content: { type: "text", text: "On our way" } }), null), "👤 Leonardo on WhatsApp: On our way");
  assert.equal(linhaDaMensagem(m({ author: { type: "user", displayName: "Ma" }, content: { type: "image" } }), null), "💬 Ma on WhatsApp: [photo]");
});
