import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isRetryableDecline, nextRetryAt, RETRY_SCHEDULE_DAYS } from "./stripe-card-charge";

describe("card retries only where the card networks allow it", () => {
  it("retries insufficient funds and generic declines", () => {
    assert.equal(isRetryableDecline("card_declined", "insufficient_funds"), true);
    assert.equal(isRetryableDecline("card_declined", "generic_decline"), true);
  });
  it("never retries lost, stolen, expired or do-not-try-again", () => {
    for (const d of ["lost_card", "stolen_card", "expired_card", "do_not_try_again", "fraudulent"]) {
      assert.equal(isRetryableDecline("card_declined", d), false, d);
    }
    assert.equal(isRetryableDecline("expired_card", null), false);
  });
  it("authentication required goes to the customer, not a retry", () => {
    assert.equal(isRetryableDecline("authentication_required", null), false);
  });
  it("schedule is 1, 3 and 7 days, then stops", () => {
    assert.deepEqual(RETRY_SCHEDULE_DAYS, [1, 3, 7]);
    const t0 = new Date("2026-10-12T10:00:00Z");
    assert.equal(nextRetryAt(0, t0), "2026-10-13T10:00:00.000Z");
    assert.equal(nextRetryAt(1, t0), "2026-10-15T10:00:00.000Z");
    assert.equal(nextRetryAt(2, t0), "2026-10-19T10:00:00.000Z");
    assert.equal(nextRetryAt(3, t0), null);
  });
});
