import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { invoicePayLinkForClient, isStripeTestLink } from "./pay-link-url";

describe("invoicePayLinkForClient", () => {
  it("troca Payment Link de teste pelo /pay da fatura", () => {
    const url = invoicePayLinkForClient("RCP-2026-886", "https://buy.stripe.com/test_9AQ5kM2bX");
    assert.match(url, /\/pay\/RCP-2026-886$/);
  });

  it("troca sessão de checkout de teste gravada", () => {
    const url = invoicePayLinkForClient("RCP-1", "https://checkout.stripe.com/c/pay/cs_test_a16dzx#abc");
    assert.match(url, /\/pay\/RCP-1$/);
  });

  it("mantém /pay com pct", () => {
    const stored = "https://app.getfixfy.com/pay/RCP-1?pct=50";
    assert.equal(invoicePayLinkForClient("RCP-1", stored), stored);
  });

  it("mantém Payment Link live", () => {
    const stored = "https://buy.stripe.com/5kA3cf9Xy";
    assert.equal(invoicePayLinkForClient("RCP-1", stored), stored);
  });

  it("vazio continua vazio", () => {
    assert.equal(invoicePayLinkForClient("RCP-1", null), "");
    assert.equal(invoicePayLinkForClient("RCP-1", "  "), "");
  });

  it("sem referência devolve o gravado", () => {
    const stored = "https://buy.stripe.com/test_abc";
    assert.equal(invoicePayLinkForClient("", stored), stored);
  });
});

describe("isStripeTestLink", () => {
  it("reconhece só link de teste", () => {
    assert.equal(isStripeTestLink("https://buy.stripe.com/test_abc"), true);
    assert.equal(isStripeTestLink("https://buy.stripe.com/abc"), false);
    assert.equal(isStripeTestLink("https://checkout.stripe.com/c/pay/cs_live_abc"), false);
  });
});
