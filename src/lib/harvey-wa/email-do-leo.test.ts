import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { comentarioDoLeo, htmlDoLeo, textoDoLeo } from "./email-do-leo";

describe("e-mail do Leo", () => {
  it("sai com o Leo como autor e a assinatura dele", () => {
    const c = comentarioDoLeo("Hi Ann, just checking in.");
    assert.equal(c.public, true);
    assert.equal(c.author_id, 6227542863391);
    assert.match(c.html_body, /Kind regards,<br>Leo/);
    assert.match(c.html_body, /<strong>Leonardo Piovesan<\/strong> \| Operations/);
  });
  it("parágrafos viram <p> e o texto do cliente é escapado", () => {
    const h = htmlDoLeo("Hi <b>Ann</b>,\n\nLine one\nline two");
    assert.match(h, /<p style="margin:0 0 12px">Hi &lt;b&gt;Ann&lt;\/b&gt;,<\/p>/);
    assert.match(h, /Line one<br>line two/);
  });
  it("texto puro para o Resend termina com a assinatura", () => {
    assert.match(textoDoLeo("Hi Ann"), /Kind regards,\nLeo\n\nLeonardo Piovesan \| Operations/);
  });
});
