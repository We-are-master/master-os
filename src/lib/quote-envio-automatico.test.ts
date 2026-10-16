import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { contaEhDireta, maximoDoEnvioAutomatico, podeMandarSozinho, envioAutomaticoLigado, type EntradaDoEnvio } from "./quote-envio-automatico";

const seguro: EntradaDoEnvio = {
  ligado: true, total: 480, maximo: 1001, escopoConferido: true, perguntaPendente: false,
  contaDireta: true, b2b: false, temCanal: true, equipeNaConversa: false,
};

describe("auto send of a drafted quote", () => {
  afterEach(() => {
    delete process.env.HARVEY_QUOTE_AUTO_SEND;
    delete process.env.HARVEY_QUOTE_AUTO_MAX;
  });

  it("is off unless the owner turns it on", () => {
    assert.equal(envioAutomaticoLigado(), false);
    process.env.HARVEY_QUOTE_AUTO_SEND = "1";
    assert.equal(envioAutomaticoLigado(), true);
  });

  it("the ceiling defaults to £600 (one rule for every path) and reads the env", () => {
    assert.equal(maximoDoEnvioAutomatico(), 600);
    process.env.HARVEY_QUOTE_AUTO_MAX = "800";
    assert.equal(maximoDoEnvioAutomatico(), 800);
    process.env.HARVEY_QUOTE_AUTO_MAX = "nonsense";
    assert.equal(maximoDoEnvioAutomatico(), 600);
  });

  it("sends when everything is safe", () => {
    assert.deepEqual(podeMandarSozinho(seguro), { enviar: true, motivos: [] });
    assert.equal(podeMandarSozinho({ ...seguro, total: 1001 }).enviar, true);
  });

  it("each condition alone holds it back", () => {
    const casos: Array<[Partial<EntradaDoEnvio>, RegExp]> = [
      [{ ligado: false }, /off/],
      [{ total: 1001.01 }, /over £1001/],
      [{ total: 0 }, /no valid price/],
      [{ escopoConferido: false }, /scope not checked/],
      [{ perguntaPendente: true }, /pending/],
      [{ b2b: true }, /business/],
      [{ contaDireta: false }, /not a direct/],
      [{ temCanal: false }, /no way to reach/],
      [{ equipeNaConversa: true }, /team/],
    ];
    for (const [mudanca, motivo] of casos) {
      const d = podeMandarSozinho({ ...seguro, ...mudanca });
      assert.equal(d.enviar, false, JSON.stringify(mudanca));
      assert.match(d.motivos.join("; "), motivo);
    }
  });
});

describe("direct customer account", () => {
  it("the Fixfy account is direct", () => {
    assert.equal(contaEhDireta({ contaDeOrigem: "ABC", contaFixfy: "abc", daConversaDoHarvey: false }), true);
  });
  it("the Checkatrade direct account is direct", () => {
    assert.equal(contaEhDireta({ contaDeOrigem: "8060fcf3-a538-4e5a-9318-1b49ee59f432", contaFixfy: "x", daConversaDoHarvey: false }), true);
  });
  it("any other account (B2B, platform) is not", () => {
    assert.equal(contaEhDireta({ contaDeOrigem: "some-agency", contaFixfy: "x", daConversaDoHarvey: true }), false);
  });
  it("no account only counts when the quote came from Harvey's WhatsApp", () => {
    assert.equal(contaEhDireta({ contaDeOrigem: null, contaFixfy: "x", daConversaDoHarvey: true }), true);
    assert.equal(contaEhDireta({ contaDeOrigem: null, contaFixfy: "x", daConversaDoHarvey: false }), false);
  });
});
