import { test } from "node:test";
import assert from "node:assert/strict";
import { devolvidaEm, ehDaEquipe, equipeDonaDaConversa, horasDaEquipeDona, motivoDaDevolucao } from "./equipe-dona";
import type { MensagemSc } from "./sunshine";

const AGORA = Date.parse("2026-10-15T15:00:00Z");
const ha = (min: number) => new Date(AGORA - min * 60_000).toISOString();
const cliente = (min: number): MensagemSc => ({ id: `c${min}`, received: ha(min), author: { type: "user", userId: "u" }, content: { type: "text", text: "ok" } });
const negocio = (min: number, displayName: string | undefined, metadata?: Record<string, unknown>): MensagemSc => ({
  id: `b${min}`, received: ha(min), author: { type: "business", displayName }, content: { type: "text", text: "£80" }, metadata,
});

test("pessoa da equipe escreveu há 20 min: a conversa é dela", () => {
  const r = equipeDonaDaConversa([cliente(30), negocio(20, "Ana Silva"), cliente(1)], AGORA, 3);
  assert.equal(r.dona, true);
  if (r.dona) {
    assert.equal(r.quem, "Ana Silva");
    assert.equal(r.liberaEm, new Date(Date.parse(ha(20)) + 3 * 3_600_000).toISOString());
  }
});

test("depois de N horas sem a equipe, o Harvey volta", () => {
  assert.equal(equipeDonaDaConversa([negocio(181, "Ana Silva"), cliente(1)], AGORA, 3).dona, false);
  assert.equal(equipeDonaDaConversa([negocio(179, "Ana Silva"), cliente(1)], AGORA, 3).dona, true);
});

test("vale a última mensagem da equipe, de qualquer pessoa", () => {
  const r = equipeDonaDaConversa([negocio(300, "Ana Silva"), negocio(10, "Bruno Costa"), cliente(1)], AGORA, 3);
  assert.equal(r.dona && r.quem, "Bruno Costa");
});

test("o Harvey no nome de alguém da equipe não conta", () => {
  assert.equal(equipeDonaDaConversa([negocio(10, "Ana Silva", { harvey: true }), cliente(1)], AGORA, 3).dona, false);
  assert.equal(equipeDonaDaConversa([negocio(10, "Harvey"), cliente(1)], AGORA, 3).dona, false);
  assert.equal(equipeDonaDaConversa([negocio(10, "Fixfy Team", { harvey: true }), cliente(1)], AGORA, 3).dona, false);
});

test("template de automação (sem nome ou com origem) não conta", () => {
  assert.equal(ehDaEquipe(negocio(10, undefined, { origem: "quote_chase" })), false);
  assert.equal(ehDaEquipe(negocio(10, "Fixfy", { origem: "auto_quote" })), false);
  assert.equal(ehDaEquipe(negocio(10, undefined)), false);
  assert.equal(ehDaEquipe(cliente(10)), false);
  assert.equal(ehDaEquipe(negocio(10, "Ana Silva")), true);
});

test("Harvey depois da equipe não tira a posse dela", () => {
  assert.equal(equipeDonaDaConversa([negocio(30, "Ana Silva"), negocio(20, "Ana Silva", { harvey: true }), cliente(1)], AGORA, 3).dona, true);
});

test("0 horas desliga; data ilegível não trava", () => {
  assert.equal(equipeDonaDaConversa([negocio(10, "Ana Silva")], AGORA, 0).dona, false);
  assert.equal(equipeDonaDaConversa([{ ...negocio(10, "Ana Silva"), received: "" }], AGORA, 3).dona, false);
});

test("HARVEY_WA_EQUIPE_DONA_HORAS: padrão 3", () => {
  assert.equal(horasDaEquipeDona(undefined), 3);
  assert.equal(horasDaEquipeDona(""), 3);
  assert.equal(horasDaEquipeDona("abc"), 3);
  assert.equal(horasDaEquipeDona("1.5"), 1.5);
  assert.equal(horasDaEquipeDona("0"), 0);
});

test("Give back por uma pessoa: o que a equipe escreveu antes não trava", () => {
  const motivo = motivoDaDevolucao("Ana Silva", new Date(ha(5)));
  const desde = devolvidaEm(motivo);
  assert.equal(desde, Date.parse(ha(5)));
  const msgs = [negocio(20, "Ana Silva"), cliente(1)];
  assert.equal(equipeDonaDaConversa(msgs, AGORA, 3, desde).dona, false);
  // A equipe escreveu de novo depois da devolução: volta a valer.
  assert.equal(equipeDonaDaConversa([...msgs, negocio(2, "Ana Silva")], AGORA, 3, desde).dona, true);
  assert.equal(devolvidaEm(null), null);
  assert.equal(devolvidaEm("Ana took over"), null);
});
