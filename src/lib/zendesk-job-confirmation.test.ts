import { test } from "node:test";
import assert from "node:assert/strict";
import { ehContaPropria, resolveCustomerGreetingName } from "./zendesk-job-confirmation";

test("conta com o nome da nossa empresa é a dos clientes diretos", () => {
  assert.equal(ehContaPropria("Fixfy", "Fixfy"), true);
  assert.equal(ehContaPropria(" fixfy ", "Fixfy"), true);
  assert.equal(ehContaPropria("Housekeep", "Fixfy"), false);
  assert.equal(ehContaPropria("Fixfy", null), false);
  assert.equal(ehContaPropria(null, "Fixfy"), false);
});

test("cliente direto é chamado pelo primeiro nome, organização pelo nome dela", () => {
  assert.equal(resolveCustomerGreetingName(null, "Catherine Dennis"), "Catherine");
  assert.equal(resolveCustomerGreetingName("Housekeep", "Julian Smith"), "Housekeep");
  assert.equal(resolveCustomerGreetingName(null, ""), "there");
});
