import { test } from "node:test";
import assert from "node:assert/strict";
import { depoisDaResposta } from "./depois-da-resposta";

test("fora de requisição (script, launchd) roda na hora, com await", async () => {
  let rodou = false;
  await depoisDaResposta("teste", async () => { rodou = true; });
  assert.equal(rodou, true);
});

test("erro do trabalho vira log, nunca sobe para quem chamou", async () => {
  await assert.doesNotReject(depoisDaResposta("teste", async () => { throw new Error("boom"); }));
});
