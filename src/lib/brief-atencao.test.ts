import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { idade, linhaDoItem, linhaDoPendente, montarSecaoAtencaoHtml, oQuePrecisaDoTicket, pendentesDeOntem, semRepetidos, type ItemDeAtencao, type PendenteDoDiario } from "./brief-atencao";

const agora = new Date("2026-10-15T07:00:00Z"); // 08:00 em Londres (BST)
const item = (o: Partial<ItemDeAtencao>): ItemDeAtencao => ({ fonte: "action_required", ticketId: 100, cliente: "Jane Doe", oQuePrecisa: "Customer is waiting for a reply", desde: "2026-10-13T07:00:00Z", ...o });
const diario = (o: Partial<PendenteDoDiario>): PendenteDoDiario => ({ criado_em: "2026-10-14T12:00:00Z", origem: "whatsapp", ticket_id: 51000, quote_ref: null, job_ref: null, decisao: "Handed the WhatsApp chat to the team: no capacity", pendente: "Team: find a slot", resolvido_em: null, ...o });

describe("brief: where you need to step in", () => {
  it("age is short and readable", () => {
    assert.equal(idade("2026-10-15T06:58:00Z", agora), "just now");
    assert.equal(idade("2026-10-15T06:15:00Z", agora), "45m");
    assert.equal(idade("2026-10-15T02:00:00Z", agora), "5h");
    assert.equal(idade("2026-10-12T07:00:00Z", agora), "3d");
    assert.equal(idade(null, agora), "?");
    assert.equal(idade("not a date", agora), "?");
  });

  it("one line per ticket: id, customer, what is needed, age", () => {
    assert.equal(linhaDoItem(item({}), agora), "#100 · Jane Doe · Customer is waiting for a reply · 2d");
    assert.equal(linhaDoItem(item({ fonte: "quote_ready", ticketId: null, ref: "QT-2026-1200", cliente: null }), agora), "QT-2026-1200 · Unknown customer · Customer is waiting for a reply · 2d");
    assert.equal(linhaDoItem(item({ ref: "JOB-9" }), agora), "#100 · JOB-9 · Jane Doe · Customer is waiting for a reply · 2d");
  });

  it("what is needed carries the subject, cut at 90 chars", () => {
    assert.equal(oQuePrecisaDoTicket("quoting", "Boiler service · SW1"), "Waiting on bids or a price: Boiler service · SW1");
    assert.equal(oQuePrecisaDoTicket("needs_attention", "  "), "On hold, needs a decision");
    assert.ok(oQuePrecisaDoTicket("action_required", "x".repeat(200)).endsWith("…"));
  });

  it("a ticket in two lists shows once, the most urgent list wins", () => {
    const r = semRepetidos([item({ fonte: "quoting", ticketId: 7 }), item({ fonte: "quote_ready", ticketId: 7, ref: "QT-1" }), item({ fonte: "action_required", ticketId: 7 }), item({ fonte: "quote_ready", ticketId: null, ref: "QT-2" })]);
    assert.deepEqual(r.map((i) => i.fonte), ["action_required", "quote_ready"]);
    assert.equal(r[1].ref, "QT-2");
  });

  it("Harvey's open items are only yesterday's (London), unresolved and with something pending", () => {
    const linhas = [
      diario({ criado_em: "2026-10-13T23:30:00Z" }), // 14/10 00:30 em Londres: ontem
      diario({ criado_em: "2026-10-14T22:59:00Z" }), // 14/10 23:59 em Londres: ontem
      diario({ criado_em: "2026-10-14T23:01:00Z" }), // 15/10 00:01: hoje
      diario({ criado_em: "2026-10-13T22:00:00Z" }), // 13/10 23:00: anteontem
      diario({ pendente: null }),
      diario({ resolvido_em: "2026-10-14T15:00:00Z" }),
    ];
    assert.deepEqual(pendentesDeOntem(linhas, agora).map((l) => l.criado_em), ["2026-10-13T23:30:00Z", "2026-10-14T22:59:00Z"]);
    assert.equal(linhaDoPendente(diario({ quote_ref: "QT-2026-1" })), "#51000 QT-2026-1 · Handed the WhatsApp chat to the team: no capacity · Open: Team: find a slot");
  });

  it("html groups by list, escapes text and caps long lists", () => {
    const muitos = Array.from({ length: 4 }, (_, i) => item({ ticketId: 200 + i, cliente: i === 0 ? "<b>Tom & Co</b>" : "X" }));
    const html = montarSecaoAtencaoHtml({ itens: [...muitos, item({ fonte: "complaint", ticketId: 300, ref: "JOB-1" })], pendentes: [diario({})], agora, limitePorGrupo: 2 });
    assert.match(html, /Where you need to step in/);
    assert.match(html, /Action Required \(4\)/);
    assert.match(html, /and 2 more/);
    assert.match(html, /Jobs on hold with a complaint \(1\)/);
    assert.match(html, /Left open by Harvey yesterday \(1\)/);
    assert.match(html, /&lt;b&gt;Tom &amp; Co&lt;\/b&gt;/);
    assert.ok(html.indexOf("Action Required") < html.indexOf("Jobs on hold"));
    assert.doesNotMatch(html, /—/);
  });

  it("empty lists say so, and failed sources are named", () => {
    assert.match(montarSecaoAtencaoHtml({ itens: [], pendentes: [], agora }), /Nothing needs you this morning\./);
    const html = montarSecaoAtencaoHtml({ itens: [], pendentes: [], agora, falhas: ["Zendesk quoting"] });
    assert.doesNotMatch(html, /Nothing needs you/);
    assert.match(html, /Could not read: Zendesk quoting/);
  });
});
