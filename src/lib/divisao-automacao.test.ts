import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classificarAtor, classificarCriacaoDoJob, percentuais } from "./divisao-automacao";

describe("who did the work", () => {
  it("classifies audit events", () => {
    assert.equal(classificarAtor({ userId: null, userName: null }), "system");
    assert.equal(classificarAtor({ userId: null, userName: "Harvey" }), "harvey");
    assert.equal(classificarAtor({ userId: "u1", userName: "Leonardo Piovesan" }), "human");
  });

  it("classifies job creation", () => {
    assert.equal(classificarCriacaoDoJob({ externalSource: "zendesk", internalNotes: "Created by Harvey from ticket #1" }), "harvey");
    assert.equal(classificarCriacaoDoJob({ externalSource: "zendesk", internalNotes: "remedial-of:JOB-9600" }), "system");
    assert.equal(classificarCriacaoDoJob({ externalSource: "zendesk", internalNotes: null }), "human");
  });

  it("percentages add up", () => {
    assert.deepEqual(percentuais({ harvey: 5, system: 3, human: 2 }), { harvey: 50, system: 30, human: 20 });
    assert.deepEqual(percentuais({ harvey: 0, system: 0, human: 0 }), { harvey: 0, system: 0, human: 0 });
  });
});
