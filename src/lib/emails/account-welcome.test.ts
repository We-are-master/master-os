/**
 * Boas-vindas de conta: só boas-vindas e guia, sem preço e sem travessão.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAccountWelcomeEmail } from "./account-welcome";

test("boas-vindas e guia, sem preço", () => {
  const e = buildAccountWelcomeEmail({ empresa: "Crestview Pinnacle", contato: "Mohsen Sayahi" });
  assert.equal(e.subject, "Welcome to Fixfy, Crestview Pinnacle");
  assert.match(e.html, /Hi Mohsen,/);
  assert.match(e.html, /What to include in each job request/);
  assert.match(e.html, /hello@getfixfy\.com/);
  assert.doesNotMatch(e.html + e.text, /£/);
  assert.doesNotMatch(e.html + e.text, /[—–]/);
});

test("sem contato: saudação à equipe", () => {
  assert.match(buildAccountWelcomeEmail({ empresa: "Acme Lettings" }).html, /Hi Acme Lettings team,/);
});
