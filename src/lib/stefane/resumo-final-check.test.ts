import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { montarResumoFinal, resumoFinalRoda, runResumoFinalStefane, STEFANE_RESUMO_FINAL_ON, type EntradaResumo } from "./resumo-final-check";

const base = (over: Partial<EntradaResumo> = {}): EntradaResumo => ({
  reference: "JOB-9001",
  title: "Replace kitchen tap",
  partnerName: "Acme Plumbing",
  customerPrice: 180,
  partnerCost: 110,
  startReport: { template: "general", submitted_at: "2026-11-10T09:00:00Z", photos: { before: ["a.jpg", "b.jpg"] } },
  finalReport: {
    template: "general",
    submitted_at: "2026-11-10T11:00:00Z",
    photos: { after: ["c.jpg", "d.jpg", "e.jpg"] },
    description: "Replaced the kitchen tap and tested for leaks.",
    completion_status: "complete",
  },
  reportGate: { ok: true },
  decisao: { acao: "aprovar", pagoTotal: false, saldo: 90 },
  ...over,
});

/** Admin que estoura em qualquer acesso: prova que o desligado não toca no banco. */
const adminQueNaoPodeSerTocado = new Proxy({} as SupabaseClient, {
  get() {
    throw new Error("o banco foi tocado com a chave desligada");
  },
});

