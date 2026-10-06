import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildAgentReceiptView } from "./receipt-view";
import { receiptPartyFromPartner } from "./receipt-party";

const party = { professionalName: "Sparkle Clean Ltd", businessAddress: "12 Mare Street, London E8 4RP", vatNumber: null };

describe("buildAgentReceiptView (Schedule A receipt)", () => {
  it("not VAT registered: full price lines, 'No VAT charged', issued as agent, no fee", () => {
    const v = buildAgentReceiptView({ party, jobTitle: "End of tenancy clean", clientPrice: 266, extrasAmount: 76, invoiceAmount: 342, paid: true });
    assert.equal(v.issuerLine, "Issued by GETFIXFY LTD (Fixfy) as agent for Sparkle Clean Ltd");
    assert.deepEqual(v.lines, [
      { label: "End of tenancy clean", amount: 266 },
      { label: "Extras", amount: 76 },
    ]);
    assert.equal(v.professionalPrice, 342);
    assert.equal(v.vatLine, "No VAT charged: Sparkle Clean Ltd is not VAT registered.");
    assert.equal(v.vatAmount, null);
    assert.equal(v.partOfPrice, false);
    assert.match(v.paymentNote, /limited payment collection agent for Sparkle Clean Ltd/);
    assert.match(v.paymentNote, /No Fixfy fee/);
    assert.doesNotMatch(JSON.stringify(v), /platform fee|478 1027 82/i);
  });

  it("VAT registered: shows their VAT number and VAT included (1/6 of the price)", () => {
    const v = buildAgentReceiptView({
      party: { ...party, vatNumber: "GB123456789" },
      jobTitle: "Gas safety certificate",
      clientPrice: 244,
      invoiceAmount: 122,
      paid: true,
    });
    assert.equal(v.vatNumber, "GB123456789");
    assert.equal(v.vatLine, "Includes VAT at 20%");
    assert.equal(v.vatAmount, 40.67);
    assert.equal(v.partOfPrice, true);
    assert.match(v.paymentNote, /for the amount paid/);
  });

  it("no professional yet: generic wording, no VAT line", () => {
    const v = buildAgentReceiptView({ party: { professionalName: null, businessAddress: null, vatNumber: null }, jobTitle: "Deep clean", clientPrice: 194, invoiceAmount: 97, paid: true });
    assert.equal(v.professionalName, null);
    assert.equal(v.vatLine, null);
    assert.match(v.issuerLine, /independent professional who does your job/);
  });

  it("document bigger than the job price: the document is the price", () => {
    const v = buildAgentReceiptView({ party, jobTitle: "Repairs", clientPrice: 180, invoiceAmount: 360, paid: false });
    assert.deepEqual(v.lines, [{ label: "Repairs", amount: 360 }]);
    assert.equal(v.partOfPrice, false);
  });
});

describe("receiptPartyFromPartner", () => {
  it("uses company name, address and VAT only when registered", () => {
    assert.deepEqual(
      receiptPartyFromPartner({ company_name: "Sparkle", contact_name: "Ana", partner_address: " 1 St ", vat_number: "GB1", vat_registered: true }),
      { professionalName: "Sparkle", businessAddress: "1 St", vatNumber: "GB1" },
    );
    assert.equal(receiptPartyFromPartner({ company_name: "", contact_name: "Ana", vat_number: "GB1", vat_registered: false }).vatNumber, null);
    assert.equal(receiptPartyFromPartner({ company_name: "", contact_name: "Ana" }).professionalName, "Ana");
  });
});
