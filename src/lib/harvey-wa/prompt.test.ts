import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogoSemNotaDeCallOut, promptDoHarvey } from "./prompt";

test("o catálogo do Harvey não leva o 'no call-out fee' do site", () => {
  const txt = catalogoSemNotaDeCallOut({ fix: { note: "Tools included, no call-out fee. Materials are not included." } });
  assert.equal(txt, JSON.stringify({ fix: { note: "Materials are not included." } }));
});

test("o prompt fala do call out de £72 e nunca manda dizer 'no call out fee'", () => {
  const p = promptDoHarvey({});
  assert.match(p, /call out is £72 and covers the first hour/);
  assert.doesNotMatch(p, /tools included and no call out fee/i);
});
