import { test } from "node:test";
import assert from "node:assert/strict";
import { ehDoLeo } from "./zendesk-wa";

test("ticket do Leo, com_leo ou preço escrito por ele: nada automático", () => {
  assert.equal(ehDoLeo({ assignee: 6227542863391, tags: [], quem: "Victor Braz" }), true);
  assert.equal(ehDoLeo({ assignee: null, tags: ["com_leo"], quem: "Victor Braz" }), true);
  assert.equal(ehDoLeo({ assignee: null, tags: [], quem: "Leonardo Piovesan" }), true);
  assert.equal(ehDoLeo({ assignee: null, tags: [], quem: "Leo" }), true);
});

test("preço do Victor ou da equipe em ticket que não é do Leo segue a automação", () => {
  assert.equal(ehDoLeo({ assignee: 5679223041823, tags: ["harvey_wa"], quem: "Victor Braz" }), false);
  assert.equal(ehDoLeo({ assignee: null, tags: [], quem: "Fixfy Team" }), false);
  assert.equal(ehDoLeo({ assignee: null, tags: [], quem: "Leona Smith" }), false);
});
