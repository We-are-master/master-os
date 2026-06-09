import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { collectBillingAccountIds } from "@/lib/billing-account-metadata";
import type { Invoice } from "@/types/database";

function inv(
  opts: Partial<Invoice> & { client_name: string },
): Pick<Invoice, "source_account_id" | "job_reference" | "client_name"> {
  return {
    client_name: opts.client_name,
    source_account_id: opts.source_account_id,
    job_reference: opts.job_reference,
  };
}

describe("collectBillingAccountIds", () => {
  it("includes source_account_id and effective resolution ids", () => {
    const ids = collectBillingAccountIds(
      [
        inv({ client_name: "Uly Lo", source_account_id: "acc-hk", job_reference: "JOB-1" }),
        inv({ client_name: "Gary M.", job_reference: "JOB-2" }),
      ],
      { "JOB-2": "acc-ct" },
      { "Gary M.": "acc-ct" },
    );
    assert.ok(ids.includes("acc-hk"));
    assert.ok(ids.includes("acc-ct"));
    assert.equal(new Set(ids).size, 2);
  });

  it("dedupes ids from maps and invoices", () => {
    const ids = collectBillingAccountIds(
      [inv({ client_name: "A", source_account_id: "acc-1" })],
      { "JOB-1": "acc-1" },
      { A: "acc-1" },
    );
    assert.deepEqual(ids, ["acc-1"]);
  });
});