async function comEnv<T>(env: Record<string, string | undefined>, fn: () => Promise<T>): Promise<T> {
  const antes = Object.fromEntries(Object.keys(env).map((k) => [k, process.env[k]]));
  for (const [k, v] of Object.entries(env)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  try {
    return await fn();
  } finally {
    for (const [k, v] of Object.entries(antes)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

test("chave desligada por padrão: sem variável, vazia ou diferente de 1 não roda", () => {
  assert.equal(STEFANE_RESUMO_FINAL_ON({}), false);
  for (const v of ["", "0", "true", "on", " "]) assert.equal(STEFANE_RESUMO_FINAL_ON({ STEFANE_RESUMO_FINAL: v }), false, v);
  assert.deepEqual(resumoFinalRoda({}), { roda: false, motivo: "desligado" });
  assert.deepEqual(resumoFinalRoda({ FINAL_CHECK_AUTO: "1" }), { roda: false, motivo: "desligado" });
});

test("ligada com o final check automático ligado: fica com o automático", () => {
  assert.deepEqual(resumoFinalRoda({ STEFANE_RESUMO_FINAL: "1", FINAL_CHECK_AUTO: "1" }), { roda: false, motivo: "final_check_auto" });
  assert.deepEqual(resumoFinalRoda({ STEFANE_RESUMO_FINAL: "1", FINAL_CHECK_AUTO: "0" }), { roda: true });
  assert.deepEqual(resumoFinalRoda({ STEFANE_RESUMO_FINAL: " 1 " }), { roda: true });
});

test("desligada: o runner volta sem tocar no banco nem no Zendesk", async () => {
  const r = await comEnv({ STEFANE_RESUMO_FINAL: undefined, FINAL_CHECK_AUTO: undefined }, () =>
    runResumoFinalStefane(adminQueNaoPodeSerTocado, "job-1", { origem: "report_submitted" }),
  );
  assert.deepEqual(r, { feito: "desligado", motivo: "desligado" });
});

test("as duas chaves ligadas: o runner não roda, o automático decide", async () => {
  const r = await comEnv({ STEFANE_RESUMO_FINAL: "1", FINAL_CHECK_AUTO: "1" }, () =>
    runResumoFinalStefane(adminQueNaoPodeSerTocado, "job-1", { origem: "sweep" }),
  );
  assert.deepEqual(r, { feito: "desligado", motivo: "final_check_auto" });
});

test("uma vez por job: com a marca no histórico, não lê mais nada nem escreve", async () => {
  const tabelas: string[] = [];
  const consulta = {
    select: () => consulta,
    eq: () => consulta,
    then: (ok: (v: unknown) => unknown) => Promise.resolve({ count: 1, error: null }).then(ok),
  };
  const admin = {
    from: (t: string) => {
      tabelas.push(t);
      if (t !== "audit_logs") throw new Error(`não devia ler ${t}`);
      return consulta;
    },
  } as unknown as SupabaseClient;
  const r = await comEnv({ STEFANE_RESUMO_FINAL: "1", FINAL_CHECK_AUTO: undefined }, () =>
    runResumoFinalStefane(admin, "job-1", { origem: "sweep" }),
  );
  assert.deepEqual(r, { feito: "ja_feito" });
  assert.deepEqual(tabelas, ["audit_logs"]);
});

test("relatório limpo: uma linha com parceiro, preço, fotos e nada a olhar", () => {
  const r = montarResumoFinal(base());
  assert.equal(r.linha, "Approve final report: JOB-9001, Acme Plumbing, £180.00, photos 2 start / 3 final, no issues found");
  assert.deepEqual(r.pontos, []);
  assert.match(r.nota, /Partner: Acme Plumbing/);
  assert.match(r.nota, /Price: £180\.00 to the customer \(partner £110\.00\)/);
  assert.match(r.nota, /Photos: 2 at start, 3 at the end/);
  assert.match(r.nota, /Final report text: yes \("Replaced the kitchen tap/);
  assert.match(r.nota, /Certificate: not needed/);
  assert.match(r.nota, /Nothing was approved, charged or sent/);
});

test("mesmo job, mesmo resumo (determinístico)", () => {
  assert.deepEqual(montarResumoFinal(base()), montarResumoFinal(base()));
});

test("relatório aponta trabalho por fazer: entra no que olhar", () => {
  const r = montarResumoFinal(
    base({
      finalReport: {
        template: "general",
        photos: { after: ["c.jpg"] },
        description: "Tap fitted but need to come back for the sealant.",
        completion_status: "partially_complete",
        follow_up_required: true,
      },
      decisao: { acao: "equipe", codigo: "report_flags", motivo: "the report flags: ..." },
    }),
  );
  assert.ok(r.pontos.includes('completion status "partially complete"'));
  assert.ok(r.pontos.includes("follow-up required"));
  assert.ok(r.pontos.some((p) => p.startsWith("partner note:")));
  // O motivo da decisão não repete o que o relatório já disse.
  assert.ok(!r.pontos.includes("the report flags: ..."));
  assert.match(r.linha, /check: completion status "partially complete"; follow-up required \(\+1 more\)$/);
});

test("certificado sem anexo: falta, e diz quando o parceiro marcou emitido", () => {
  const r = montarResumoFinal(
    base({
      title: "EICR",
      startReport: { template: "certificate", photos: { before: ["a.jpg"] } },
      finalReport: { template: "certificate", photos: {}, inspection_summary: "Full EICR on the flat.", certificate_issued: true, certificate_outcome: "satisfactory" },
    }),
  );
  assert.ok(r.pontos.includes("certificate missing"));
  assert.match(r.nota, /Certificate: MISSING \(partner says it was issued, no file attached\)/);
});

test("certificado anexado: presente e não conta como foto do fim", () => {
  const r = montarResumoFinal(
    base({
      startReport: { template: "certificate", photos: { before: ["a.jpg"] } },
      finalReport: { template: "certificate", photos: { certificate: ["cert.pdf"] }, inspection_summary: "Gas safety check.", certificate_issued: true },
    }),
  );
  assert.deepEqual(r.pontos, []);
  assert.match(r.nota, /Certificate: attached \(1 file\)/);
  assert.match(r.linha, /photos 1 start \/ 0 final/);
});

test("limpeza não tem campo de texto: não cobra texto", () => {
  const r = montarResumoFinal(
    base({
      startReport: { template: "cleaner", photos: { kitchen: ["a.jpg"], bedrooms: ["b.jpg"] } },
      finalReport: { template: "cleaner", photos: { kitchen: ["c.jpg", "d.jpg"] }, job_complete: true },
      decisao: { acao: "equipe", codigo: "platform", motivo: "platform job: the report goes to the client platform" },
    }),
  );
  assert.deepEqual(r.pontos, []);
  assert.match(r.nota, /Final report text: not asked/);
  assert.match(r.nota, /Platform: this report goes to the client platform after you approve/);
});

test("portão do relatório e motivo de cobrança entram no que olhar", () => {
  const r = montarResumoFinal(
    base({
      finalReport: { template: "general", photos: {}, completion_status: "complete" },
      reportGate: { ok: false, message: "Report is not complete yet: work description written, after photos added." },
      decisao: { acao: "equipe", codigo: "price_mismatch", motivo: "job total £180.00 differs from its invoices £150.00" },
    }),
  );
  assert.equal(r.pontos[0], "Report is not complete yet: work description written, after photos added.");
  assert.ok(r.pontos.includes("job total £180.00 differs from its invoices £150.00"));
  assert.match(r.nota, /Final report text: NO/);
});

test("a linha cabe na nota do Action Required", () => {
  const longo = "x".repeat(400);
  const r = montarResumoFinal(base({ partnerName: "P", reportGate: { ok: false, message: longo }, decisao: { acao: "equipe", codigo: "complaint", motivo: longo } }));
  assert.ok(r.linha.length < 280, String(r.linha.length));
});
