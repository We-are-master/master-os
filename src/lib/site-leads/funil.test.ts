import { strict as assert } from "node:assert";
import { test } from "node:test";
import { linhaDoFunil } from "./funil";

const visita = "3f1c2a9e-8b7d-4c6e-9a1b-2d3e4f5a6b7c";

test("passo válido vira linha, só com as etiquetas do link", () => {
  const l = linhaDoFunil({
    visitId: visita,
    step: "book_2",
    services: ["fix", "clean", "hack"],
    utm: { utm_source: "meta", utm_campaign: "cleaning_london", utm_content: "cd_capa", email: "x@y.com" },
    landing: "/book?pc=SW19&name=Ana",
  });
  assert.ok(l);
  assert.equal(l.event, "book_2");
  assert.equal(l.services, "clean,fix");
  assert.equal(l.utm_content, "cd_capa");
  assert.equal(l.landing, "/book");
  assert.ok(!JSON.stringify(l).includes("x@y.com"));
});

test("visita sem uuid ou evento de fora não entra", () => {
  assert.equal(linhaDoFunil({ visitId: "abc", step: "book_1" }), null);
  assert.equal(linhaDoFunil({ visitId: visita, step: "paid" }), null);
});
