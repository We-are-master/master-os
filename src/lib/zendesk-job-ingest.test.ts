import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { shouldPreferExistingJobAddress } from "./zendesk-job-ingest";

describe("shouldPreferExistingJobAddress", () => {
  it("prefers full street over postcode-only ticket", () => {
    assert.equal(
      shouldPreferExistingJobAddress(
        "2 Sudbrook Gardens, Richmond, TW10 7DD",
        "TW10 7DD, UK",
      ),
      true,
    );
  });

  it("allows ticket update when job only has postcode", () => {
    assert.equal(
      shouldPreferExistingJobAddress("TW10 7DD", "2 Sudbrook Gardens, Richmond, TW10 7DD"),
      false,
    );
  });

  it("treats identical addresses as prefer existing", () => {
    assert.equal(
      shouldPreferExistingJobAddress("TW10 7DD, UK", "TW10 7DD, UK"),
      true,
    );
  });
});
