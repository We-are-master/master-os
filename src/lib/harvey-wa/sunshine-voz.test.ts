import { test } from "node:test";
import assert from "node:assert/strict";
import { ehOHarveyNoNomeDele, type MensagemSc } from "./sunshine";

const msg = (displayName: string | undefined, harvey = true): MensagemSc => ({
  id: "m", received: "2026-10-15T18:49:13Z", author: { type: "business", displayName }, content: { type: "text", text: "oi" }, metadata: harvey ? { harvey: true } : {},
});

test("o Harvey no nome dele conta como Harvey passando a vez", () => {
  assert.equal(ehOHarveyNoNomeDele(msg("Harvey")), true);
  assert.equal(ehOHarveyNoNomeDele(msg(undefined)), true);
});

test("mensagem da equipe pelo canal do Harvey não conta (Fixfy Team, 15/10/2026)", () => {
  assert.equal(ehOHarveyNoNomeDele(msg("Fixfy Team")), false);
  assert.equal(ehOHarveyNoNomeDele(msg("Leonardo Piovesan")), false);
  assert.equal(ehOHarveyNoNomeDele(msg("Leonardo Piovesan", false)), false);
});
