import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientNamesEqual,
  shouldReuseClientByEmail,
  pickClientMatchedByEmail,
} from "./zendesk-job-client-resolve";

describe("clientNamesEqual", () => {
  it("matches case-insensitively", () => {
    assert.equal(clientNamesEqual("Patrick", "patrick"), true);
  });

  it("rejects different names", () => {
    assert.equal(clientNamesEqual("Patrick", "Checkatrade"), false);
  });
});

describe("shouldReuseClientByEmail", () => {
  it("reuses when names match", () => {
    assert.equal(shouldReuseClientByEmail("Patrick", "Patrick", "Checkatrade"), true);
  });

  it("rejects corporate account placeholder", () => {
    assert.equal(shouldReuseClientByEmail("Checkatrade", "Patrick", "Checkatrade"), false);
  });

  it("rejects when ticket name differs from linked client", () => {
    assert.equal(shouldReuseClientByEmail("Checkatrade", "Patrick", null), false);
  });

  it("reuses empty existing name (backfill path)", () => {
    assert.equal(shouldReuseClientByEmail("", "Patrick", "Checkatrade"), true);
  });
});

describe("pickClientMatchedByEmail", () => {
  const rohit = { id: "rohit", full_name: "Rohit Anand" };
  const thomas = { id: "thomas", full_name: "Thomas Barton" };

  it("picks the row whose name matches the ticket", () => {
    assert.equal(pickClientMatchedByEmail([thomas, rohit], "Rohit Anand", null)?.id, "rohit");
  });

  it("ignores row order", () => {
    assert.equal(pickClientMatchedByEmail([rohit, thomas], "Thomas Barton", null)?.id, "thomas");
  });

  it("returns null when no shared-email row belongs to this customer", () => {
    assert.equal(pickClientMatchedByEmail([rohit, thomas], "Kate Jordan", null), null);
  });

  it("still reuses a single unnamed row (backfill path)", () => {
    assert.equal(pickClientMatchedByEmail([{ id: "blank", full_name: "" }], "Patrick", null)?.id, "blank");
  });

  it("never reuses the corporate placeholder", () => {
    const rows = [{ id: "corp", full_name: "Checkatrade" }];
    assert.equal(pickClientMatchedByEmail(rows, "Patrick", "Checkatrade"), null);
  });

  it("prefers the named row over an unnamed one", () => {
    const rows = [{ id: "blank", full_name: "" }, rohit];
    assert.equal(pickClientMatchedByEmail(rows, "Rohit Anand", null)?.id, "rohit");
  });

  it("handles no match at all", () => {
    assert.equal(pickClientMatchedByEmail([], "Rohit Anand", null), null);
  });
});

describe("pickClientMatchedByEmail vs a guarda do placeholder corporativo", () => {
  it("nao reusa o placeholder nem quando o ticket vem com o nome da conta", () => {
    const rows = [{ id: "corp", full_name: "Checkatrade" }];
    assert.equal(pickClientMatchedByEmail(rows, "Checkatrade", "Checkatrade"), null);
  });

  it("escolhe o cliente real e ignora o placeholder que divide o email", () => {
    const rows = [{ id: "corp", full_name: "Checkatrade" }, { id: "patrick", full_name: "Patrick" }];
    assert.equal(pickClientMatchedByEmail(rows, "Patrick", "Checkatrade")?.id, "patrick");
  });
});
