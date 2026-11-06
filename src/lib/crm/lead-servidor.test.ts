import { test } from "node:test";
import assert from "node:assert/strict";
import { alvoPelasQuotes, etapaPelasQuotes } from "./lead-servidor";

test("a quote mais avançada vence; todas recusadas, Lost", () => {
  assert.equal(etapaPelasQuotes([]), null);
  assert.equal(etapaPelasQuotes(["draft", "awaiting_customer"]), "quoted");
  assert.equal(etapaPelasQuotes(["rejected", "bidding"]), "quoting");
  assert.equal(etapaPelasQuotes(["rejected"]), "lost");
});

test("aceite com entrada cria o job antes do pagamento: ainda é Accepted", () => {
  assert.deepEqual(alvoPelasQuotes([{ status: "awaiting_payment", jobId: "j1" }], null), { stage: "quoted", jobId: null });
});

test("Won: quote convertida com job, ou job já no lead", () => {
  assert.deepEqual(alvoPelasQuotes([{ status: "converted_to_job", jobId: "j1" }], null), { stage: "won", jobId: "j1" });
  assert.deepEqual(alvoPelasQuotes([{ status: "quote_ready", jobId: "j2" }], null), { stage: "won", jobId: "j2" });
  assert.deepEqual(alvoPelasQuotes([{ status: "bidding" }], "j9"), { stage: "won", jobId: "j9" });
});

test("convertida sem job achado fica em Accepted; job de quote recusada não conta", () => {
  assert.deepEqual(alvoPelasQuotes([{ status: "converted_to_job", jobId: null }], null), { stage: "quoted", jobId: null });
  assert.deepEqual(alvoPelasQuotes([{ status: "rejected", jobId: "j3" }], null), { stage: "lost", jobId: null });
});

test("sem quote, a etapa é do lead", () => {
  assert.deepEqual(alvoPelasQuotes([], null), { stage: null, jobId: null });
});
