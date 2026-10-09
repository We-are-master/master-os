import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { detectarB2B, ehEmailDeEmpresa } from "./b2b-deteccao";
import { nomeParaTabela, precoComDesconto } from "./catalogo-b2b";

describe("detectarB2B", () => {
  it("letting agent is B2B on its own", () => {
    const d = detectarB2B({ texto: "Hi, we're a letting agent in Clapham and need end of tenancy cleans" });
    assert.equal(d.potencial, true);
    assert.ok(d.sinais.includes("letting or estate agent"));
  });

  it("someone moving out of their flat is not B2B", () => {
    const d = detectarB2B({ texto: "Hi, I'm moving out next week and need an end of tenancy clean for my 2 bed flat", email: "jane@gmail.com" });
    assert.equal(d.potencial, false);
  });

  it("a single landlord alone is not enough, a landlord with a business email is", () => {
    assert.equal(detectarB2B({ texto: "I'm a landlord, need a gas safety certificate" }).potencial, false);
    assert.equal(detectarB2B({ texto: "I'm a landlord, need a gas safety certificate", email: "tom@thornproperties.co.uk" }).potencial, true);
  });

  it("we manage 40 flats", () => {
    const d = detectarB2B({ texto: "We manage about 40 flats in south London and want a regular cleaner" });
    assert.equal(d.potencial, true);
    assert.ok(d.pontos >= 4);
  });

  it("personal email domains are not business", () => {
    assert.equal(ehEmailDeEmpresa("a@hotmail.co.uk"), false);
    assert.equal(ehEmailDeEmpresa("a@kvadrat.org"), true);
    assert.equal(ehEmailDeEmpresa("leo@getfixfy.com"), false);
  });
});

describe("partner price list", () => {
  it("takes 5% off every pound value", () => {
    assert.equal(precoComDesconto("£223.00"), "£211.85");
    assert.equal(precoComDesconto("£90/h"), "£85.50/h");
    assert.equal(precoComDesconto("from £1,200"), "from £1,140.00");
  });

  it("cleans the company name", () => {
    assert.equal(nomeParaTabela('  BF <Property>  Ltd '), "BF Property Ltd");
    assert.equal(nomeParaTabela("x"), null);
  });
});
