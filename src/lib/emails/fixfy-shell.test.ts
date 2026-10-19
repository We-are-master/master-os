import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { dataLonga, emailFixfy, emailPessoal, janelaDeTexto, janelaTexto, preencher, saudacao, urlSegura } from "./fixfy-shell";

describe("saudacao", () => {
  test("B2C com e sem nome", () => {
    assert.equal(saudacao({ tipo: "b2c", primeiroNome: "Sarah Jones" }), "Hi Sarah,");
    assert.equal(saudacao({ tipo: "b2c", primeiroNome: "" }), "Hi there,");
  });
  test("B2B nunca usa pessoa; não repete team", () => {
    assert.equal(saudacao({ tipo: "b2b", empresa: "Acme Lettings" }), "Hi Acme Lettings team,");
    assert.equal(saudacao({ tipo: "b2b", empresa: "  " }), "Hi team,");
    assert.equal(saudacao({ tipo: "b2b", empresa: "Facilities team" }), "Hi Facilities team,");
  });
});

describe("data e janela", () => {
  test("data longa com ano", () => {
    assert.equal(dataLonga("2026-10-21"), "Wednesday 21 October 2026");
    assert.equal(dataLonga(null), null);
  });
  test("janela em Londres, meio-dia vira midday", () => {
    assert.equal(janelaTexto("2026-10-21T08:00:00Z", "2026-10-21T11:00:00Z"), "between 9am and midday");
    assert.equal(janelaTexto("2026-11-02T09:30:00Z", "2026-11-02T13:00:00Z"), "between 9:30am and 1pm");
  });
  test("janela que chega como texto", () => {
    assert.equal(janelaDeTexto("9AM – 12PM"), "between 9am and midday");
    assert.equal(janelaDeTexto("09:00-15:00"), "between 9am and 3pm");
    assert.equal(janelaDeTexto("To be confirmed"), null);
  });
});

describe("preencher", () => {
  test("acusa o que falta", () => {
    const r = preencher("Hi {{a}} and {{b}}", { a: "x" });
    assert.deepEqual(r.faltando, ["b"]);
  });
});

describe("emailFixfy", () => {
  const base = {
    preheader: "p",
    estado: { texto: "Confirmed", cor: "green" as const },
    titulo: "Your booking is confirmed",
    saudacao: "Hi Sarah,",
    paragrafos: ["Lovely, that’s in the diary."],
    linhas: [["Service", "Handyman"], ["Property", ""]] as Array<[string, string]>,
    cta: { label: "Pay now", url: "https://app.getfixfy.com/pay/INV-1" },
  };
  test("html e texto do mesmo conteúdo, linha vazia some, rodapé novo", () => {
    const m = emailFixfy(base);
    assert.match(m.html, /Need a hand\? Reply to this email/);
    assert.match(m.html, /\+44 20 4538 4668/);
    assert.doesNotMatch(m.html, />Property</);
    assert.match(m.text, /Service: Handyman/);
    assert.match(m.text, /Pay now: https:\/\/app\.getfixfy\.com\/pay\/INV-1/);
    assert.doesNotMatch(m.text, /The Fixfy team/);
    for (const t of [m.html, m.text]) assert.doesNotMatch(t, /[–—]|\{\{/);
  });
  test("URL não-http não vira botão", () => {
    assert.equal(urlSegura("javascript:alert(1)"), null);
    const m = emailFixfy({ ...base, cta: { label: "Pay", url: "javascript:x" } });
    assert.doesNotMatch(m.html, /javascript:/);
  });
  test("zendesk sem tabela interna", () => {
    const m = emailFixfy({ ...base, zendesk: true });
    assert.equal((m.html.match(/<table/g) ?? []).length, 1);
  });
  test("escapa campo do cliente", () => {
    const m = emailFixfy({ ...base, saudacao: "Hi <b>x</b>," });
    assert.match(m.html, /Hi &lt;b&gt;x&lt;\/b&gt;,/);
  });
});

describe("emailPessoal", () => {
  test("assina e tem rodapé", () => {
    const m = emailPessoal({ preheader: "p", saudacao: "Hi there,", paragrafos: ["Just checking in."] });
    assert.doesNotMatch(m.text, /The Fixfy team/);
    assert.match(m.html, /hello@getfixfy\.com/);
  });
});
