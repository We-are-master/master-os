import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { jobOnHoldPorReclamacao } from "./job-on-hold-reasons";

describe("jobOnHoldPorReclamacao", () => {
  test("o preset é a prova boa, e é o que o caminho novo grava", () => {
    assert.equal(jobOnHoldPorReclamacao({ on_hold_reason_preset_id: "complaint" }), true);
  });

  test("descrição preenchida também prova", () => {
    assert.equal(
      jobOnHoldPorReclamacao({ on_hold_complaint_description: "Cliente diz que o piso trincou" }),
      true,
    );
  });

  test("as linhas velhas, que só têm o texto", () => {
    // JOB-9261..9264 (04/06/2026): "Complaint", sem preset nem descrição.
    assert.equal(jobOnHoldPorReclamacao({ on_hold_reason: "Complaint" }), true);
    // JOB-8945: rótulo duplicado pelo sync do Zendesk.
    assert.equal(jobOnHoldPorReclamacao({ on_hold_reason: "Complaint — Client Complaint" }), true);
  });

  test("os outros motivos de espera não viram reclamação", () => {
    for (const r of [
      "Waiting for materials",
      "Awaiting Customer Response — Awaiting Customer Response",
      "Additional Quote Required",
      "Access issue",
    ]) {
      assert.equal(jobOnHoldPorReclamacao({ on_hold_reason: r }), false, `não deveria casar: ${r}`);
    }
  });

  test("campo vazio, nulo ou ausente não inventa reclamação", () => {
    assert.equal(jobOnHoldPorReclamacao({}), false);
    assert.equal(jobOnHoldPorReclamacao({ on_hold_reason: null, on_hold_complaint_description: "  " }), false);
    assert.equal(jobOnHoldPorReclamacao({ on_hold_reason_preset_id: null }), false);
  });

  test('"complaints" no meio de outra frase não conta como palavra solta errada', () => {
    // A busca é por palavra, então "no complaints" casa de propósito: o texto
    // fala de reclamação. O que não pode é casar "compliant".
    assert.equal(jobOnHoldPorReclamacao({ on_hold_reason: "Compliant with regs" }), false);
  });
});
