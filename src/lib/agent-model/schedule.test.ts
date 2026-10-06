/**
 * A regra que decide Schedule A (Fixfy agente) ou B (Fixfy principal).
 * Errar para A põe o nome do parceiro num documento de conta de empresa;
 * errar para B mantém o documento de sempre. Por isso tudo que é dúvida é B.
 */
import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { classifyWorkSchedule, agentModelEnabled, resolveWorkSchedules } from "./schedule";
import type { SupabaseClient } from "@supabase/supabase-js";

const FIXFY = "11111111-1111-1111-1111-111111111111";
const HOUSEKEEP = "22222222-2222-2222-2222-222222222222";
const on = { enabled: true, effectiveFrom: null };

describe("classifyWorkSchedule", () => {
  it("model off: always B", () => {
    assert.equal(classifyWorkSchedule({ hasClient: true, sourceAccountId: null, fixfyAccountId: FIXFY }, { enabled: false }), "B");
  });

  it("direct client without a business account: A", () => {
    assert.equal(classifyWorkSchedule({ hasClient: true, sourceAccountId: null, fixfyAccountId: FIXFY }, on), "A");
    assert.equal(classifyWorkSchedule({ hasClient: true, sourceAccountId: "  ", fixfyAccountId: FIXFY }, on), "A");
  });

  it("client under the Fixfy corporate account (website, Harvey): A", () => {
    assert.equal(classifyWorkSchedule({ hasClient: true, sourceAccountId: FIXFY, fixfyAccountId: FIXFY }, on), "A");
  });

  it("client under any other account (Housekeep, Checkatrade, agents): B", () => {
    assert.equal(classifyWorkSchedule({ hasClient: true, sourceAccountId: HOUSEKEEP, fixfyAccountId: FIXFY }, on), "B");
    // Sem conta Fixfy conhecida, conta de origem qualquer continua B.
    assert.equal(classifyWorkSchedule({ hasClient: true, sourceAccountId: HOUSEKEEP, fixfyAccountId: null }, on), "B");
  });

  it("job without a client record: B", () => {
    assert.equal(classifyWorkSchedule({ hasClient: false, sourceAccountId: null, fixfyAccountId: FIXFY }, on), "B");
  });

  it("optional cut-off date: jobs created before it stay B", () => {
    const opts = { enabled: true, effectiveFrom: "2026-10-06" };
    const base = { hasClient: true, sourceAccountId: null, fixfyAccountId: FIXFY };
    assert.equal(classifyWorkSchedule({ ...base, jobCreatedAt: "2026-10-05T23:00:00Z" }, opts), "B");
    assert.equal(classifyWorkSchedule({ ...base, jobCreatedAt: "2026-10-06T08:00:00Z" }, opts), "A");
    assert.equal(classifyWorkSchedule({ ...base, jobCreatedAt: null }, opts), "A");
  });
});

describe("agentModelEnabled / resolveWorkSchedules", () => {
  const before = process.env.FIXFY_AGENT_MODEL;
  afterEach(() => {
    if (before === undefined) delete process.env.FIXFY_AGENT_MODEL;
    else process.env.FIXFY_AGENT_MODEL = before;
  });

  it("is off unless FIXFY_AGENT_MODEL=on", () => {
    delete process.env.FIXFY_AGENT_MODEL;
    assert.equal(agentModelEnabled(), false);
    process.env.FIXFY_AGENT_MODEL = "1";
    assert.equal(agentModelEnabled(), false);
    process.env.FIXFY_AGENT_MODEL = "ON";
    assert.equal(agentModelEnabled(), true);
  });

  it("model off: everything B without touching the database", async () => {
    delete process.env.FIXFY_AGENT_MODEL;
    const boom = { from() { throw new Error("must not query"); } } as unknown as SupabaseClient;
    const map = await resolveWorkSchedules(boom, [{ id: "j1", client_id: "c1" }]);
    assert.equal(map.get("j1"), "B");
  });

  it("model on: one clients query, Fixfy account and missing clients classified", async () => {
    process.env.FIXFY_AGENT_MODEL = "on";
    const prevAcc = process.env.FIXFY_ACCOUNT_ID;
    process.env.FIXFY_ACCOUNT_ID = FIXFY;
    const rows = [
      { id: "c-direct", source_account_id: null },
      { id: "c-site", source_account_id: FIXFY },
      { id: "c-hk", source_account_id: HOUSEKEEP },
    ];
    let calls = 0;
    const fake = {
      from(table: string) {
        assert.equal(table, "clients");
        calls++;
        return { select: () => ({ in: async () => ({ data: rows, error: null }) }) };
      },
    } as unknown as SupabaseClient;
    try {
      const map = await resolveWorkSchedules(fake, [
        { id: "j1", client_id: "c-direct" },
        { id: "j2", client_id: "c-site" },
        { id: "j3", client_id: "c-hk" },
        { id: "j4", client_id: "c-gone" },
        { id: "j5", client_id: null },
      ]);
      assert.equal(calls, 1);
      assert.deepEqual(
        ["j1", "j2", "j3", "j4", "j5"].map((k) => map.get(k)),
        ["A", "A", "B", "B", "B"],
      );
    } finally {
      if (prevAcc === undefined) delete process.env.FIXFY_ACCOUNT_ID;
      else process.env.FIXFY_ACCOUNT_ID = prevAcc;
    }
  });
});
