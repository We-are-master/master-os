import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildPartnerSearchOrFilter, partnerPhoneSearchPattern } from "./partner-search";

/** Mimics Postgres ILIKE for the patterns this module builds. */
function ilike(value: string, pattern: string): boolean {
  const rx = pattern
    .split("%")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join(".*");
  return new RegExp(`^${rx}$`, "i").test(value);
}

describe("partnerPhoneSearchPattern", () => {
  it("finds the same number however it was stored", () => {
    const pattern = partnerPhoneSearchPattern("07984493483")!;
    for (const stored of ["07984493483", "07984 493483", "+44 7984 493483", "+447984493483"]) {
      assert.equal(ilike(stored, pattern), true, stored);
    }
  });

  it("finds the number however it was typed", () => {
    for (const typed of ["07984493483", "07984 493483", "+44 7984 493483", "7984493483"]) {
      assert.equal(ilike("07984 493483", partnerPhoneSearchPattern(typed)!), true, typed);
    }
  });

  it("does not match a different number", () => {
    assert.equal(ilike("07494977223", partnerPhoneSearchPattern("07984493483")!), false);
  });

  it("gives up on anything too short to be a number", () => {
    assert.equal(partnerPhoneSearchPattern("abc"), null);
    assert.equal(partnerPhoneSearchPattern("123"), null);
  });
});

describe("buildPartnerSearchOrFilter", () => {
  it("covers name, email, address and tax numbers", () => {
    const filter = buildPartnerSearchOrFilter("Anthony")!;
    for (const column of ["company_name", "contact_name", "email", "partner_address", "location", "utr", "crn"]) {
      assert.ok(filter.includes(`${column}.ilike.%Anthony%`), column);
    }
  });

  it("adds the phone clause only when the term looks like a number", () => {
    assert.ok(buildPartnerSearchOrFilter("07494977223")!.includes("phone.ilike."));
    assert.equal(buildPartnerSearchOrFilter("Anthony")!.includes("phone.ilike."), false);
  });

  it("strips PostgREST metacharacters before building clauses", () => {
    const filter = buildPartnerSearchOrFilter("a,status.eq.active")!;
    assert.equal(filter.includes("a,status.eq.active"), false);
  });

  it("returns null for an empty search", () => {
    assert.equal(buildPartnerSearchOrFilter("   "), null);
    assert.equal(buildPartnerSearchOrFilter(null), null);
  });
});
