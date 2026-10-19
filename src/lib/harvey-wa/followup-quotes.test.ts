import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { diaDoFechamento, ehB2B, emailDaCobranca, motivoDeDesistencia, proximoPasso, respostaDeFechamento, whatsappDaCobranca, type DadosDaCobranca } from "./followup-quotes";
import { montarEmail } from "./email-do-leo";

describe("quote chase: three follow-ups in seven days, then close", () => {
  it("first chase 24h after the quote", () => {
    assert.equal(proximoPasso([], 23), null);
    assert.equal(proximoPasso([], 24), 1);
  });
  it("second and third 48h apart (day 3 and day 5)", () => {
    assert.equal(proximoPasso(["quote_chase_1"], 47), null);
    assert.equal(proximoPasso(["quote_chase_1"], 48), 2);
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2"], 48), 3);
  });
  it("closes 48h after the third (day 7)", () => {
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2", "quote_chase_3"], 47), null);
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2", "quote_chase_3"], 48), "fechar");
  });
  it("closed tickets are left alone", () => {
    assert.equal(proximoPasso(["quote_closed_no_reply"], 500), null);
    assert.equal(proximoPasso(["quote_closed_by_customer"], 500), null);
  });
  it("B2B gets two chases: the second is the last, then closes 48h later (day 5)", () => {
    assert.equal(proximoPasso([], 24, true), 1);
    assert.equal(proximoPasso(["quote_chase_1"], 48, true), 2);
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2"], 47, true), null);
    assert.equal(proximoPasso(["quote_chase_1", "quote_chase_2"], 48, true), "fechar");
    assert.match(emailDaCobranca(2, true, { publico: { tipo: "b2b", empresa: "Acme Lettings" } }).assunto, /^Final quote follow-up/);
  });
  it("B2B is recognised by the b2b tag", () => {
    assert.equal(ehB2B({ tags: ["b2b", "quote_chase_1"] }), true);
    assert.equal(ehB2B({ tags: ["harvey_wa"] }), false);
  });
  it("a customer who no longer needs it closes the quote with the right reason", () => {
    assert.equal(motivoDeDesistencia("Hi, we found someone else, thanks"), "booked_elsewhere");
    assert.equal(motivoDeDesistencia("It's too expensive for us at the moment"), "too_expensive");
    assert.equal(motivoDeDesistencia("We no longer need this, thank you"), "customer_cancelled");
    assert.equal(motivoDeDesistencia("Please cancel it, we're all sorted"), "customer_cancelled");
  });
  it("anything else stays with the team", () => {
    assert.equal(motivoDeDesistencia("Can you do Thursday?"), null);
    assert.equal(motivoDeDesistencia("Is the price including materials?"), null);
    assert.equal(motivoDeDesistencia("yes please go ahead"), null);
  });
  it("copy has no dashes, no placeholders, signed by the team", () => {
    for (const p of [1, 2, 3] as const) {
      for (const b2b of [false, true]) {
        const e = emailDaCobranca(p, b2b, b2b ? acme : sarah);
        const { html, text } = montarEmail(e);
        for (const x of [e.assunto, html, text, whatsappDaCobranca(p, sarah)]) {
          assert.doesNotMatch(x, /[—–]/);
          assert.doesNotMatch(x, /\{\{/);
          assert.doesNotMatch(x, /\| Operations/);
        }
        assert.doesNotMatch(text, /The Fixfy team/);
      }
    }
  });
});

const sarah: DadosDaCobranca = {
  publico: { tipo: "b2c", primeiroNome: "Sarah" },
  servico: "Handyman work",
  referencia: "Q-2026-120",
  endereco: "12 Albert Road, London NW5 1AB",
  link: "https://app.getfixfy.com/quote/respond?token=t&action=accept",
};
const acme: DadosDaCobranca = { ...sarah, publico: { tipo: "b2b", empresa: "Acme Lettings" } };

describe("quote chase copy (24 to 29)", () => {
  it("B2C subjects follow the copy", () => {
    assert.equal(emailDaCobranca(1, false, sarah).assunto, "Your handyman work quote · Ready to proceed?");
    assert.equal(emailDaCobranca(2, false, sarah).assunto, "Any changes to your handyman work quote?");
    assert.equal(emailDaCobranca(3, false, sarah).assunto, "A final follow-up on your quote · Q-2026-120");
  });
  it("B2B subjects use the property and reference, greeting is the company team", () => {
    const e1 = emailDaCobranca(1, true, acme);
    assert.equal(e1.assunto, "Quote follow-up · 12 Albert Road · Q-2026-120");
    assert.equal(e1.saudacao, "Hi Acme Lettings team,");
    assert.equal(emailDaCobranca(2, true, acme).assunto, "Final quote follow-up · Q-2026-120");
    assert.equal(emailDaCobranca(1, true, { ...acme, publico: { tipo: "b2b", empresa: null } }).saudacao, "Hi team,");
  });
  it("the closing date only appears when the closure is scheduled", () => {
    assert.doesNotMatch(emailDaCobranca(3, false, sarah).paragrafos.join(" "), /close this enquiry/);
    assert.match(emailDaCobranca(3, false, { ...sarah, fechaEm: "Wednesday 21 October 2026" }).paragrafos.join(" "), /by Wednesday 21 October 2026, we’ll close this enquiry for now/);
    assert.match(whatsappDaCobranca(3, { ...sarah, fechaEm: "Wednesday 21 October 2026" }), /close the enquiry on Wednesday 21 October 2026/);
  });
  it("closing day is 48h later, in London, inside the sweep hours", () => {
    assert.equal(diaDoFechamento(new Date("2026-10-19T10:00:00Z")), "Wednesday 21 October 2026");
    assert.equal(diaDoFechamento(new Date("2026-10-19T19:30:00Z")), "Thursday 22 October 2026");
  });
  it("without a link the CTA disappears and nothing says 'below'", () => {
    const e = emailDaCobranca(2, false, { ...sarah, link: null });
    assert.equal(e.cta, null);
    assert.doesNotMatch(e.paragrafos.join(" "), /below/);
  });
  it("closing reply (29) thanks the customer on the same channel", () => {
    const r = respostaDeFechamento(sarah);
    assert.equal(r.whatsapp, "Hi Sarah, Thank you for letting us know. We’ve closed your quote for handyman work as requested. If your plans change or you need help with another job, we’ll be happy to hear from you.");
    assert.equal(r.email.assunto, "Your quote has been closed · Q-2026-120");
  });
});
