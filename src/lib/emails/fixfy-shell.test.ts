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
    assert.equal(dataLonga("2026-10-21"), "Wed 21 Oct 26");
    assert.equal(dataLonga(null), null);
  });
  test("janela em Londres, 24h compacta (09:00-12:00)", () => {
    assert.equal(janelaTexto("2026-10-21T08:00:00Z", "2026-10-21T11:00:00Z"), "09:00-12:00");
    assert.equal(janelaTexto("2026-11-02T09:30:00Z", "2026-11-02T13:00:00Z"), "09:30-13:00");
  });
  test("janela que chega como texto", () => {
    assert.equal(janelaDeTexto("9AM – 12PM"), "09:00-12:00");
    assert.equal(janelaDeTexto("between 9am and midday"), "09:00-12:00");
    assert.equal(janelaDeTexto("1-5pm"), "13:00-17:00");
    assert.equal(janelaDeTexto("9-12pm"), "09:00-12:00");
    assert.equal(janelaDeTexto("09:00-15:00"), "09:00-15:00");
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
    assert.match(m.html, />Need a hand\?</);
    assert.match(m.html, /Reply to this email or message us on WhatsApp/);
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
  test("zendesk sem tabela nenhuma (o visualizador desenha borda em toda célula)", () => {
    const m = emailFixfy({ ...base, zendesk: true });
    assert.equal((m.html.match(/<table/g) ?? []).length, 0);
  });
  test("opções do parceiro não mudam o e-mail do cliente quando ausentes", () => {
    const antes = emailFixfy(base);
    const comCamposVazios = emailFixfy({ ...base, antesDoBotao: null, semAjuda: false, estado: { ...base.estado, chip: undefined } });
    assert.equal(comCamposVazios.html, antes.html);
    assert.equal(comCamposVazios.text, antes.text);
    // Sem chip, o estado verde segue texto (não pílula).
    assert.doesNotMatch(antes.html, /border-radius:999px/);
  });
  test("chip colorido, saudação vazia some, fotos antes do botão, sem quadro de ajuda", () => {
    const m = emailFixfy({
      ...base,
      estado: { texto: "Job booked", cor: "green", chip: true },
      saudacao: "",
      paragrafos: [],
      antesDoBotao: { html: "<div>FOTOS</div>", text: "Site photos (2)" },
      semAjuda: true,
    });
    assert.match(m.html, /background:#E8F5EC;color:#15803D;[^>]*border-radius:999px;">Job booked</);
    assert.doesNotMatch(m.html, /Need a hand\?/);
    assert.doesNotMatch(m.html, /<p[^>]*><\/p>/);
    const fotos = m.html.indexOf("FOTOS");
    assert.ok(fotos > m.html.indexOf(">Handyman<") && fotos < m.html.indexOf(">Pay now<"));
    assert.ok(m.text.indexOf("Site photos (2)") < m.text.indexOf("Pay now:"));
    assert.doesNotMatch(m.text, /^Hi /m);
  });
  test("pagamento vencido vira a faixa vermelha do OS no topo", () => {
    const m = emailFixfy({ ...base, estado: { texto: "Overdue", cor: "red" } });
    assert.match(m.html, /background:#FDE6EA;padding:12px 24px/);
    assert.match(m.html, /color:#7D0A1C;vertical-align:middle;">Overdue</);
  });
  test("métrica riscada", () => {
    const m = emailFixfy({ ...base, metricas: [{ rotulo: "Was", valor: "Wed 28 Oct 26", riscado: true }] });
    assert.match(m.html, /text-decoration:line-through[^>]*>Wed 28 Oct 26</);
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
