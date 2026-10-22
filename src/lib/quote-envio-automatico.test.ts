import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { validarAutonomia } from "@/lib/harvey/autonomia";
import { contaEhDireta, maximoDoEnvioAutomatico, podeMandarSozinho, envioAutomaticoLigado, quoteJaEnviadaAMao, type EntradaDoEnvio } from "./quote-envio-automatico";

const seguro: EntradaDoEnvio = {
  ligado: true, total: 480, maximo: 1001, escopoConferido: true, perguntaPendente: false,
  contaDireta: true, b2b: false, temCanal: true, equipeNaConversa: false,
};

describe("auto send of a drafted quote", () => {
  afterEach(() => {
    delete process.env.HARVEY_QUOTE_AUTO_SEND;
    delete process.env.HARVEY_QUOTE_AUTO_MAX;
  });

  it("is off unless the owner turns it on (env and the app)", () => {
    const padrao = validarAutonomia(null);
    assert.equal(envioAutomaticoLigado(padrao), false);
    process.env.HARVEY_QUOTE_AUTO_SEND = "1";
    assert.equal(envioAutomaticoLigado(padrao), true);
    assert.equal(envioAutomaticoLigado(validarAutonomia({ areas: { envio: "ensaio" } })), false);
    assert.equal(envioAutomaticoLigado(validarAutonomia({ geral: false })), false);
    // Nunca leu a tela (sem banco): não manda.
    assert.equal(envioAutomaticoLigado(), false);
  });

  it("the app limit wins over the env limit", () => {
    assert.equal(maximoDoEnvioAutomatico(validarAutonomia({ tetoEnvio: 900 })), 900);
  });

  it("the ceiling defaults to £600 (one rule for every path) and reads the env", () => {
    assert.equal(maximoDoEnvioAutomatico(), 600);
    process.env.HARVEY_QUOTE_AUTO_MAX = "800";
    assert.equal(maximoDoEnvioAutomatico(), 800);
    process.env.HARVEY_QUOTE_AUTO_MAX = "nonsense";
    assert.equal(maximoDoEnvioAutomatico(), 600);
  });

  it("a business account in the OS can be sent on its own", () => {
    assert.equal(podeMandarSozinho({ ...seguro, b2b: true, contaDireta: false, contaB2B: true }).enviar, true);
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

describe("quote already sent by hand (stage 3)", () => {
  const criada = "2026-10-20T10:00:00Z";
  const cliente = 111;
  const equipe = 222;
  const harvey = 333;

  it("blocks the automatic send with its own reason", () => {
    const d = podeMandarSozinho({ ...seguro, envioManualDetectado: true });
    assert.equal(d.enviar, false);
    assert.deepEqual(d.motivos, ["a quote was already sent by the team"]);
    // Callers that do not pass it keep the old decision.
    assert.equal(podeMandarSozinho(seguro).enviar, true);
  });

  it("a public agent comment with a price after the quote was created", () => {
    assert.equal(quoteJaEnviadaAMao([{ public: true, author_id: equipe, created_at: "2026-10-20T12:00:00Z", body: "Hi Sam, the price is £480 including materials." }], criada, { requesterId: cliente }), true);
  });

  it("the quote reference or the quote PDF also count", () => {
    assert.equal(quoteJaEnviadaAMao([{ public: true, author_id: equipe, created_at: "2026-10-20T12:00:00Z", body: "Please see Q-1234 attached." }], criada, { referencia: "Q-1234" }), true);
    assert.equal(
      quoteJaEnviadaAMao([{ public: true, author_id: equipe, created_at: "2026-10-20T12:00:00Z", body: "Attached.", attachments: [{ file_name: "Fixfy-Quote.pdf", content_type: "application/pdf" }] }], criada),
      true,
    );
  });

  it("ignores the customer, private notes, older comments and listed automatic authors", () => {
    const cs = [
      { public: true, author_id: cliente, created_at: "2026-10-20T12:00:00Z", body: "Can you do it for £400?" },
      { public: false, author_id: equipe, created_at: "2026-10-20T12:00:00Z", body: "Partner bid £350" },
      { public: true, author_id: equipe, created_at: "2026-10-19T12:00:00Z", body: "Last year it was £300" },
      { public: true, author_id: harvey, created_at: "2026-10-20T12:00:00Z", body: "Handyman visits start at £72 per hour." },
      { public: true, author_id: equipe, created_at: "2026-10-20T13:00:00Z", body: "We are getting prices from our partners." },
    ];
    assert.equal(quoteJaEnviadaAMao(cs, criada, { requesterId: cliente, ignorarAutores: [harvey] }), false);
  });
});
