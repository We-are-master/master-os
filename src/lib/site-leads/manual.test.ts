import { strict as assert } from "node:assert";
import { test } from "node:test";
import { canalDe, validarLinha } from "./manual";

test("origem: apelidos da planilha viram o valor gravado", () => {
  assert.equal(canalDe("WA"), "whatsapp");
  assert.equal(canalDe("Facebook"), "meta_form");
  assert.equal(canalDe("walk in"), "walk_in");
  assert.equal(canalDe(""), "other");
  assert.equal(canalDe("tiktok"), null);
});

test("linha precisa de e-mail ou telefone", () => {
  assert.equal(validarLinha({ name: "A" }).ok, false);
  const so = validarLinha({ name: "A", phone: "07700 900123", channel: "whatsapp" });
  assert.ok(so.ok && so.dados.email === null && so.dados.channel === "whatsapp");
});

test("preço, status, data e etiquetas", () => {
  const r = validarLinha({ email: "X@Y.com", price: "£1,030", status: "quente", created_at: "24/09/2026 14:30", tags: "B2C; void, Landlord" });
  assert.ok(r.ok);
  if (r.ok) {
    assert.equal(r.dados.email, "x@y.com");
    assert.equal(r.dados.price, 1030);
    assert.equal(r.dados.status, "hot");
    assert.equal(r.dados.created_at, "2026-09-24T14:30:00.000Z");
    assert.deepEqual(r.dados.tags, ["b2c", "void", "landlord"]);
  }
  assert.equal(validarLinha({ email: "a@b.com", price: "abc" }).ok, false);
  assert.equal(validarLinha({ email: "a@b.com", status: "won" }).ok, false);
});

test("origem criada em Settings vale no CSV, e desativada não", () => {
  const canais = [
    { key: "tiktok", label: "TikTok", active: true, sort: 1, aliases: ["tt"] },
    { key: "whatsapp", label: "WhatsApp", active: false, sort: 2, aliases: ["wa"] },
    { key: "other", label: "Other", active: true, sort: 3, aliases: [] },
  ];
  assert.equal(canalDe("TT", canais), "tiktok");
  assert.equal(canalDe("TikTok", canais), "tiktok");
  assert.equal(canalDe("wa", canais), null);
  assert.equal(canalDe("", canais), "other");
  assert.equal(validarLinha({ phone: "07700 900123", channel: "tiktok" }, canais).ok, true);
});
