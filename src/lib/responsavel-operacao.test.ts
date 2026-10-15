import { test } from "node:test";
import assert from "node:assert/strict";
import { papeisPadrao, validarPapeis } from "./responsavel-operacao";

const SEMPRE = { zendesk_user_id: 6227542863391, nome: "Leonardo Piovesan" };

test("sem linha nem env: os três papéis ficam com o usuário de sempre (nada muda)", () => {
  assert.deepEqual(papeisPadrao({}), { operacao: SEMPRE, autor_emails: SEMPRE, autor_aviso_cotacao: SEMPRE });
});

test("env de antes ainda vale como padrão", () => {
  const p = papeisPadrao({ ZENDESK_OPS_AGENT_ID: "111", HARVEY_EMAIL_AUTHOR_ID: " 222 ", HARVEY_AVISO_AUTOR_ID: "lixo" });
  assert.equal(p.operacao.zendesk_user_id, 111);
  assert.equal(p.autor_emails.zendesk_user_id, 222);
  assert.deepEqual(p.autor_aviso_cotacao, SEMPRE);
});

test("o banco vence; papel sem id válido fica no padrão", () => {
  const p = validarPapeis({ operacao: { zendesk_user_id: 999, nome: " Ana Silva " }, autor_emails: { zendesk_user_id: "x" } }, papeisPadrao({}));
  assert.deepEqual(p.operacao, { zendesk_user_id: 999, nome: "Ana Silva" });
  assert.deepEqual(p.autor_emails, SEMPRE);
  assert.deepEqual(validarPapeis(null, papeisPadrao({})), papeisPadrao({}));
});
