import { test } from "node:test";
import assert from "node:assert/strict";
import { avisoDeConclusaoFicaComOFinal } from "./aviso-de-conclusao-regra";
import { accountFinalEmailPolicyFromRow } from "./account-final-email-policy";

test("conta que recebe o e-mail final: o aviso automático não sai (o final é o aviso)", () => {
  assert.equal(avisoDeConclusaoFicaComOFinal({ canIncludeInvoice: true, canIncludeReport: true }), true);
  assert.equal(avisoDeConclusaoFicaComOFinal({ canIncludeInvoice: false, canIncludeReport: true }), true);
  assert.equal(avisoDeConclusaoFicaComOFinal({ canIncludeInvoice: true, canIncludeReport: false }), true);
});

test("conta sem e-mail final (plataforma com report e fatura desligados): o aviso automático sai", () => {
  assert.equal(avisoDeConclusaoFicaComOFinal({ canIncludeInvoice: false, canIncludeReport: false }), false);
});

test("cliente sem conta (Fixfy direto) recebe o final, então só um e-mail", () => {
  assert.equal(avisoDeConclusaoFicaComOFinal(accountFinalEmailPolicyFromRow(null)), true);
});
