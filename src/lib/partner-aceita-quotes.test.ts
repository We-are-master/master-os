import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { aceitaQuotes, soQuemAceitaQuotes } from "./partner-aceita-quotes";

function sbCom(linhas: Array<{ id: string; job_preferences: unknown }>): SupabaseClient {
  return {
    from: () => ({ select: () => ({ in: async () => ({ data: linhas, error: null }) }) }),
  } as unknown as SupabaseClient;
}

describe("aceitaQuotes", () => {
  it("sem preferência gravada, aceita", () => {
    assert.equal(aceitaQuotes(null), true);
    assert.equal(aceitaQuotes({}), true);
  });
  it("só recusa com false explícito", () => {
    assert.equal(aceitaQuotes({ receiveLeads: false }), false);
    assert.equal(aceitaQuotes({ receiveLeads: true }), true);
  });
});

describe("soQuemAceitaQuotes", () => {
  it("tira quem só recebe job fechado e mantém a ordem", async () => {
    const sb = sbCom([
      { id: "a", job_preferences: null },
      { id: "b", job_preferences: { receiveLeads: false } },
      { id: "c", job_preferences: { receiveLeads: true } },
    ]);
    assert.deepEqual(await soQuemAceitaQuotes(sb, ["c", "b", "a"]), ["c", "a"]);
  });
  it("lista vazia não consulta", async () => {
    assert.deepEqual(await soQuemAceitaQuotes(sbCom([]), []), []);
  });
});
