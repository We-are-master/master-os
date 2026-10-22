import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { emailDaReclamacao, pedeAviso, type JobDaReclamacao } from "./aviso";

const AGORA = new Date("2026-10-23T10:00:00Z");
const job: JobDaReclamacao = { id: "j1", reference: "JOB-1", status: "on_hold", on_hold_at: "2026-10-23T09:00:00Z", on_hold_reason_preset_id: "complaint" };

describe("aviso de reclamação", () => {
  it("manda para cliente da Fixfy e para conta B2B", () => {
    assert.equal(pedeAviso(job, "direct", AGORA).sim, true);
    assert.equal(pedeAviso(job, "b2b", AGORA).sim, true);
    assert.equal(pedeAviso(job, null, AGORA).sim, true);
  });
  it("não manda para cliente de plataforma, outro motivo, nem reclamação velha ou de antes", () => {
    assert.equal(pedeAviso(job, "platform", AGORA).sim, false);
    assert.equal(pedeAviso({ ...job, on_hold_reason_preset_id: "access" }, "direct", AGORA).sim, false);
    assert.equal(pedeAviso({ ...job, on_hold_at: "2026-10-20T09:00:00Z" }, "direct", new Date("2026-10-23T10:00:00Z")).sim, false);
    assert.equal(pedeAviso({ ...job, on_hold_at: "2026-10-22T10:00:00Z" }, "direct", new Date("2026-10-22T11:00:00Z")).sim, false);
    assert.equal(pedeAviso({ ...job, status: "scheduled" }, "direct", AGORA).sim, false);
  });
  it("reconhece reclamação pela descrição também", () => {
    assert.equal(pedeAviso({ ...job, on_hold_reason_preset_id: null, on_hold_complaint_description: "Grout cracked" }, "direct", AGORA).sim, true);
  });
  it("texto: inglês, sem travessão, promete contato em 24 horas", () => {
    const e = emailDaReclamacao({ publico: { tipo: "b2c", primeiroNome: "Sarah" }, referencia: "JOB-1", servico: "Tiling", endereco: "14 Lavender Hill" });
    assert.equal(e.assunto, "We’re looking into it · JOB-1");
    assert.match(e.text, /Hi Sarah,/);
    assert.match(e.text, /within 24 hours/);
    assert.doesNotMatch(e.html + e.text, /[—–]/);
    const b2b = emailDaReclamacao({ publico: { tipo: "b2b", empresa: "Citiland" }, referencia: "JOB-2" });
    assert.match(b2b.text, /Hi Citiland team,/);
  });
});
