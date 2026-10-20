import assert from "node:assert/strict";
import { describe, it, test } from "node:test";
import { dataDoJobNoAceite, dataEscolhidaNoAceite, datasDisponiveis } from "./quote-accept-job-fields";

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

describe("customer picks one of the partner's dates (20/10/2026)", () => {
  const agora20 = new Date("2026-10-20T10:00:00Z");
  const q = { start_date_option_1: "2026-10-24", start_date_option_2: "2026-10-27" };
  it("offers only future dates, without repeats", () => {
    assert.deepEqual(datasDisponiveis({ start_date_option_1: "2026-10-19", start_date_option_2: "2026-10-27" }, agora20), ["2026-10-27"]);
    assert.deepEqual(datasDisponiveis({ start_date_option_1: "2026-10-24", start_date_option_2: "2026-10-24" }, agora20), ["2026-10-24"]);
  });
  it("the chosen date wins", () => {
    assert.deepEqual(dataEscolhidaNoAceite(q, "2026-10-27", agora20), { data: "2026-10-27", nenhumaServe: false });
  });
  it("a date that was not offered is ignored", () => {
    assert.deepEqual(dataEscolhidaNoAceite(q, "2026-11-30", agora20), { data: "2026-10-24", nenhumaServe: false });
  });
  it("none works: no date and the team agrees one", () => {
    assert.deepEqual(dataEscolhidaNoAceite(q, "none", agora20), { data: null, nenhumaServe: true });
  });
});
