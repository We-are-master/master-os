import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { comentarioDoEmail, htmlDoEmail, textoDoEmail } from "./email-do-leo";
import { papeisPadrao } from "@/lib/responsavel-operacao";

describe("e-mail de chase", () => {
  it("sai com quem assina como autor e sem assinatura no corpo (o Zendesk põe a dele)", () => {
    const c = comentarioDoEmail("Hi Ann, just checking in.", 123);
    assert.equal(c.public, true);
    assert.equal(c.author_id, 123);
    assert.match(c.html_body, /<p style="margin:0">Kind regards,<\/p>$/);
    assert.doesNotMatch(c.html_body, /\| Operations/);
  });
  it("padrão: o mesmo autor de antes, até alguém editar o papel", () => {
    assert.deepEqual(papeisPadrao({}).autor_emails, { zendesk_user_id: 6227542863391, nome: "Leonardo Piovesan" });
  });
  it("fora do Zendesk a assinatura de quem assina vai no corpo", () => {
    assert.match(htmlDoEmail("Hi Ann", "Kind regards,", "Ana Silva"), /<strong>Ana Silva<\/strong> \| Operations/);
    assert.doesNotMatch(htmlDoEmail("Hi Ann"), /<strong>/);
  });
  it("parágrafos viram <p> e o texto do cliente é escapado", () => {
    const h = htmlDoEmail("Hi <b>Ann</b>,\n\nLine one\nline two");
    assert.match(h, /<p style="margin:0 0 12px">Hi &lt;b&gt;Ann&lt;\/b&gt;,<\/p>/);
    assert.match(h, /Line one<br>line two/);
  });
  it("texto puro para o Resend termina com a assinatura", () => {
    assert.match(textoDoEmail("Hi Ann", "Ana Silva"), /Kind regards,\n\nAna Silva \| Operations/);
  });
});
