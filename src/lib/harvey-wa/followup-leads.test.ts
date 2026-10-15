import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { destinoDoLead, ehDaReguaAntiga, emailDoPasso, notaDoPedidoExistente, passosFeitos, proximoPasso, type PedidoDoOs } from "./followup-leads";

// Horários em BST (UTC+1): "2026-10-14T09:00:00Z" é 10h em Londres.
const d = (iso: string) => new Date(iso);

describe("régua do follow-up de lead", () => {
  it("conta os passos pelas tags", () => {
    assert.equal(passosFeitos([], false), 0);
    assert.equal(passosFeitos([], true), 1);
    assert.equal(passosFeitos(["lead_checkin_sent"], false), 1);
    assert.equal(passosFeitos(["lead_fu_1", "lead_fu_3"], false), 3);
  });

  it("dia 1: WhatsApp de check-in às 18h, com 4h de folga", () => {
    const primeiro = d("2026-10-14T08:00:00Z");
    assert.equal(proximoPasso(0, primeiro, primeiro, d("2026-10-14T15:59:00Z")), null);
    assert.equal(proximoPasso(0, primeiro, primeiro, d("2026-10-14T17:00:00Z")), 1);
  });

  it("lead que chega às 19h leva o check-in no dia seguinte às 18h", () => {
    const primeiro = d("2026-10-14T18:00:00Z");
    assert.equal(proximoPasso(0, primeiro, primeiro, d("2026-10-14T19:00:00Z")), null);
    assert.equal(proximoPasso(0, primeiro, primeiro, d("2026-10-15T16:00:00Z")), null);
    assert.equal(proximoPasso(0, primeiro, primeiro, d("2026-10-15T17:00:00Z")), 1);
  });

  it("dia 2: e-mail às 10h e às 16h", () => {
    const primeiro = d("2026-10-14T08:00:00Z");
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T17:00:00Z"), d("2026-10-14T19:30:00Z")), null);
    assert.equal(proximoPasso(1, primeiro, d("2026-10-14T17:00:00Z"), d("2026-10-15T09:00:00Z")), 2);
    assert.equal(proximoPasso(2, primeiro, d("2026-10-15T09:00:00Z"), d("2026-10-15T14:00:00Z")), null);
    assert.equal(proximoPasso(2, primeiro, d("2026-10-15T09:00:00Z"), d("2026-10-15T15:00:00Z")), 3);
  });

  it("dia 3: e-mail às 10h, WhatsApp final às 18h e fecha", () => {
    const primeiro = d("2026-10-14T08:00:00Z");
    assert.equal(proximoPasso(3, primeiro, d("2026-10-15T15:00:00Z"), d("2026-10-15T19:30:00Z")), null);
    assert.equal(proximoPasso(3, primeiro, d("2026-10-15T15:00:00Z"), d("2026-10-16T09:00:00Z")), 4);
    assert.equal(proximoPasso(4, primeiro, d("2026-10-16T09:00:00Z"), d("2026-10-16T16:00:00Z")), null);
    assert.equal(proximoPasso(4, primeiro, d("2026-10-16T09:00:00Z"), d("2026-10-16T17:00:00Z")), 5);
    assert.equal(proximoPasso(5, primeiro, d("2026-10-16T17:00:00Z"), d("2026-10-17T17:00:00Z")), null);
  });

  it("lead de antes da régua entra como dia 2", () => {
    assert.equal(ehDaReguaAntiga(d("2026-10-12T08:00:00Z"), ["lead_checkin_sent", "lead_call"]), true);
    assert.equal(ehDaReguaAntiga(d("2026-10-12T08:00:00Z"), ["lead_fu_3"]), false);
    assert.equal(ehDaReguaAntiga(d("2026-10-14T08:00:00Z"), []), false);
    const vespera = d("2026-10-13T12:00:00Z");
    assert.equal(proximoPasso(1, vespera, vespera, d("2026-10-14T09:00:00Z")), 2);
  });

  it("os três e-mails não têm travessão e fecham com Thank you (a assinatura é a do Leo)", () => {
    for (const p of [2, 3, 4]) {
      const t = emailDoPasso(p, "Ann", "handyman work");
      assert.ok(!t.includes("—"), `passo ${p}`);
      assert.ok(t.startsWith("Hi Ann,") && t.endsWith("Thank you,") && !t.includes("Fixfy Team"), `passo ${p}`);
      assert.ok(t.split("\n").length > 5, `passo ${p}`);
    }
  });
});

describe("trava: lead que já tem pedido no OS", () => {
  const primeiro = new Date("2026-10-14T09:00:00Z");
  const p = (o: Partial<PedidoDoOs>): PedidoDoOs => ({ reference: "JOB-1", status: "scheduled", ticketId: null, criadoEm: "2026-10-14T12:00:00Z", ...o });

  it("sem job nem quote, segue a régua", () => {
    assert.deepEqual(destinoDoLead({ jobs: [], quotes: [], primeiro, ticketDoLead: 10 }), { acao: "seguir" });
  });

  it("job vivo vence quote aberta", () => {
    const d = destinoDoLead({ jobs: [p({ ticketId: "20" })], quotes: [p({ reference: "QT-1", status: "bidding" })], primeiro, ticketDoLead: 10 });
    assert.equal(d.acao, "job");
    assert.equal(d.acao === "job" && d.mesmoTicket, false);
  });

  it("job cancelado ou antigo não conta", () => {
    assert.equal(destinoDoLead({ jobs: [p({ status: "cancelled" })], quotes: [], primeiro, ticketDoLead: 10 }).acao, "seguir");
    assert.equal(destinoDoLead({ jobs: [p({ criadoEm: "2026-08-01T12:00:00Z" })], quotes: [], primeiro, ticketDoLead: 10 }).acao, "seguir");
  });

  it("quote aberta leva o status dela; rejeitada não conta", () => {
    const d = destinoDoLead({ jobs: [], quotes: [p({ reference: "QT-2", status: "awaiting_customer", ticketId: "10" })], primeiro, ticketDoLead: 10 });
    assert.equal(d.acao, "quote");
    if (d.acao === "quote") {
      assert.equal(d.statusId, 5688280626847);
      assert.equal(d.mesmoTicket, true);
    }
    assert.equal(destinoDoLead({ jobs: [], quotes: [p({ status: "rejected" })], primeiro, ticketDoLead: 10 }).acao, "seguir");
    const b = destinoDoLead({ jobs: [], quotes: [p({ status: "bidding" })], primeiro, ticketDoLead: 10 });
    assert.equal(b.acao === "quote" && b.statusId, 5688282472223);
  });

  it("a nota aponta o job e não promete nada ao cliente", () => {
    const d = destinoDoLead({ jobs: [p({ reference: "JOB-9", ticketId: "55" })], quotes: [], primeiro, ticketDoLead: 10 });
    assert.notEqual(d.acao, "seguir");
    if (d.acao !== "seguir") {
      const n = notaDoPedidoExistente(d, (id) => `https://x.zendesk.com/agent/tickets/${id}`);
      assert.match(n, /JOB-9/);
      assert.match(n, /agent\/tickets\/55/);
      assert.match(n, /duplicate/);
      assert.match(n, /Nothing was sent to the customer/);
    }
  });
});
