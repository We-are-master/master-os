import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { comentarioDoEmail, montarEmail, REMETENTE_DA_EQUIPE } from "./email-do-leo";
import { papeisPadrao } from "@/lib/responsavel-operacao";

const e = { assunto: "Your quote", preheader: "Pre", saudacao: "Hi <b>Ann</b>,", paragrafos: ["Line one", "Line two"] };

describe("e-mail de acompanhamento", () => {
  it("comentário público com o autor do papel e a moldura leve do Zendesk", () => {
    const c = comentarioDoEmail(e, 123);
    assert.equal(c.public, true);
    assert.equal(c.author_id, 123);
    assert.doesNotMatch(c.html_body, /<!DOCTYPE/);
    assert.doesNotMatch(c.html_body, /The Fixfy team/);
    assert.doesNotMatch(c.html_body, /\| Operations|Kind regards/);
  });
  it("padrão: o mesmo autor de antes, até alguém editar o papel", () => {
    assert.deepEqual(papeisPadrao({}).autor_emails, { zendesk_user_id: 6227542863391, nome: "Leonardo Piovesan" });
  });
  it("texto do cliente é escapado e o texto puro sai do mesmo conteúdo", () => {
    const { html, text } = montarEmail(e);
    assert.match(html, /Hi &lt;b&gt;Ann&lt;\/b&gt;,/);
    assert.match(text, /^Hi <b>Ann<\/b>,\n\nLine one\n\nLine two\n\nNeed a hand/);
    assert.match(text, /\+44 20 4538 4668/);
    assert.match(text, /hello@getfixfy\.com/);
  });
  it("fora do Zendesk sai como a equipe, sem nome de pessoa", () => {
    assert.equal(REMETENTE_DA_EQUIPE, "Fixfy <no-reply@getfixfy.com>");
  });
});
