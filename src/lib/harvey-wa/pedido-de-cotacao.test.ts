import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { faltandoParaCotar, postcodeDaCotacao, situacaoDaCotacao, textoDaSituacao } from "./pedido-de-cotacao";

describe("request_quote: where the postcode comes from", () => {
  it("accepts what the customer typed in the chat", () => {
    assert.equal(postcodeDaCotacao("nw2 6xj", "hi, I'm at NW2 6XJ", []), "NW2 6XJ");
    assert.equal(postcodeDaCotacao("SW11 1AA", "it's in sw11", []), "SW11 1AA");
  });

  it("accepts the postcode on the lead record even if not typed (the Checkatrade case)", () => {
    assert.equal(postcodeDaCotacao("E17 4AB", "can you fix my fence?", ["E17 4AB"]), "E17 4AB");
    assert.equal(postcodeDaCotacao("e174ab", "", [null, "e17 4ab"]), "E17 4AB");
  });

  it("uses the only known postcode when the model left it out", () => {
    assert.equal(postcodeDaCotacao("", "photos attached", ["N1 9GU"]), "N1 9GU");
    assert.equal(postcodeDaCotacao(undefined, "photos attached", ["N1 9GU", "E3 2AA"]), null);
  });

  it("fills a half postcode from the lead record", () => {
    assert.equal(postcodeDaCotacao("E17", "I'm in E17", ["E17 4AB"]), "E17 4AB");
    assert.equal(postcodeDaCotacao("E17", "nothing typed", ["E17 4AB"]), "E17 4AB");
  });

  it("never takes an invented postcode", () => {
    assert.equal(postcodeDaCotacao("W1A 1AA", "fix my door please", ["E17 4AB"]), null);
    assert.equal(postcodeDaCotacao("W1A 1AA", "fix my door please", []), null);
    assert.equal(postcodeDaCotacao("", "fix my door please", []), null);
  });
});

describe("request_quote: the minimum to ask partners", () => {
  it("description + postcode + photos is enough (no address, occupancy or timing)", () => {
    assert.deepEqual(faltandoParaCotar({ descricao: "Replace the rotten fence panels at the back", postcode: "E17 4AB", fotos: 2, semFotos: null }), []);
  });
  it("a reason for no photos replaces the photos", () => {
    assert.deepEqual(faltandoParaCotar({ descricao: "Replace the rotten fence panels", postcode: "E17 4AB", fotos: 0, semFotos: "phone broken" }), []);
  });
  it("lists what is missing", () => {
    assert.deepEqual(faltandoParaCotar({ descricao: "", postcode: null, fotos: 0, semFotos: "" }), ["what exactly needs doing", "their postcode", "a few photos or a short video of the job"]);
  });
});

describe("get_quote_status: where the quote is", () => {
  it("maps the OS status", () => {
    assert.equal(situacaoDaCotacao({ status: "draft", convidados: 0, lances: 0 }), "inviting");
    assert.equal(situacaoDaCotacao({ status: "bidding", convidados: 0, lances: 0 }), "inviting");
    assert.equal(situacaoDaCotacao({ status: "bidding", convidados: 3, lances: 0 }), "waiting_bids");
    assert.equal(situacaoDaCotacao({ status: "quote_ready", convidados: 3, lances: 1 }), "priced");
    assert.equal(situacaoDaCotacao({ status: "awaiting_customer", convidados: 3, lances: 1 }), "sent");
    assert.equal(situacaoDaCotacao({ status: "converted_to_job", convidados: 3, lances: 1 }), "closed");
  });
  it("says it simply, with no time promised and no em dashes", () => {
    for (const s of ["inviting", "waiting_bids", "priced", "sent", "closed"] as const) {
      const t = textoDaSituacao(s, { convidados: 3, lances: 0 });
      assert.doesNotMatch(t, /[—–]/);
      assert.doesNotMatch(t, /\b(today|tomorrow|hours?|minutes?)\b/i);
    }
    assert.match(textoDaSituacao("waiting_bids", { convidados: 3, lances: 0 }), /3 professionals/);
  });
});
