import { test } from "node:test";
import assert from "node:assert/strict";
import { alvoDoTicketDoLead, hojeEmLondres, nurtureIdDoAmbiente, sinalDeResposta, tagDaEtapa, tagsDoLead } from "./espelho-leads";
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
  assert.equal(tagDaEtapa("quote_sent"), "crm_quote_sent");
  assert.deepEqual(tagsDoLead("talking", ["customer", "crm_new"]), { add: ["crm_talking"], remove: ["crm_new"] });
  assert.deepEqual(tagsDoLead("talking", ["crm_talking", "harvey_wa"]), { add: [], remove: [] });
  assert.deepEqual(tagsDoLead("lost", ["crm_new", "crm_talking"]), { add: ["crm_lost"], remove: ["crm_new", "crm_talking"] });
});

test("New e Talking: ticket livre vira Lead; sub-etapas do Harvey ficam", () => {
  assert.deepEqual(alvoDoTicketDoLead({ stage: "new" }, aberto(ZD_STATUS_NEW), null), { kind: "status", customStatusId: ZD_STATUS_LEAD });
  assert.deepEqual(alvoDoTicketDoLead({ stage: "talking" }, aberto(ZD_STATUS_OPEN), null), { kind: "status", customStatusId: ZD_STATUS_LEAD });
  assert.deepEqual(alvoDoTicketDoLead({ stage: "talking" }, aberto(null), null), { kind: "status", customStatusId: ZD_STATUS_LEAD });
  for (const s of [ZD_STATUS_LEAD, ZD_STATUS_TO_CALL, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_AWAITING_APPROVAL]) {
    assert.equal(alvoDoTicketDoLead({ stage: "talking" }, aberto(s), null).kind, "nada");
  }
});

test("etapas de preço sem quote no ticket", () => {
  assert.deepEqual(alvoDoTicketDoLead({ stage: "quoting" }, aberto(ZD_STATUS_LEAD), null), { kind: "status", customStatusId: ZD_STATUS_NEEDS_QUOTE });
  assert.equal(alvoDoTicketDoLead({ stage: "quoting" }, aberto(ZD_STATUS_BIDDING), null).kind, "nada");
  assert.deepEqual(alvoDoTicketDoLead({ stage: "quote_sent" }, aberto(ZD_STATUS_LEAD), null), { kind: "status", customStatusId: ZD_STATUS_AWAITING_APPROVAL });
  assert.deepEqual(alvoDoTicketDoLead({ stage: "accepted" }, aberto(ZD_STATUS_AWAITING_APPROVAL), null), { kind: "status", customStatusId: ZD_STATUS_DEPOSIT_PENDING });
});

test("fora do funil de venda o lead não mexe", () => {
  assert.equal(alvoDoTicketDoLead({ stage: "talking" }, aberto(ZD_STATUS_COMPLAINT), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "talking" }, aberto(ZD_STATUS_SCHEDULED), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "lost", lostReason: "price" }, aberto(ZD_STATUS_SCHEDULED), null).kind, "nada");
});

test("Won é do espelho do job; closed e Harvey segurando ficam", () => {
  assert.equal(alvoDoTicketDoLead({ stage: "won" }, aberto(ZD_STATUS_LEAD), null).kind, "nada");
  assert.equal(alvoDoTicketDoLead({ stage: "talking" }, { status: "closed", customStatusId: ZD_STATUS_LEAD }, null).kind, "nada");
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
  assert.equal(alvoDoTicketDoLead({ stage: "talking" }, { status: "solved", customStatusId: null }, null).kind, "nada");
});

test("Nurture só com o status criado no Zendesk", () => {
  assert.equal(alvoDoTicketDoLead({ stage: "nurture" }, aberto(ZD_STATUS_LEAD), null).kind, "nada");
  assert.deepEqual(alvoDoTicketDoLead({ stage: "nurture" }, aberto(ZD_STATUS_LEAD), NURTURE), { kind: "status", customStatusId: NURTURE });
  assert.equal(alvoDoTicketDoLead({ stage: "nurture" }, aberto(NURTURE), NURTURE).kind, "nada");
  // Voltou do Nurture: o ticket sai dele para Lead.
  assert.deepEqual(alvoDoTicketDoLead({ stage: "talking" }, aberto(NURTURE), NURTURE), { kind: "status", customStatusId: ZD_STATUS_LEAD });
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
