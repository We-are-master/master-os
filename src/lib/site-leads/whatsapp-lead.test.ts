import { strict as assert } from "node:assert";
import { test } from "node:test";
import { WhatsAppError } from "@/lib/whatsapp/cloud";
import { parametrosDoCorpo, sufixoDoBotao, tipoDoErro } from "./whatsapp-lead";

const UTM = "utm_source=whatsapp&utm_medium=recovery&utm_campaign=reserva_abandonada";

test("limpeza end of tenancy: o link da home sem kind (é o padrão), igual ao exemplo aprovado", () => {
  const s = sufixoDoBotao({ selection: { services: ["clean"], size: "2", clean: { kind: "eot" } } }, "COMEBACK10");
  assert.equal(s, `?s=clean&size=2&promo=COMEBACK10&${UTM}`);
});

test("deep clean e after builders levam o kind; studio passa", () => {
  assert.equal(
    sufixoDoBotao({ selection: { services: ["clean"], size: "2", clean: { kind: "deep" } } }, "BACK-7K2Q"),
    `?s=clean&kind=deep&size=2&promo=BACK-7K2Q&${UTM}`,
  );
  assert.equal(
    sufixoDoBotao({ selection: { services: ["clean"], size: "studio", clean: { kind: "after" } } }, "X1"),
    `?s=clean&kind=after&size=studio&promo=X1&${UTM}`,
  );
  // tamanho estranho não entra
  assert.equal(sufixoDoBotao({ selection: { services: ["clean"], size: "99", clean: {} } }, "X1"), `?s=clean&promo=X1&${UTM}`);
});

test("conserto, certificado ou mistura: o link da própria reserva, mais código e origem", () => {
  assert.equal(
    sufixoDoBotao({ selection: { services: ["fix"] }, resume_url: "https://www.getfixfy.com/book?s=fix&fix=half" }, "COMEBACK10"),
    `book?s=fix&fix=half&promo=COMEBACK10&${UTM}`,
  );
  const misto = sufixoDoBotao(
    { selection: { services: ["clean", "fix"] }, resume_url: "https://www.getfixfy.com/book?s=clean,fix&fix=half&pc=SE12%208AA" },
    "X1",
  );
  const q = new URLSearchParams(misto.slice(misto.indexOf("?")));
  assert.ok(misto.startsWith("book?"));
  assert.equal(q.get("s"), "clean,fix");
  assert.equal(q.get("pc"), "SE12 8AA");
  assert.equal(q.get("promo"), "X1");
  assert.equal(q.get("utm_source"), "whatsapp");
});

test("sem link, ou link de fora, o botão abre a home", () => {
  assert.equal(sufixoDoBotao({ selection: { services: ["cert"] }, resume_url: null }, "X1"), `?promo=X1&${UTM}`);
  assert.equal(sufixoDoBotao({ selection: {}, resume_url: "https://evil.example/book?s=fix" }, "X1"), `?promo=X1&${UTM}`);
  assert.equal(sufixoDoBotao({ selection: {}, resume_url: "not a url" }, "X1"), `?promo=X1&${UTM}`);
});

test("corpo do template: primeiro nome, serviço numa linha só, código", () => {
  assert.deepEqual(parametrosDoCorpo({ full_name: "alex smith", service_label: "2 bed deep clean" }, "BACK-7K2Q"), ["Alex", "2 bed deep clean", "BACK-7K2Q"]);
  assert.deepEqual(parametrosDoCorpo({ full_name: "", service_label: "2 bed\n  deep   clean" }, "X"), ["there", "2 bed deep clean", "X"]);
  assert.deepEqual(parametrosDoCorpo({}, "X"), ["there", "booking", "X"]);
});

test("erros da Meta: template espera, ritmo espera, número fecha, o resto é erro", () => {
  assert.equal(tipoDoErro(new WhatsAppError("Template name does not exist in the translation", 132001)), "template");
  assert.equal(tipoDoErro(new WhatsAppError("Template paused", 132015)), "template");
  assert.equal(tipoDoErro(new WhatsAppError("Template disabled", 132016)), "template");
  assert.equal(tipoDoErro(new WhatsAppError("Spam rate limit hit", 131048)), "ritmo");
  assert.equal(tipoDoErro(new WhatsAppError("Rate limit", 130429)), "ritmo");
  assert.equal(tipoDoErro(new WhatsAppError("Message undeliverable", 131026)), "numero");
  assert.equal(tipoDoErro(new WhatsAppError("número inválido para WhatsApp: 123")), "numero");
  assert.equal(tipoDoErro(new WhatsAppError("Invalid OAuth access token", 190)), "outro");
  assert.equal(tipoDoErro(new Error("fetch failed")), "outro");
});
