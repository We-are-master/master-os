import { test } from "node:test";
import assert from "node:assert/strict";
import { alvoDoTicketDoLead, etapaDeEntrada, hojeEmLondres, leadDoTicket, nurtureIdDoAmbiente, pessoaDoAssunto, sinalDeResposta, tagDaEtapa, tagsDoLead } from "./espelho-leads";
import {
  ZD_STATUS_AWAITING_APPROVAL,
  ZD_STATUS_BIDDING,
  ZD_STATUS_COMPLAINT,
  ZD_STATUS_DEPOSIT_PENDING,
  ZD_STATUS_LEAD,
  ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_NEW,
  ZD_STATUS_OPEN,
  ZD_STATUS_SCHEDULED,
  ZD_STATUS_TO_CALL,
} from "@/lib/zendesk-statuses";

const NURTURE = 999;
const aberto = (customStatusId: number | null, extra: Partial<Parameters<typeof alvoDoTicketDoLead>[1]> = {}) => ({ status: "open", customStatusId, ...extra });

test("tag crm_* é uma só, a da etapa", () => {
  assert.equal(tagDaEtapa("quoted"), "crm_quoted");
  assert.deepEqual(tagsDoLead("qualifying", ["customer", "crm_new"]), { add: ["crm_qualifying"], remove: ["crm_new"] });
  assert.deepEqual(tagsDoLead("qualifying", ["crm_qualifying", "harvey_wa"]), { add: [], remove: [] });
  assert.deepEqual(tagsDoLead("lost", ["crm_new", "crm_qualifying"]), { add: ["crm_lost"], remove: ["crm_new", "crm_qualifying"] });
});

test("New lead e Qualifying: ticket livre vira Lead; sub-etapas do Harvey ficam", () => {
  assert.deepEqual(alvoDoTicketDoLead({ stage: "new" }, aberto(ZD_STATUS_NEW), null), { kind: "status", customStatusId: ZD_STATUS_LEAD });
  assert.deepEqual(alvoDoTicketDoLead({ stage: "qualifying" }, aberto(ZD_STATUS_OPEN), null), { kind: "status", customStatusId: ZD_STATUS_LEAD });
  assert.deepEqual(alvoDoTicketDoLead({ stage: "qualifying" }, aberto(null), null), { kind: "status", customStatusId: ZD_STATUS_LEAD });
  for (const s of [ZD_STATUS_LEAD, ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_AWAITING_APPROVAL]) {
    assert.equal(alvoDoTicketDoLead({ stage: "qualifying" }, aberto(s), null).kind, "nada");
  }
});

test("etapas de preço sem quote no ticket", () => {
  assert.deepEqual(alvoDoTicketDoLead({ stage: "quoting" }, aberto(ZD_STATUS_LEAD), null), { kind: "status", customStatusId: ZD_STATUS_NEEDS_QUOTE });
  assert.equal(alvoDoTicketDoLead({ stage: "quoting" }, aberto(ZD_STATUS_BIDDING), null).kind, "nada");
  assert.deepEqual(alvoDoTicketDoLead({ stage: "quoted" }, aberto(ZD_STATUS_LEAD), null), { kind: "status", customStatusId: ZD_STATUS_AWAITING_APPROVAL });
  // Awaiting deposit também é Quoted: não volta para Awaiting approval.
  assert.equal(alvoDoTicketDoLead({ stage: "quoted" }, aberto(ZD_STATUS_DEPOSIT_PENDING), null).kind, "nada");
  // Qualified = vez do closer: To Call até existir Qualified no Zendesk.
  assert.deepEqual(alvoDoTicketDoLead({ stage: "qualified" }, aberto(ZD_STATUS_LEAD), null), { kind: "status", customStatusId: ZD_STATUS_TO_CALL });
});

test("fora do funil de venda o lead não mexe", () => {
  assert.equal(alvoDoTicketDoLead({ stage: "qualifying" }, aberto(ZD_STATUS_COMPLAINT), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "qualifying" }, aberto(ZD_STATUS_SCHEDULED), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "lost", lostReason: "price" }, aberto(ZD_STATUS_SCHEDULED), null).kind, "nada");
});

test("Won é do espelho do job; closed e Harvey segurando ficam", () => {
  assert.equal(alvoDoTicketDoLead({ stage: "won" }, aberto(ZD_STATUS_LEAD), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "qualifying" }, { status: "closed", customStatusId: ZD_STATUS_LEAD }, null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "new" }, aberto(ZD_STATUS_NEW, { supportType: "ai_agent" }), null).kind, "nada");
});

