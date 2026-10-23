import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildFinalReportEmail } from "./final-report-email";

describe("copy 13: report only", () => {
  const base = { jobReference: "JOB-9800", service: "EICR", propertyAddress: "12 Example Road, London E1 6AN", reportAttachmentCount: 1, reportRequested: true };
  it("B2C, report attached", () => {
    const e = buildFinalReportEmail({ ...base, publico: { tipo: "b2c", primeiroNome: "Sarah" } });
    assert.equal(e.subject, "Your job report is ready · JOB-9800");
    assert.match(e.text, /Hi Sarah,/);
    assert.match(e.text, /The work at 12 Example Road, London E1 6AN is complete, and your final report is attached/);
    assert.doesNotMatch(e.subject + e.html + e.text, /[–—]|\{\{|invoice/i);
  });
  it("B2B greets the company", () => {
    const e = buildFinalReportEmail({ ...base, publico: { tipo: "b2b", empresa: "Acme Lettings" } });
    assert.match(e.text, /Hi Acme Lettings team,/);
  });
  it("no file attached: does not say attached", () => {
    const e = buildFinalReportEmail({ ...base, reportAttachmentCount: 0, publico: { tipo: "b2c", primeiroNome: null } });
    assert.doesNotMatch(e.text, /is attached/);
    assert.match(e.text, /Hi there,/);
  });
});

it("e-mail final sem foto: linha neutra No photos available (opt-in pelo vazio)", () => {
  const base = { publico: { tipo: "b2c" as const, primeiroNome: "Sarah" }, jobReference: "JOB-1", service: "Carpentry", propertyAddress: "1 Road", reportAttachmentCount: 1, reportRequested: true };
  const vazio = buildFinalReportEmail({ ...base, fotos: { lista: [], link: null, vazio: "No photos available" } });
  assert.match(vazio.html, /border:1px dashed[^>]*><p[^>]*>No photos available</);
  assert.match(vazio.text, /No photos available/);
  const semCampo = buildFinalReportEmail({ ...base, fotos: null });
  assert.doesNotMatch(semCampo.html, /No photos available|dashed/);
  const comFoto = buildFinalReportEmail({ ...base, fotos: { lista: [{ url: "https://x.test/1.png" }], vazio: "No photos available" } });
  assert.doesNotMatch(comFoto.html, /No photos available/);
});
