import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chaveDaCobranca, intervencaoManual, lembretesFeitos, motivoParaPararCobranca, proximoPassoV2, REGUA_PADRAO, reguaDaCobranca, respostaPorEmail,
} from "./followup-quotes";
import { confirmarEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { bancoFalso } from "@/lib/processo/banco-falso-teste";

describe("quote chase v2: exactly three chases, then close", () => {
  it("default schedule is day 1, 3 and 5, close on day 7", () => {
    assert.deepEqual(reguaDaCobranca(undefined), REGUA_PADRAO);
    assert.deepEqual(REGUA_PADRAO, { lembretes: [24, 72, 120], fecha: 168 });
  });
  it("QUOTE_CHASE_HORAS changes the schedule; a broken value falls back to the default", () => {
    assert.deepEqual(reguaDaCobranca("12, 36, 60, 96"), { lembretes: [12, 36, 60], fecha: 96 });
    assert.deepEqual(reguaDaCobranca("12,36,60"), { lembretes: [12, 36, 60], fecha: 168 });
    assert.deepEqual(reguaDaCobranca("72,24,120"), REGUA_PADRAO);
    assert.deepEqual(reguaDaCobranca("abc"), REGUA_PADRAO);
  });
  it("intervals between the marks, counted from our last message", () => {
    const r = REGUA_PADRAO;
    assert.equal(proximoPassoV2([], 0, 23, r), null);
    assert.equal(proximoPassoV2([], 0, 24, r), 1);
    assert.equal(proximoPassoV2([], 1, 47, r), null);
    assert.equal(proximoPassoV2([], 1, 48, r), 2);
    assert.equal(proximoPassoV2([], 2, 48, r), 3);
    assert.equal(proximoPassoV2([], 3, 47, r), null);
    assert.equal(proximoPassoV2([], 3, 48, r), "fechar");
  });
  it("never a fourth chase, and closed tickets are left alone", () => {
    assert.equal(proximoPassoV2([], 3, 500, REGUA_PADRAO), "fechar");
    assert.equal(proximoPassoV2(["quote_closed_no_reply"], 3, 500, REGUA_PADRAO), null);
  });
  it("chases done = the larger of tags and confirmed sends (tag lost after a send)", () => {
    assert.equal(lembretesFeitos([], []), 0);
    assert.equal(lembretesFeitos(["quote_chase_1"], [2]), 2);
    assert.equal(lembretesFeitos(["quote_chase_3"], [1]), 3);
  });
});

describe("quote chase v2: stops before each send", () => {
  const aberta = { id: "q1", status: "awaiting_customer", customer_accepted: false, customer_deposit_paid: false };
  it("keeps going while the quote waits for the customer", () => assert.equal(motivoParaPararCobranca(aberta), null));
  it("stops on acceptance", () => {
    assert.match(motivoParaPararCobranca({ ...aberta, customer_accepted: true })!, /accepted/);
    assert.match(motivoParaPararCobranca({ ...aberta, status: "awaiting_payment" })!, /accepted/);
    assert.match(motivoParaPararCobranca({ ...aberta, status: "converted_to_job" })!, /job/);
  });
  it("stops on payment and on rejection", () => {
    assert.match(motivoParaPararCobranca({ ...aberta, customer_deposit_paid: true })!, /paid/);
    assert.match(motivoParaPararCobranca({ ...aberta, status: "rejected" })!, /rejected/);
    assert.match(motivoParaPararCobranca(null)!, /not found/);
  });
  it("stops on a manual reply by the team after the last chase", () => {
    const ultimo = "2026-10-21T10:00:00Z";
    const cliente = 1;
    const chaseNoTicket = { public: true, author_id: 9, created_at: "2026-10-21T09:59:58Z", body: "chase", via: { channel: "api" } };
    assert.equal(intervencaoManual([chaseNoTicket], ultimo, cliente), false);
    assert.equal(intervencaoManual([{ public: true, author_id: 9, created_at: "2026-10-21T15:00:00Z", body: "Hi, just called you", via: { channel: "web" } }], ultimo, cliente), true);
    // Customer replies, internal notes and WhatsApp mirror comments are not the team stepping in.
    assert.equal(intervencaoManual([{ public: true, author_id: cliente, created_at: "2026-10-21T15:00:00Z", via: { channel: "email" } }], ultimo, cliente), false);
    assert.equal(intervencaoManual([{ public: false, author_id: 9, created_at: "2026-10-21T15:00:00Z", via: { channel: "web" } }], ultimo, cliente), false);
    assert.equal(intervencaoManual([{ public: true, author_id: 9, created_at: "2026-10-21T15:00:00Z", via: { channel: "native_messaging" } }], ultimo, cliente), false);
    // No chase yet: nothing to compare with.
    assert.equal(intervencaoManual([{ public: true, author_id: 9, created_at: "2026-10-21T15:00:00Z", via: { channel: "web" } }], null, cliente), false);
  });
  it("a customer email reply marks the email channel", () => {
    assert.equal(respostaPorEmail({ public: true, author_id: 1, via: { channel: "email" } }, 1), true);
    assert.equal(respostaPorEmail({ public: true, author_id: 1, via: { channel: "native_messaging" } }, 1), false);
    assert.equal(respostaPorEmail({ public: true, author_id: 2, via: { channel: "email" } }, 1), false);
  });
});

describe("quote chase v2: reserve before sending", () => {
  it("the same chase is reserved once; after it was sent, never again", async () => {
    const { sb } = bancoFalso();
    const chave = chaveDaCobranca("q1", 2);
    assert.equal(chave, "quote-chase:q1:2");
    const pedido = { chave, finalidade: "quote-chase-2", canal: "email" as const, quoteId: "q1" };
    assert.equal((await reservarEnvio(sb, pedido)).reservado, true);
    assert.equal((await reservarEnvio(sb, pedido)).reservado, false);
    await confirmarEnvio(sb, chave);
    const depois = await reservarEnvio(sb, pedido, new Date(Date.now() + 3 * 3_600_000));
    assert.equal(depois.reservado, false);
    assert.equal(depois.motivo, "already sent");
  });
});
