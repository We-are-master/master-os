import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { decidirEnvio, normalizarMobileUk } from "./policy";

describe("normalizarMobileUk", () => {
  it("aceita os tres formatos que existem no banco", () => {
    // Formatos reais, copiados de clients.phone em 20/08/2026.
    assert.equal(normalizarMobileUk("07508801803"), "+447508801803");
    assert.equal(normalizarMobileUk("+44 78967 10967"), "+447896710967");
    assert.equal(normalizarMobileUk("07395 675020"), "+447395675020");
    assert.equal(normalizarMobileUk("+44 (0) 7810-007627"), null); // com o 0 sobrando nao e valido
    assert.equal(normalizarMobileUk("447963503526"), "+447963503526");
    assert.equal(normalizarMobileUk("00447963503526"), "+447963503526");
  });

  it("recusa numero que nao recebe WhatsApp de cliente", () => {
    // JOB-9427: numero dos EUA num job de Londres, quase sempre o landlord.
    assert.equal(normalizarMobileUk("+1 727-580-0572"), null);
    // Fixo de Londres.
    assert.equal(normalizarMobileUk("+442071234567"), null);
    assert.equal(normalizarMobileUk("02071234567"), null);
    // Lixo que existe na base.
    assert.equal(normalizarMobileUk("07"), null);
    assert.equal(normalizarMobileUk(""), null);
    assert.equal(normalizarMobileUk(null), null);
    assert.equal(normalizarMobileUk(undefined), null);
  });

  it("nao aceita mobile curto ou longo demais", () => {
    assert.equal(normalizarMobileUk("07508801"), null);
    assert.equal(normalizarMobileUk("075088018030"), null);
  });
});

describe("decidirEnvio", () => {
  const tel = "+44 78967 10967";

  it("manda quando a conta permite e o numero serve", () => {
    const d = decidirEnvio({ politicaDaConta: true, nomeDaConta: "Housekeep", telefoneDoCliente: tel });
    assert.deepEqual(d, { manda: true, telefone: "+447896710967" });
  });

  it("nao manda para conta que decidiu que nao", () => {
    const d = decidirEnvio({
      politicaDaConta: false,
      nomeDaConta: "Fantastic Services",
      telefoneDoCliente: tel,
    });
    assert.equal(d.manda, false);
    assert.match((d as { motivo: string }).motivo, /Fantastic Services does not send/);
  });

  it("conta nao decidida pede decisao, e nao se confunde com conta desligada", () => {
    const naoDecidida = decidirEnvio({ politicaDaConta: null, nomeDaConta: "Nova Conta", telefoneDoCliente: tel });
    assert.equal(naoDecidida.manda, false);
    assert.match((naoDecidida as { motivo: string }).motivo, /no decision yet for Nova Conta/);

    const desligada = decidirEnvio({ politicaDaConta: false, nomeDaConta: "Nova Conta", telefoneDoCliente: tel });
    assert.notEqual((naoDecidida as { motivo: string }).motivo, (desligada as { motivo: string }).motivo);
  });

  it("conta indefinida (cliente sem conta) tambem pede decisao", () => {
    const d = decidirEnvio({ politicaDaConta: undefined, telefoneDoCliente: tel });
    assert.equal(d.manda, false);
    assert.match((d as { motivo: string }).motivo, /no decision yet for this account/);
  });

  it("a conta e perguntada ANTES do telefone", () => {
    // A Fantastic nao tem telefone nenhum. O motivo tem que ser a decisao
    // comercial, nao "sem telefone": senao alguem vai cacar um numero que
    // nao deveria ser usado.
    const d = decidirEnvio({
      politicaDaConta: false,
      nomeDaConta: "Fantastic Services",
      telefoneDoCliente: null,
    });
    assert.match((d as { motivo: string }).motivo, /does not send client confirmations/);
  });

  it("explica o numero ruim citando o numero", () => {
    const d = decidirEnvio({
      politicaDaConta: true,
      nomeDaConta: "Housekeep",
      telefoneDoCliente: "+1 727-580-0572",
    });
    assert.equal(d.manda, false);
    assert.match((d as { motivo: string }).motivo, /not a UK mobile: "\+1 727-580-0572"/);
  });

  it("sem telefone nenhum diz isso, e nao 'numero invalido'", () => {
    const d = decidirEnvio({ politicaDaConta: true, nomeDaConta: "Housekeep", telefoneDoCliente: null });
    assert.equal((d as { motivo: string }).motivo, "no phone number for the customer");
  });

  it("job que ja recebeu nao recebe de novo, mesmo com tudo valido", () => {
    const d = decidirEnvio({
      politicaDaConta: true,
      nomeDaConta: "Housekeep",
      telefoneDoCliente: tel,
      jaEnviadoEm: "2026-08-20T09:00:00Z",
    });
    assert.deepEqual(d, { manda: false, motivo: "already sent" });
  });
});
