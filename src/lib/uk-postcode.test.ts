import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  propertyAddressWithPostcode,
  resolvePropertyPostcode,
} from "./uk-postcode";

describe("resolvePropertyPostcode", () => {
  it("uses explicit postcode field when address has no postcode", () => {
    assert.equal(
      resolvePropertyPostcode("EC1V 2NX", "124 City Road"),
      "EC1V 2NX",
    );
  });

  it("prefers explicit postcode field over address", () => {
    assert.equal(
      resolvePropertyPostcode("W1K 1BE", "14 Park Lane, London SW1A 1AA"),
      "W1K 1BE",
    );
  });

  it("falls back to postcode embedded in address", () => {
    assert.equal(
      resolvePropertyPostcode(null, "14 Park Lane, London W1K 1BE"),
      "W1K 1BE",
    );
  });

  it("returns null when neither field has a postcode", () => {
    assert.equal(resolvePropertyPostcode("", "124 city road"), null);
  });
});

describe("propertyAddressWithPostcode", () => {
  it("appends postcode when missing from address", () => {
    assert.equal(
      propertyAddressWithPostcode("124 City Road", "EC1V 2NX"),
      "124 City Road, EC1V 2NX",
    );
  });

  it("does not duplicate postcode already in address", () => {
    assert.equal(
      propertyAddressWithPostcode("14 Park Lane, London W1K 1BE", "W1K 1BE"),
      "14 Park Lane, London W1K 1BE",
    );
  });
});
