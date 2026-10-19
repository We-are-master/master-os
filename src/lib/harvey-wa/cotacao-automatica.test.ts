import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TAG_FIM, TAG_LEMBROU_PARCEIROS, TAG_PARA_REVISAR, TAG_QUOTE_ENVIADA, TAG_SEM_LANCE,
  decidirEnvio, enderecoCompleto, enderecoNasMensagens, faltandoNoContexto, margemDe, precoDoLance,
  proximoPassoDoLeilao, servicoDoAssunto, textoAindaCotando, textoDaQuote, textoPedeContexto,
} from "./cotacao-automatica";
import { ranquearParceiros } from "./melhores-parceiros";

const completo = { servico: "Carpentry", postcode: "NW2 6XJ", endereco: "14 Cricklewood Lane, NW2 6XJ", escopo: "Bespoke bookshelves either side of the fireplace", fotos: 2 };

describe("auto-quote: minimum context before inviting partners", () => {
  it("a postcode alone is not a full address", () => {
    assert.equal(enderecoCompleto("NW2 6XJ"), false);
    assert.equal(enderecoCompleto("SW15 2RG"), false);
    assert.equal(enderecoCompleto("14 Cricklewood Lane, NW2 6XJ"), true);
    assert.equal(enderecoCompleto("Flat 3, 22b Upper Richmond Road SW15 2RG"), true);
    assert.equal(enderecoCompleto(null), false);
  });
  it("lists exactly what is missing", () => {
    assert.deepEqual(faltandoNoContexto(completo), []);
    assert.deepEqual(faltandoNoContexto({ ...completo, endereco: "NW2 6XJ", fotos: 0 }), ["address", "photos"]);
    assert.deepEqual(faltandoNoContexto({ servico: null, postcode: null, endereco: null, escopo: "fix door", fotos: 0 }), ["service", "postcode", "address", "scope", "photos"]);
  });
  it("finds the address the customer typed in the chat", () => {
    assert.equal(enderecoNasMensagens(["hi", "It's 14 Cricklewood Lane NW2 6XJ", "thanks"]), "It's 14 Cricklewood Lane NW2 6XJ");
    assert.equal(enderecoNasMensagens(["my postcode is NW2 6XJ"]), null);
  });
  it("reads the service from the lead subject", () => {
    assert.equal(servicoDoAssunto("Lead · Carpentry · Chloe Doak · NW2 6XJ"), "Carpentry");
    assert.equal(servicoDoAssunto("Re: boiler"), null);
  });
  it("asks for what is missing in one message, without asking for the postcode twice", () => {
    const t = textoPedeContexto("Chloe", ["postcode", "address", "photos"], "Carpentry");
    assert.match(t, /full property address/);
    assert.match(t, /photos/);
    assert.doesNotMatch(t, /postcode/);
    assert.doesNotMatch(t, /—/);
  });
});

describe("auto-quote: invites every matching partner, best first", () => {
  it("orders by rating, then compliance, then jobs done, with no cap (owner, 19 Oct 2026)", () => {
    const lista = [
      { id: "a", rating: 4.5, compliance_score: 100, jobs_completed: 3 },
      { id: "b", rating: 5, compliance_score: 0, jobs_completed: 0 },
      { id: "c", rating: 5, compliance_score: 100, jobs_completed: 1 },
      { id: "d", rating: 0, compliance_score: 100, jobs_completed: 9 },
      { id: "e", rating: null, compliance_score: 100, jobs_completed: 5 },
      { id: "f", rating: 3, compliance_score: 100, jobs_completed: 0 },
    ];
    assert.deepEqual(ranquearParceiros(lista).map((p) => p.id), ["e", "c", "b", "a", "f", "d"]);
    assert.deepEqual(ranquearParceiros(lista, 5).map((p) => p.id), ["e", "c", "b", "a", "f"]);
    assert.equal(ranquearParceiros(lista.slice(0, 2)).length, 2);
  });
});