test("Lost resolve, mas nunca com o cliente esperando", () => {
  const r = alvoDoTicketDoLead({ stage: "lost", lostReason: "no_reply" }, aberto(ZD_STATUS_LEAD), null);
  assert.equal(r.kind, "solved");
  if (r.kind === "solved") {
    assert.equal(r.resolucao, "res_no_response");
    assert.match(r.resumo, /no reply/);
  }
  const p = alvoDoTicketDoLead({ stage: "lost", lostReason: "price" }, aberto(ZD_STATUS_LEAD), null);
  assert.equal(p.kind === "solved" && p.resolucao, "res_cancelled");
  assert.equal(alvoDoTicketDoLead({ stage: "lost", lostReason: "price" }, aberto(ZD_STATUS_LEAD, { replyStatus: "reply_awaiting" }), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "lost" }, { status: "solved", customStatusId: null }, null).kind, "nada");
});

test("ticket resolvido com lead vivo não reabre sozinho", () => {
  assert.equal(alvoDoTicketDoLead({ stage: "qualifying" }, { status: "solved", customStatusId: null }, null).kind, "nada");
});

test("Lost com data de volta não resolve: vai para Nurture se o status existir", () => {
  const volta = { stage: "lost" as const, lostReason: "timing" as const, nurtureUntil: "2026-11-20" };
  assert.equal(alvoDoTicketDoLead(volta, aberto(ZD_STATUS_LEAD), null).kind, "nada");
  assert.deepEqual(alvoDoTicketDoLead(volta, aberto(ZD_STATUS_LEAD), NURTURE), { kind: "status", customStatusId: NURTURE });
  assert.equal(alvoDoTicketDoLead(volta, aberto(NURTURE), NURTURE).kind, "nada");
  // Voltou: o ticket sai do Nurture para Lead.
  assert.deepEqual(alvoDoTicketDoLead({ stage: "qualifying" }, aberto(NURTURE), NURTURE), { kind: "status", customStatusId: ZD_STATUS_LEAD });
});

test("sinal de resposta pelo Reply Status", () => {
  assert.equal(sinalDeResposta("reply_awaiting", null), "cliente");
  assert.equal(sinalDeResposta("reply_awaiting", "2026-11-05T10:00:00Z"), null);
  assert.equal(sinalDeResposta("reply_replied", "2026-11-05T10:00:00Z"), "nossa");
  assert.equal(sinalDeResposta("reply_replied", null), null);
  assert.equal(sinalDeResposta(null, null), null);
});

test("id do Nurture e data de Londres", () => {
  assert.equal(nurtureIdDoAmbiente(undefined), null);
  assert.equal(nurtureIdDoAmbiente(" "), null);
  assert.equal(nurtureIdDoAmbiente("abc"), null);
  assert.equal(nurtureIdDoAmbiente("6500000000001"), 6500000000001);
  assert.equal(hojeEmLondres(new Date("2026-11-05T23:30:00Z")), "2026-11-05");
  assert.equal(hojeEmLondres(new Date("2026-07-05T23:30:00Z")), "2026-07-06");
});

test("entrada pelo Zendesk: coluna pelo status", () => {
  assert.equal(etapaDeEntrada(ZD_STATUS_LEAD), "new");
  assert.equal(etapaDeEntrada(ZD_STATUS_TO_CALL), "qualified");
  assert.equal(etapaDeEntrada(ZD_STATUS_NEEDS_QUOTE), "quoting");
  assert.equal(etapaDeEntrada(ZD_STATUS_BIDDING), null);
  assert.equal(etapaDeEntrada(null), null);
});

test("lead do ticket: e-mail da equipe não vira cliente", () => {
  const l = leadDoTicket({ id: 1, subject: "Leaking tap", customStatusId: ZD_STATUS_LEAD }, { name: "Fixfy Team", email: "team@getfixfy.com" });
  assert.ok(l);
  assert.equal(l!.email, null);
  assert.equal(l!.stage, "new");
  assert.equal(l!.external_ref, "1");
  assert.equal(l!.scope, "Leaking tap.");
  assert.equal(leadDoTicket({ id: 2, customStatusId: ZD_STATUS_BIDDING }, null), null);
});

test("nome e postcode do assunto do primeiro contato", () => {
  assert.deepEqual(pessoaDoAssunto("Lead · Handyman work · Ingrid Mills · SE4 1BQ"), { nome: "Ingrid Mills", postcode: "SE4 1BQ" });
  assert.equal(pessoaDoAssunto("Re: quote for painting"), null);
  assert.equal(pessoaDoAssunto("Lead · Carpentry · Emma · not a postcode"), null);
});
