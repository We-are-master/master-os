import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { conferirMensagem, conferirPreco } from "./conferente";
import { lerComando } from "./pedir-ajuda";
import { lerLeituraJson, textoDoAceite } from "./aceite-escrito";
import { lerPerguntasJson, textoDoPedidoDeInfo } from "@/lib/zendesk-quoter/pedir-info";

describe("conferente (B4)", () => {
  it("never shows the partner's cost, margin, name or 'bid' to the customer", () => {
    assert.equal(conferirMensagem("Your quote is £575.00 for the work.", { publico: "cliente", custo: 400 }).ok, true);
    assert.match(conferirMensagem("The partner cost was £400.00, we added margin.", { publico: "cliente", custo: 400 }).problemas.join(), /cost|margin/);
    assert.equal(conferirMensagem("WHistyle will do it for £575.", { publico: "cliente", nomesDeParceiros: ["WHistyle"] }).ok, false);
    assert.equal(conferirMensagem("The best bid came in today.", { publico: "cliente" }).ok, false);
  });
  it("fixes em dashes and blocks our own address", () => {
    assert.equal(conferirMensagem("Thanks — booked.", { publico: "cliente" }).texto, "Thanks, booked.");
    assert.equal(conferirMensagem("Hello there", { publico: "cliente", emailDestino: "leo@getfixfy.com" }).ok, false);
  });
  it("price must be above cost and not absurd", () => {
    assert.equal(conferirPreco({ total: 575, custo: 400 }).ok, true);
    assert.equal(conferirPreco({ total: 400, custo: 400 }).ok, false);
    assert.equal(conferirPreco({ total: 5000, custo: 400 }).ok, false);
    assert.equal(conferirPreco({ total: 500, custo: 300, piso: 600 }).ok, false);
  });
});

describe("#harvey commands (B4)", () => {
  it("reads send, price and stop", () => {
    assert.deepEqual(lerComando("#harvey send"), { acao: "send" });
    assert.deepEqual(lerComando("#Harvey price £1,400"), { acao: "price", valor: 1400 });
    assert.deepEqual(lerComando("#harvey price 1400.50 please"), { acao: "price", valor: 1400.5 });
    assert.deepEqual(lerComando("#harvey stop"), { acao: "stop" });
  });
  it("ignores anything else", () => {
    assert.equal(lerComando("harvey send"), null);
    assert.equal(lerComando("#harvey price"), null);
    assert.equal(lerComando("Customer called, will send later"), null);
  });
});

describe("written acceptance (B3)", () => {
  const datas = ["2026-10-24", "2026-10-27"];
  it("keeps only an offered date", () => {
    assert.deepEqual(lerLeituraJson('{"type":"accept","date":"2026-10-27","summary":"Go ahead on the 27th"}', datas), { tipo: "accept", data: "2026-10-27", resumo: "Go ahead on the 27th" });
    assert.equal(lerLeituraJson('{"type":"accept","date":"2026-11-30","summary":"x"}', datas)?.data, null);
    assert.equal(lerLeituraJson('{"type":"accept","date":"none","summary":"x"}', datas)?.data, "none");
    assert.equal(lerLeituraJson("not json", datas), null);
  });
  it("reply after accepting asks for the deposit only when there is one", () => {
    assert.match(textoDoAceite({ referencia: "QT-1", data: "2026-10-27", paymentLinkUrl: "https://x/pay", entrada: 240 }), /£240\.00 deposit here: https:\/\/x\/pay/);
    assert.doesNotMatch(textoDoAceite({ referencia: "QT-1", data: null, paymentLinkUrl: null, entrada: 0 }), /deposit/);
  });
});

describe("missing info for B2B (hole)", () => {
  it("at most 3 questions, no em dashes", () => {
    assert.deepEqual(lerPerguntasJson('{"questions":["What size is the room — roughly?","Is there parking?","Can you send photos?","Colour?"]}'), [
      "What size is the room, roughly?",
      "Is there parking?",
      "Can you send photos?",
    ]);
    assert.deepEqual(lerPerguntasJson("{}"), []);
    assert.match(textoDoPedidoDeInfo("Marko", ["Is there parking?"]), /Hi Marko,[\s\S]*1\. Is there parking\?/);
  });
});
