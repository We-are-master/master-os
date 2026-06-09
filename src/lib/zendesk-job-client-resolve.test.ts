import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  clientNamesEqual,
  shouldReuseClientByEmail,
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
