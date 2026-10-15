import assert from "node:assert/strict";
import { test } from "node:test";
import { parseClientNotes } from "./client-notes";

const lead =
  "checkatrade-lead:01a1405f-cece-7733-a939-baf68de20b71\n\ncheckatrade-account:main\n\nEnquiry · General Maintenance\n\nI have a 3-door wardrobe to disassemble.\n\nThe customer is flexible on the start date.";

test("lead do Checkatrade vira um bloco com origem, título, texto e disponibilidade", () => {
  const [b] = parseClientNotes(lead);
  assert.equal(b.source, "Checkatrade · main");
  assert.equal(b.leadId, "01a1405f");
  assert.equal(b.title, "Enquiry · General Maintenance");
  assert.deepEqual(b.paragraphs, ["I have a 3-door wardrobe to disassemble."]);
  assert.equal(b.availability, "The customer is flexible on the start date.");
});

test("dois leads na mesma nota viram dois blocos", () => {
  const dois = `${lead}\n\ncheckatrade-lead:02b2\n\ncheckatrade-account:second\n\nEnquiry · Painter\n\nPaint the hall.`;
  const blocos = parseClientNotes(dois);
  assert.equal(blocos.length, 2);
  assert.equal(blocos[1].source, "Checkatrade · second");
  assert.equal(blocos[1].title, "Enquiry · Painter");
});

test("nota escrita à mão segue como texto", () => {
  const [b] = parseClientNotes("Prefers mornings.\nCall before arriving.");
  assert.equal(b.source, null);
  assert.deepEqual(b.paragraphs, ["Prefers mornings.", "Call before arriving."]);
});

test("nota vazia não gera bloco", () => {
  assert.deepEqual(parseClientNotes("  \n "), []);
});
