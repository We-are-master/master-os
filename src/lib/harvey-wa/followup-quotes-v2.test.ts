import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  chaveDaCobranca, horasAteFechar, rejeitarQuoteDoTicket, intervencaoManual, lembretesFeitos, motivoParaPararCobranca, proximoPassoDaRegua, REGUAS, respostaPorEmail,
} from "./followup-quotes";
import { confirmarEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { bancoFalso } from "@/lib/processo/banco-falso-teste";

describe("quote chase schedule (11/11/2026): two chases, closes on day 4", () => {
  for (const tipo of ["conta", "fixfy"] as const) {
    it(`${tipo}: chases at 24h and 48h, closes 48h after the second (day 4)`, () => {
      assert.deepEqual(REGUAS[tipo], { lembretes: [24, 48], fecha: 96 });
      assert.equal(horasAteFechar(tipo), 48);
      assert.equal(proximoPassoDaRegua([], 0, 23, REGUAS[tipo]), null);
      assert.equal(proximoPassoDaRegua([], 0, 24, REGUAS[tipo]), 1);
      assert.equal(proximoPassoDaRegua([], 1, 23, REGUAS[tipo]), null);
      assert.equal(proximoPassoDaRegua([], 1, 24, REGUAS[tipo]), 2);
      assert.equal(proximoPassoDaRegua([], 2, 47, REGUAS[tipo]), null);
      assert.equal(proximoPassoDaRegua([], 2, 48, REGUAS[tipo]), "fechar");
    });
  }
  it("never a third chase; tickets from the old three-chase schedule only close", () => {
    assert.equal(proximoPassoDaRegua([], 3, 500, REGUAS.fixfy), "fechar");
    assert.equal(proximoPassoDaRegua(["quote_chase_2"], 2, 10, REGUAS.conta), null);
    assert.equal(proximoPassoDaRegua(["quote_chase_2"], 2, 48, REGUAS.conta), "fechar");
    assert.equal(proximoPassoDaRegua(["quote_closed_no_reply"], 3, 500, REGUAS.fixfy), null);
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

describe("closing the ticket closes the OS quote (bug 09/11: mirror reopened QT-1275/1276/1278)", () => {
  const base = { external_source: "zendesk", external_ref: "52083", deleted_at: null, customer_accepted: false, customer_deposit_paid: false };
  it("rejects the open quote of the ticket and leaves accepted ones alone", async () => {
    const { sb, tabelas } = bancoFalso({
      quotes: [
        { ...base, id: "a", reference: "QT-1", status: "awaiting_customer" },
        { ...base, id: "b", reference: "QT-2", status: "awaiting_payment" },
        { ...base, id: "c", reference: "QT-3", status: "converted_to_job" },
        { ...base, id: "d", reference: "QT-4", status: "awaiting_customer", external_ref: "99999" },
      ],
    });
    assert.equal(await rejeitarQuoteDoTicket(sb, 52083, "no_reply"), "QT-1");
    const st = Object.fromEntries(tabelas.quotes!.map((q) => [q.id, q.status]));
    assert.deepEqual(st, { a: "rejected", b: "awaiting_payment", c: "converted_to_job", d: "awaiting_customer" });
    assert.equal(tabelas.quotes!.find((q) => q.id === "a")!.rejection_reason, "auto_close:no_reply");
  });
  it("no quote on the ticket: nothing to do, never throws", async () => {
    const { sb } = bancoFalso({ quotes: [] });
    assert.equal(await rejeitarQuoteDoTicket(sb, 1, "no_reply"), null);
  });
});
