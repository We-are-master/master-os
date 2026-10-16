import assert from "node:assert/strict";
import { test } from "node:test";
import { dataDoJobNoAceite } from "./quote-accept-job-fields";

const agora = new Date("2026-10-15T12:00:00Z");

test("usa a primeira data proposta quando ainda não passou", () => {
  assert.equal(dataDoJobNoAceite({ start_date_option_1: "2026-10-20", start_date_option_2: "2026-10-22" }, agora), "2026-10-20");
});

test("pula a primeira data se já passou e usa a segunda", () => {
  assert.equal(dataDoJobNoAceite({ start_date_option_1: "2026-10-10", start_date_option_2: "2026-10-22" }, agora), "2026-10-22");
});

test("hoje ainda vale", () => {
  assert.equal(dataDoJobNoAceite({ start_date_option_1: "2026-10-15" }, agora), "2026-10-15");
});

test("sem data válida fica sem data", () => {
  assert.equal(dataDoJobNoAceite({ start_date_option_1: null, start_date_option_2: "" }, agora), null);
  assert.equal(dataDoJobNoAceite({ start_date_option_1: "2026-09-01" }, agora), null);
});
