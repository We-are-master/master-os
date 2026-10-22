import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { contaDaFixfy, ehJobDeCertificado, jobPago, reterCertificado } from "./regra";

const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
const B2B = "11111111-1111-1111-1111-111111111111";
const eicr = { title: "EICR", status: "awaiting_payment", final_report: { template: "certificate", photos: { certificate: ["a.pdf"] } } };

describe("certificado só com o job pago", () => {
  it("reconhece job de certificado pelo modelo, pelo slot ou pelo tipo", () => {
    assert.equal(ehJobDeCertificado({ final_report: { template: "certificate" } }), true);
    assert.equal(ehJobDeCertificado({ final_report: { photos: { certificate: ["x.pdf"] } } }), true);
    assert.equal(ehJobDeCertificado({ title: "Gas Safety Certificate" }), true);
    assert.equal(ehJobDeCertificado({ title: "Painter", final_report: { template: "general" } }), false);
  });

  it("cliente da Fixfy: sem conta ou a conta Fixfy", () => {
    assert.equal(contaDaFixfy(null, FIXFY), true);
    assert.equal(contaDaFixfy(FIXFY, FIXFY), true);
    assert.equal(contaDaFixfy(B2B, FIXFY), false);
  });

  it("pago = Completed ou financeiro pago", () => {
    assert.equal(jobPago({ status: "completed" }), true);
    assert.equal(jobPago({ status: "awaiting_payment", finance_status: "paid" }), true);
    assert.equal(jobPago({ status: "awaiting_payment" }), false);
  });

  it("retém no e-mail final da Fixfy com saldo", () => {
    assert.equal(reterCertificado(eicr, FIXFY, { fixfyId: FIXFY }), true);
    assert.equal(reterCertificado(eicr, null, { fixfyId: FIXFY }), true);
  });

  it("não retém: já pago, outra conta, job comum, ou o e-mail do pagamento", () => {
    assert.equal(reterCertificado({ ...eicr, status: "completed" }, FIXFY, { fixfyId: FIXFY }), false);
    assert.equal(reterCertificado(eicr, B2B, { fixfyId: FIXFY }), false);
    assert.equal(reterCertificado({ title: "Painter", status: "awaiting_payment" }, FIXFY, { fixfyId: FIXFY }), false);
    assert.equal(reterCertificado(eicr, FIXFY, { fixfyId: FIXFY, forcarAnexo: true }), false);
  });
});
