import { test } from "node:test";
import assert from "node:assert/strict";
import { quoteStatusToZendesk } from "./zendesk-status-sync";
import { ZD_STATUS_QUOTE_READY, ZD_STATUS_BIDDING, ZD_STATUS_AWAITING_APPROVAL } from "./zendesk-statuses";

test("quote_ready leva o ticket ao status que entra no Action Required", () => {
  assert.equal(quoteStatusToZendesk("quote_ready"), ZD_STATUS_QUOTE_READY);
});

test("draft nao fala mais com o ticket", () => {
  // Apontava para o id que hoje significa "Quote Ready". Depois do rename isso
  // seria dizer "preço pronto" sobre um rascunho que ninguém abriu.
  assert.equal(quoteStatusToZendesk("draft"), null);
});

test("os vizinhos nao mudaram", () => {
  assert.equal(quoteStatusToZendesk("bidding"), ZD_STATUS_BIDDING);
  assert.equal(quoteStatusToZendesk("in_survey"), ZD_STATUS_BIDDING);
  assert.equal(quoteStatusToZendesk("awaiting_customer"), ZD_STATUS_AWAITING_APPROVAL);
  assert.equal(quoteStatusToZendesk("awaiting_payment"), ZD_STATUS_AWAITING_APPROVAL);
});

test("converted_to_job continua entregando o ticket ao job", () => {
  assert.equal(quoteStatusToZendesk("converted_to_job"), null);
});
