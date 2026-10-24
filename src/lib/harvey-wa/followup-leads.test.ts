import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { acaoDoPasso, proximaNota, assuntoInterno, destinoDoLead, ehDaReguaAntiga, ehLeadParado, emailDoPasso, notaDoPedidoExistente, passosFeitos, proximoPasso, servicoDoTicketDeLead, type PedidoDoOs } from "./followup-leads";
import { montarEmail } from "./email-do-leo";

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

  it("os três e-mails seguem a copy: sem travessão, sem Lead no assunto, assinados pela equipe", () => {
    for (const p of [2, 3, 4]) {
      const e = emailDoPasso(p, "Ann", "handyman work");
      const { html, text } = montarEmail(e);
      for (const x of [e.assunto, html, text]) {
        assert.doesNotMatch(x, /[—–]/, `passo ${p}`);
        assert.doesNotMatch(x, /\{\{/, `passo ${p}`);
      }
      assert.doesNotMatch(e.assunto, /^Lead/i);
      assert.equal(e.saudacao, "Hi Ann,");
      assert.doesNotMatch(text, /The Fixfy team/);
      assert.doesNotMatch(text, /Checkatrade|same day|call-out|insured|guarantee|this week/i, `passo ${p}`);
    }
    assert.equal(emailDoPasso(2, "Ann", "handyman work").assunto, "Your handyman work enquiry · Photos for your quote");
    assert.equal(emailDoPasso(3, "Ann", "handyman work").assunto, "What to expect from your Fixfy quote");
    assert.equal(emailDoPasso(4, "Ann", "handyman work").assunto, "Do you still need help with handyman work?");
    assert.equal(emailDoPasso(2, "there", "handyman work").saudacao, "Hi there,");
  });

  it("o assunto interno de lead troca no primeiro e-mail; o serviço sai dos dois formatos", () => {
    assert.equal(assuntoInterno("Lead · Handyman work · Ann · SW2 3HT"), true);
    assert.equal(assuntoInterno("Your handyman work enquiry · Photos for your quote"), false);
    assert.equal(servicoDoTicketDeLead("Lead · Handyman work · Ann · SW2 3HT"), "handyman work");
    assert.equal(servicoDoTicketDeLead("Your handyman work enquiry · A few details to get started"), "handyman work");
    assert.equal(servicoDoTicketDeLead("Re: your quote QT-1"), null);
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

describe("ehLeadParado (lead que respondeu e sumiu)", () => {
  const agora = new Date("2026-10-22T12:00:00Z");
  const base = { id: 1, status: "pending", custom_status_id: 6417913706527, tags: ["lead_gen", "harvey_handling"], updated_at: "2026-10-14T12:00:00Z", custom_fields: [{ id: 5698641403423, value: "reply_replied" }] };
  it("fecha quem respondeu, a bola está com o cliente e está quieto há 7 dias", () => assert.equal(ehLeadParado(base, agora), true));
  it("não fecha com menos de 7 dias", () => assert.equal(ehLeadParado({ ...base, updated_at: "2026-10-17T12:00:00Z" }, agora), false));
  it("não fecha quem ainda está na régua (nunca respondeu)", () => assert.equal(ehLeadParado({ ...base, tags: ["lead_gen", "lead_fu_2"] }, agora), false));
  it("não fecha quando o cliente escreveu por último", () => assert.equal(ehLeadParado({ ...base, custom_fields: [{ id: 5698641403423, value: "reply_awaiting" }] }, agora), false));
  it("não fecha fora do status Lead", () => assert.equal(ehLeadParado({ ...base, custom_status_id: 5679178035743 }, agora), false));
  it("não fecha lead com job", () => assert.equal(ehLeadParado({ ...base, tags: [...base.tags, "lead_has_order"] }, agora), false));
});

describe("pelo canal do lead (dono, 22/10/2026)", () => {
  const ambos = { temEmail: true, temTelefone: true };
  it("lead de WhatsApp: só WhatsApp, check-in e final, mesmo tendo e-mail", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((p) => acaoDoPasso(p, "whatsapp", ambos)), ["whatsapp", "pular", "pular", "pular", "whatsapp"]);
  });
  it("lead de WhatsApp sem e-mail: só os dois WhatsApps", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((p) => acaoDoPasso(p, "whatsapp", { temEmail: false, temTelefone: true })), ["whatsapp", "pular", "pular", "pular", "whatsapp"]);
  });
  it("lead de e-mail: nenhum follow-up (só o Welcome), fecha como no response no fim", () => {
    assert.deepEqual([1, 2, 3, 4, 5].map((p) => acaoDoPasso(p, "email", ambos)), ["pular", "pular", "pular", "pular", "pular"]);
  });
  it("a nota interna diz o próximo passo do canal", () => {
    assert.equal(proximaNota(1, "whatsapp", ambos), "Next: last WhatsApp at 6pm on day 3, then solved as no response.");
    assert.equal(proximaNota(2, "whatsapp", ambos), "Next: last WhatsApp at 6pm on day 3, then solved as no response.");
    assert.equal(proximaNota(2, "email", ambos), "Next: solved as no response at 6pm on day 3.");
    assert.equal(proximaNota(4, "email", ambos), "Next: solved as no response at 6pm on day 3.");
  });
});
