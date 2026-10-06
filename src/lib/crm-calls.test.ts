import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, applyCallOutcome, isCallDue, matchesCallFilter, parseCallLog, summarizeCalls } from "./crm-calls";
import type { CrmStage } from "@/types/database";

const stage = (id: string, position: number, kind: CrmStage["kind"]): CrmStage => ({
  id, name: id, position, kind, color: "slate", created_at: "", updated_at: "",
});
const STAGES = [stage("lead", 0, "open"), stage("scheduled", 1, "open"), stage("onboarding", 2, "open"), stage("won", 3, "won"), stage("lost", 4, "lost")];
// Terça, 06/10/2026, 10:42 no fuso local.
const TUE = new Date(2026, 9, 6, 10, 42);
const FRI = new Date(2026, 9, 9, 16, 5);

describe("addBusinessDays", () => {
  it("pula o fim de semana", () => {
    assert.equal(addBusinessDays(TUE, 1), "2026-10-07");
    assert.equal(addBusinessDays(FRI, 1), "2026-10-12");
    assert.equal(addBusinessDays(FRI, 2), "2026-10-13");
  });
});

describe("applyCallOutcome", () => {
  const base = { stage_id: "lead", notes: "Independent agent in Hackney.", next_step: "Cold call", next_step_date: "2026-10-06" };

  it("sem resposta: linha datada no topo e liga de novo no próximo dia útil", () => {
    const r = applyCallOutcome(base, "no_answer", STAGES, FRI, "  ");
    assert.equal(r.notes, "09/10/2026 16:05 · No answer\nIndependent agent in Hackney.");
    assert.equal(r.next_step, "Call again");
    assert.equal(r.next_step_date, "2026-10-12");
    assert.equal(r.stage_id, "lead");
  });

  it("reunião marcada vai para a próxima etapa aberta e guarda a observação", () => {
    const r = applyCallOutcome(base, "meeting", STAGES, TUE, "Thu 11am with Sarah");
    assert.equal(r.stage_id, "scheduled");
    assert.equal(r.next_step, "Meeting");
    assert.equal(r.next_step_date, "2026-10-07");
    assert.match(r.notes ?? "", /^06\/10\/2026 10:42 · Meeting booked · Thu 11am with Sarah\n/);
  });

  it("retorno respeita a data futura que já estava marcada", () => {
    const r = applyCallOutcome({ ...base, next_step_date: "2026-10-20" }, "call_back", STAGES, TUE);
    assert.equal(r.next_step_date, "2026-10-20");
  });

  it("sem interesse vai para perdido e limpa o próximo passo", () => {
    const r = applyCallOutcome(base, "not_interested", STAGES, TUE);
    assert.deepEqual([r.stage_id, r.next_step, r.next_step_date], ["lost", null, null]);
  });

  it("cliente que já é conta continua ganho mesmo sem interesse", () => {
    const r = applyCallOutcome({ ...base, stage_id: "won" }, "not_interested", STAGES, TUE);
    assert.equal(r.stage_id, "won");
  });

  it("nota vazia vira só a linha da ligação", () => {
    assert.equal(applyCallOutcome({ ...base, notes: null }, "voicemail", STAGES, TUE).notes, "06/10/2026 10:42 · Voicemail");
  });
});

describe("isCallDue", () => {
  it("vence hoje ou antes, nunca em etapa de perdido", () => {
    assert.equal(isCallDue({ next_step_date: "2026-10-06" }, "open", "2026-10-06"), true);
    assert.equal(isCallDue({ next_step_date: "2026-10-01" }, "won", "2026-10-06"), true);
    assert.equal(isCallDue({ next_step_date: "2026-10-07" }, "open", "2026-10-06"), false);
    assert.equal(isCallDue({ next_step_date: "2026-10-01" }, "lost", "2026-10-06"), false);
    assert.equal(isCallDue({ next_step_date: null }, "open", "2026-10-06"), false);
  });
});

describe("parseCallLog e o filtro", () => {
  const notes = [
    "06/10/2026 15:20 · Call back · ask for Sarah",
    "06/10/2026 10:42 · No answer",
    "Independent agent in Hackney.",
    "30/12 09:00 · Voicemail",
    "Priority A. Not a call line · No answer",
  ].join("\n");

  it("lê só as linhas de ligação, da mais nova para a mais antiga, e acerta o ano que falta", () => {
    const calls = parseCallLog(notes, TUE);
    assert.deepEqual(calls.map((c) => [c.day, c.outcome, c.note]), [
      ["2026-10-06", "call_back", "ask for Sarah"],
      ["2026-10-06", "no_answer", null],
      ["2025-12-30", "voicemail", null],
    ]);
  });

  it("resume em quantidade e última ligação", () => {
    const s = summarizeCalls(notes, TUE);
    assert.equal(s.count, 3);
    assert.equal(s.last?.outcome, "call_back");
    assert.deepEqual(summarizeCalls("Just notes", TUE), { count: 0, last: null });
  });

  it("filtra por nunca ligou, ligou hoje e resultado da última ligação", () => {
    const s = summarizeCalls(notes, TUE);
    const none = summarizeCalls(null, TUE);
    assert.equal(matchesCallFilter(s, "", "2026-10-06"), true);
    assert.equal(matchesCallFilter(s, "today", "2026-10-06"), true);
    assert.equal(matchesCallFilter(s, "today", "2026-10-07"), false);
    assert.equal(matchesCallFilter(s, "call_back", "2026-10-06"), true);
    assert.equal(matchesCallFilter(s, "no_answer", "2026-10-06"), false);
    assert.equal(matchesCallFilter(none, "never", "2026-10-06"), true);
    assert.equal(matchesCallFilter(s, "never", "2026-10-06"), false);
  });

  it("a linha que o botão grava é lida de volta", () => {
    const r = applyCallOutcome({ stage_id: "lead", notes: null, next_step: null, next_step_date: null }, "interested", STAGES, TUE, "wants prices");
    const last = summarizeCalls(r.notes, TUE).last;
    assert.deepEqual([last?.day, last?.outcome, last?.note], ["2026-10-06", "interested", "wants prices"]);
  });
});
