import { strict as assert } from "node:assert";
import { test } from "node:test";
import { horariosDoTesteDePonta, horariosDoQueFalta } from "./core";

// Sem WhatsApp configurado neste processo: o passo 4 só aparece quando o teste liga.
const agora = new Date("2026-09-28T13:00:00Z"); // 14:00 em Londres

test("provisório do site: E1 em 30 min, E2 e E3 às 9h30, WhatsApp às 15h quando há telefone", () => {
  process.env.WHATSAPP_TOKEN = "t";
  process.env.WHATSAPP_PHONE_NUMBER_ID = "1";
  try {
    const h = horariosDoQueFalta({ phone: "07123456789" }, agora);
    assert.deepEqual(h, {
      email1_due_at: "2026-09-28T13:30:00.000Z",
      email2_due_at: "2026-09-29T08:30:00.000Z",
      email3_due_at: "2026-09-30T08:30:00.000Z",
      whatsapp_due_at: "2026-09-30T14:00:00.000Z",
    });
    // RESERVA_ABANDONADA_WHATSAPP=off tira o passo 4
    process.env.RESERVA_ABANDONADA_WHATSAPP = "off";
    assert.equal(horariosDoQueFalta({ phone: "07123456789" }, agora).whatsapp_due_at, null);
  } finally {
    delete process.env.WHATSAPP_TOKEN;
    delete process.env.WHATSAPP_PHONE_NUMBER_ID;
    delete process.env.RESERVA_ABANDONADA_WHATSAPP;
  }
  // sem telefone (ou sem WhatsApp configurado), sem passo 4
  assert.equal(horariosDoQueFalta({ phone: null }, agora).whatsapp_due_at, null);
});

test("o que já saiu não é regravado", () => {
  const h = horariosDoQueFalta({ email1_sent_at: "2026-09-28T07:00:00.000Z" }, agora);
  assert.equal("email1_due_at" in h, false);
  // voltou ao site às 14h: o E2 conta daí
  assert.equal(h.email2_due_at, "2026-09-29T08:30:00.000Z");
});

test("teste do dono sem --rapido: só o próximo toque vence agora, o resto segue a agenda", () => {
  const c = horariosDoTesteDePonta({ email1_sent_at: "2026-09-28T07:00:00.000Z", tags: ["vip"], last_activity_at: "2026-09-28T06:00:00.000Z" }, agora, { rapido: false, doZero: false });
  assert.equal(c.email2_due_at, agora.toISOString());
  assert.equal(c.email3_due_at, "2026-09-30T08:30:00.000Z");
  assert.deepEqual(c.tags, ["vip"]);
  assert.equal(c.sequence_state, "scheduled");
  assert.equal("status" in c, false, "sem --do-zero o estado fica como está");
});

test("teste do dono com --rapido e --do-zero: etiqueta, tudo esquecido, E1 agora", () => {
  const c = horariosDoTesteDePonta(
    { email1_sent_at: "2026-09-28T07:00:00.000Z", email2_sent_at: "2026-09-29T08:30:00.000Z", replied_at: "2026-09-29T10:00:00.000Z", status: "contacted", step_reached: 3, tags: ["teste-rapido"], promo_code: "COMEBACK10" },
    agora,
    { rapido: true, doZero: true },
  );
  assert.deepEqual(c.tags, ["teste-rapido"]);
  assert.equal(c.email1_sent_at, null);
  assert.equal(c.replied_at, null);
  assert.equal(c.promo_code, null);
  assert.equal(c.status, "hot");
  assert.equal(c.email1_due_at, agora.toISOString());
  assert.equal(c.email2_due_at, agora.toISOString()); // no rápido cada passo vence logo atrás do anterior
});
