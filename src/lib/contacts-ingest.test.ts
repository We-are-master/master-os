import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { apiKeyAllowed, tagsAfterOptOut } from "@/lib/contacts-ingest";

/**
 * O lead do site entra pela porta dos leads do Checkatrade com a chave de
 * job, e quem recusou ofertas não pode receber o pós-venda.
 */
describe("apiKeyAllowed", () => {
  it("aceita qualquer uma das chaves configuradas", () => {
    assert.equal(apiKeyAllowed("lead-key", ["lead-key", "job-key"]), true);
    assert.equal(apiKeyAllowed("job-key", ["lead-key", "job-key"]), true);
  });

  it("recusa chave errada, vazia ou quando nada está configurado", () => {
    assert.equal(apiKeyAllowed("outra", ["lead-key", "job-key"]), false);
    assert.equal(apiKeyAllowed(null, ["lead-key"]), false);
    assert.equal(apiKeyAllowed("", ["", undefined]), false);
    assert.equal(apiKeyAllowed("x", [undefined, " "]), false);
  });
});

describe("tagsAfterOptOut", () => {
  it("quem recusou ganha no-marketing sem perder as outras", () => {
    assert.deepEqual(tagsAfterOptOut(["vip"], true), ["vip", "no-marketing"]);
    assert.deepEqual(tagsAfterOptOut(null, true), ["no-marketing"]);
  });

  it("não mexe quando já tem a etiqueta ou quando não recusou", () => {
    assert.equal(tagsAfterOptOut(["no-marketing"], true), null);
    assert.equal(tagsAfterOptOut(["no-marketing"], false), null);
    assert.equal(tagsAfterOptOut([], undefined), null);
  });
});
