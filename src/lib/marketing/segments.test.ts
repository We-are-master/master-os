import { strict as assert } from "node:assert";
import { test } from "node:test";
import { areaDoPostcode, segmentoDoEmail, telefoneValido } from "./segments";
import { normalizarEmail } from "./suppressions";

test("relay da Apple e do DuckDuckGo é B2C, não é lixo", () => {
  // Errei isto em 14/09/2026: quase removi 50 contatos bons achando que o
  // relay não entregava. Ele encaminha para a caixa real da pessoa.
  assert.equal(segmentoDoEmail("abc123@privaterelay.appleid.com"), "b2c");
  assert.equal(segmentoDoEmail("alguem@duck.com"), "b2c");
});

test("e-mail do trabalho para serviço de casa conta como B2C", () => {
  // O comprador é a enfermeira, não o hospital.
  assert.equal(segmentoDoEmail("sofia@nhs.net"), "b2c");
  assert.equal(segmentoDoEmail("raman@doctors.org.uk"), "b2c");
});

test("provedor pessoal é B2C, domínio próprio é B2B", () => {
  for (const e of ["a@gmail.com", "a@hotmail.co.uk", "a@yahoo.co.uk", "a@icloud.com", "a@btinternet.com"]) {
    assert.equal(segmentoDoEmail(e), "b2c", e);
  }
  for (const e of ["naomi@peakestatesltd.co.uk", "info@newagelettings.co.uk", "a@homyze.com"]) {
    assert.equal(segmentoDoEmail(e), "b2b", e);
  }
});

test("e-mail inválido não vira segmento nenhum", () => {
  for (const e of ["", "  ", "nao-e-email", "sem-arroba.com", null, undefined]) {
    assert.equal(segmentoDoEmail(e as string | null), null, String(e));
  }
});

test("postcode cai na área certa de Londres", () => {
  assert.equal(areaDoPostcode("SE15 4TY"), "sul");
  assert.equal(areaDoPostcode("sw2 5qn"), "sul");
  assert.equal(areaDoPostcode("E17 3DL"), "leste");
  assert.equal(areaDoPostcode("N19 5DX"), "norte");
  assert.equal(areaDoPostcode("NW3 3QX"), "norte");
  assert.equal(areaDoPostcode("W1G 6PR"), "oeste");
  assert.equal(areaDoPostcode("EC1V 2NX"), "oeste");
  assert.equal(areaDoPostcode("RM20 4XP"), "fora_m25");
});

test("E não engole EC nem EN: o prefixo mais longo ganha", () => {
  // "EC1V" começa com E, e EC é centro, não leste. "EN5" é fora do M25.
  assert.equal(areaDoPostcode("EC2Y 9SS"), "oeste");
  assert.equal(areaDoPostcode("EN5 2QH"), "fora_m25");
  assert.equal(areaDoPostcode("E1 3AQ"), "leste");
});

test("postcode ausente ou de fora não derruba", () => {
  for (const p of ["", null, undefined, "12345", "ZZ99 9ZZ"]) {
    assert.equal(areaDoPostcode(p as string | null), null, String(p));
  }
});

test("telefone precisa de dez dígitos, em qualquer formatação", () => {
  assert.equal(telefoneValido("+44 77474 63079"), true);
  assert.equal(telefoneValido("07747463079"), true);
  assert.equal(telefoneValido("020 4538 0694"), true);
  assert.equal(telefoneValido("12345"), false);
  assert.equal(telefoneValido(""), false);
  assert.equal(telefoneValido(null), false);
});

test("normalizar e-mail tira espaço e caixa alta", () => {
  assert.equal(normalizarEmail("  Victor@GetFixfy.COM "), "victor@getfixfy.com");
  assert.equal(normalizarEmail("sem arroba"), null);
});