describe("auto-quote: the bidding clock", () => {
  it("reminds partners once at 6h and tells the customer at 24h", () => {
    assert.equal(proximoPassoDoLeilao({ tags: [], horasDesdeConvite: 5.9, temLance: false }), null);
    assert.equal(proximoPassoDoLeilao({ tags: [], horasDesdeConvite: 6, temLance: false }), "lembrar_parceiros");
    assert.equal(proximoPassoDoLeilao({ tags: [TAG_LEMBROU_PARCEIROS], horasDesdeConvite: 12, temLance: false }), null);
    assert.equal(proximoPassoDoLeilao({ tags: [TAG_LEMBROU_PARCEIROS], horasDesdeConvite: 24, temLance: false }), "avisar_cliente");
    assert.equal(proximoPassoDoLeilao({ tags: [TAG_LEMBROU_PARCEIROS, TAG_SEM_LANCE], horasDesdeConvite: 40, temLance: false }), null);
  });
  it("a bid wins over any clock, even after the 24h notice", () => {
    assert.equal(proximoPassoDoLeilao({ tags: [], horasDesdeConvite: 1, temLance: true }), "precificar");
    assert.equal(proximoPassoDoLeilao({ tags: [TAG_SEM_LANCE], horasDesdeConvite: 30, temLance: true }), "precificar");
  });
  it("finished tickets are left alone", () => {
    for (const tag of [TAG_FIM, TAG_QUOTE_ENVIADA, TAG_PARA_REVISAR]) {
      assert.equal(proximoPassoDoLeilao({ tags: [tag], horasDesdeConvite: 30, temLance: true }), null);
    }
  });
  it("the 24h message never promises a time or a date", () => {
    const t = textoAindaCotando("Chloe", "Carpentry");
    assert.match(t, /very soon/);
    assert.doesNotMatch(t, /\b(today|tomorrow|hours?|minutes?|by \d|monday|tuesday|wednesday|thursday|friday|weekend|\d{1,2}(am|pm|:\d\d))\b/i);
    assert.doesNotMatch(t, /—/);
  });
});

describe("auto-quote: from bid to price", () => {
  it("adds a 30% margin and never goes under it", () => {
    for (const custo of [37, 100, 233, 419.99, 999]) {
      const total = precoDoLance(custo);
      assert.ok(margemDe(total, custo) >= 0.3, `${custo} → ${total}`);
    }
    assert.equal(precoDoLance(280), 400);
  });
  it("sends on its own only at or under £600 with full context", () => {
    assert.deepEqual(decidirEnvio({ total: 600, custo: 420, faltando: [], canalAberto: true }), { enviar: true, motivos: [] });
    assert.equal(decidirEnvio({ total: 605, custo: 420, faltando: [], canalAberto: true }).enviar, false);
    assert.equal(decidirEnvio({ total: 400, custo: 280, faltando: ["photos"], canalAberto: true }).enviar, false);
  });
  it("never sends under 30% margin or with the WhatsApp window closed", () => {
    assert.deepEqual(decidirEnvio({ total: 400, custo: 300, faltando: [], canalAberto: true }).motivos, ["margin under 30%"]);
    assert.deepEqual(decidirEnvio({ total: 400, custo: 280, faltando: [], canalAberto: false }).motivos, ["WhatsApp 24h window closed"]);
  });
  it("the quote message carries the price and no em dash", () => {
    const t = textoDaQuote({ nome: "Chloe", servico: "Carpentry", total: 400, referencia: "QT-2026-1200" });
    assert.match(t, /£400\.00/);
    assert.match(t, /QT-2026-1200/);
    assert.doesNotMatch(t, /—/);
  });
});

describe("auto-quote: quote text with the accept link (Fase 1 auto send)", () => {
  it("carries the link and no em dash", () => {
    const t = textoDaQuote({ nome: "Chloe", servico: "Carpentry", total: 480, referencia: "QT-2026-1180", link: "https://app.getfixfy.com/quote/respond?token=x&action=accept" });
    assert.match(t, /£480\.00/);
    assert.match(t, /accept it here: https:\/\/app\.getfixfy\.com\/quote\/respond\?token=x&action=accept/);
    assert.doesNotMatch(t, /[—–]/);
  });
});

describe("textoDaQuote com entrada (16/10/2026)", () => {
  it("com link e entrada diz entrada e saldo, sem travessão", () => {
    const t = textoDaQuote({ nome: "Chloe", servico: "Carpentry", total: 480, referencia: "QT-2026-1180", link: "https://app.getfixfy.com/quote/respond?token=x&action=accept", entrada: 240 });
    assert.match(t, /accept it here: https:\/\/app\.getfixfy\.com\/quote\/respond\?token=x&action=accept A £240\.00 deposit secures the booking and the £240\.00 balance is due when the job is done\./);
    assert.doesNotMatch(t, /—/);
  });
  it("sem entrada (conta de fatura) não fala de pagamento", () => {
    const t = textoDaQuote({ nome: "Chloe", total: 480, link: "https://x", entrada: 0 });
    assert.doesNotMatch(t, /deposit/);
  });
});
