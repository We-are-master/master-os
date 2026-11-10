/**
 *   npx tsx --test src/lib/alarmes-portoes.test.ts
 *
 * Alarmes dos portões do dono (10/11/2026): quem alarma, quem não, a trava de uma
 * vez por job e o desligado que não lê nem escreve nada.
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { alarmesDosPortoes, alarmesLigados, esperandoSinal, passadaDosAlarmes, type ContextoDosAlarmes, type JobDoAlarme } from "./alarmes-portoes";

const AGORA = new Date("2026-11-10T12:00:00Z");
const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3_600_000).toISOString();

const ctx = (extra: Partial<ContextoDosAlarmes> = {}): ContextoDosAlarmes => ({
  contas: new Map([
    ["b2b", { id: "b2b", process_type: "b2b", collection_mode: "invoice" }],
    ["plat", { id: "plat", process_type: "platform", collection_mode: "invoice" }],
    ["fixfy", { id: "fixfy", process_type: "direct", collection_mode: "card_upfront" }],
  ]),
  pagosNoLivro: new Set(),
  quoteEsperandoSinal: new Set(),
  voltouParaUnassigned: new Map(),
  ...extra,
});

const job = (j: Partial<JobDoAlarme>): JobDoAlarme => ({
  id: "j1",
  reference: "JOB-1",
  status: "unassigned",
  created_at: horasAtras(3),
  updated_at: horasAtras(3),
  account_id: "b2b",
  external_source: "zendesk",
  external_ref: "51000",
  ...j,
});

describe("alarmes dos portões", () => {
  it("flag: só ALARMES_PORTOES=1 liga", () => {
    assert.equal(alarmesLigados({}), false);
    assert.equal(alarmesLigados({ ALARMES_PORTOES: "0" }), false);
    assert.equal(alarmesLigados({ ALARMES_PORTOES: "true" }), false);
    assert.equal(alarmesLigados({ ALARMES_PORTOES: " 1 " }), true);
  });

  it("A: Unassigned há mais de 2h em conta B2B ou plataforma alarma; com menos, não", () => {
    const [a] = alarmesDosPortoes([job({})], ctx(), AGORA);
    assert.equal(a.portao, "alocar");
    assert.equal(a.ticketId, "51000");
    assert.match(a.acao, /^Allocate a partner: JOB-1 /);
    assert.equal(alarmesDosPortoes([job({ account_id: "plat" })], ctx(), AGORA).length, 1);
    assert.equal(alarmesDosPortoes([job({ created_at: horasAtras(1.5) })], ctx(), AGORA).length, 0);
  });

  it("A: conta que cobra no cartão só alarma com o sinal pago", () => {
    const b2c = job({ account_id: "fixfy" });
    assert.equal(alarmesDosPortoes([b2c], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([{ ...b2c, customer_deposit_paid: true }], ctx(), AGORA).length, 1);
    assert.equal(alarmesDosPortoes([{ ...b2c, finance_status: "partial" }], ctx(), AGORA).length, 1);
    // A flag falha na reserva do site (JOB-9794): o livro de pagamentos vale.
    assert.equal(alarmesDosPortoes([b2c], ctx({ pagosNoLivro: new Set(["j1"]) }), AGORA).length, 1);
    // Sem conta = B2C.
    assert.equal(esperandoSinal(job({ account_id: null }), ctx()), true);
  });

  it("A: quote esperando a entrada e sinal combinado não pago seguram o alarme", () => {
    assert.equal(alarmesDosPortoes([job({ account_id: "fixfy", customer_deposit_paid: true })], ctx({ quoteEsperandoSinal: new Set(["j1"]) }), AGORA).length, 0);
    assert.equal(esperandoSinal(job({ account_id: null, customer_deposit: 272.5 }), ctx()), true);
    // B2B não cobra sinal do cliente, mesmo com valor no campo.
    assert.equal(esperandoSinal(job({ customer_deposit: 100 }), ctx()), false);
  });

  it("A: conta a partir da última volta para Unassigned", () => {
    const voltou = ctx({ voltouParaUnassigned: new Map([["j1", horasAtras(1)]]) });
    assert.equal(alarmesDosPortoes([job({ created_at: horasAtras(100), updated_at: horasAtras(1) })], voltou, AGORA).length, 0);
    const [a] = alarmesDosPortoes([job({ created_at: horasAtras(100), updated_at: horasAtras(1) })], ctx({ voltouParaUnassigned: new Map([["j1", horasAtras(5)]]) }), AGORA);
    assert.equal(a.desde, horasAtras(5));
  });

  it("B: Final Check há mais de 12h pelo final_check_at, não pelo updated_at", () => {
    const fc = job({ status: "final_check", final_check_at: horasAtras(13), updated_at: horasAtras(1) });
    const [a] = alarmesDosPortoes([fc], ctx(), AGORA);
    assert.equal(a.portao, "aprovar_report");
    assert.match(a.acao, /^Approve the final report: JOB-1 /);
    assert.equal(alarmesDosPortoes([{ ...fc, final_check_at: horasAtras(11) }], ctx(), AGORA).length, 0);
  });

  it("C: parceiro que não começou 30 min depois do início (Scheduled ou Late)", () => {
    const ag = job({ status: "scheduled", partner_id: "p1", scheduled_start_at: horasAtras(0.75) });
    const [a] = alarmesDosPortoes([ag], ctx(), AGORA);
    assert.equal(a.portao, "parceiro_parado");
    // 11:15 UTC = 11:15 em Londres (GMT em novembro).
    assert.equal(a.acao, "Partner has not started: JOB-1 was due at 10 Nov, 11:15 (London). Call the partner");
    assert.equal(alarmesDosPortoes([{ ...ag, status: "late" }], ctx(), AGORA).length, 1);
    assert.equal(alarmesDosPortoes([{ ...ag, scheduled_start_at: horasAtras(0.25) }], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([{ ...ag, partner_timer_started_at: horasAtras(0.5) }], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([{ ...ag, start_report_submitted: true }], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([{ ...ag, partner_id: null }], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([{ ...ag, scheduled_start_at: null }], ctx(), AGORA).length, 0);
  });

  it("ignora apagado, cancelado, outros status e job parado há mais de 7 dias", () => {
    assert.equal(alarmesDosPortoes([job({ deleted_at: horasAtras(1) })], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([job({ status: "cancelled" })], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([job({ status: "in_progress" })], ctx(), AGORA).length, 0);
    assert.equal(alarmesDosPortoes([job({ created_at: horasAtras(400), updated_at: horasAtras(8 * 24) })], ctx(), AGORA).length, 0);
  });

  it("o texto da ação não muda entre passadas (a fila não repete a nota)", () => {
    const j = job({});
    const um = alarmesDosPortoes([j], ctx(), AGORA)[0];
    const dois = alarmesDosPortoes([j], ctx(), new Date(AGORA.getTime() + 5 * 3_600_000))[0];
    assert.equal(um.acao, dois.acao);
    assert.equal(um.chave, dois.chave);
  });
});

describe("passada dos alarmes", () => {
  const proibido = async (): Promise<never> => {
    throw new Error("não devia ser chamado");
  };

  it("desligado: não lê, não marca, não mexe na trava", async () => {
    const travas = { x: AGORA.toISOString() };
    for (const env of [{}, { ALARMES_PORTOES: "0" }, { ALARMES_PORTOES: "" }]) {
      const r = await passadaDosAlarmes({ env, ler: proibido, marcar: proibido, travas, log: () => assert.fail("log") }, { aplicar: true, agora: AGORA });
      assert.deepEqual(r, { feito: "desligado" });
    }
    assert.deepEqual(travas, { x: AGORA.toISOString() });
  });

  const ler = async () => ({ jobs: [job({ id: "a", reference: "JOB-A" }), job({ id: "b", reference: "JOB-B" }), job({ id: "c", reference: "JOB-C", external_source: null }), job({ id: "d", reference: "JOB-D" })], ctx: ctx() });
  const env = { ALARMES_PORTOES: "1" };

  it("ligado: uma vez por job, com teto por passada e sem ticket só no log", async () => {
    const travas: Record<string, string> = {};
    const marcados: string[] = [];
    const marcar = async (t: string, acao: string) => (marcados.push(acao), { ok: true, linha: `#${t} ok` });
    const r1 = await passadaDosAlarmes({ env, ler, marcar, travas, log: () => {} }, { aplicar: true, agora: AGORA, max: 2 });
    if (r1.feito !== "aplicado") return assert.fail(r1.feito);
    assert.equal(r1.marcados, 2);
    assert.equal(r1.adiados, 1);
    assert.equal(r1.semTicket, 1);
    assert.equal(Object.keys(travas).length, 2);
    // Próxima passada: os dois já avisados não repetem, o adiado sai.
    const r2 = await passadaDosAlarmes({ env, ler, marcar, travas, log: () => {} }, { aplicar: true, agora: new Date(AGORA.getTime() + 15 * 60_000), max: 2 });
    if (r2.feito === "desligado") return assert.fail();
    assert.equal(r2.jaAvisados, 2);
    assert.equal(r2.marcados, 1);
    assert.deepEqual(marcados.map((a) => a.split(" ")[3]), ["JOB-A", "JOB-B", "JOB-D"]);
  });

  it("falha de escrita não trava; ticket fechado trava; ensaio não marca nem trava", async () => {
    const travas: Record<string, string> = {};
    const linhas = ["#1 Action Required falhou: 500", "#1 fechado, não marco", "#1 ok"];
    let i = 0;
    const marcar = async () => ({ ok: i === 2, linha: linhas[i++] });
    const r = await passadaDosAlarmes({ env, ler: async () => ({ jobs: (await ler()).jobs.filter((j) => j.id !== "c"), ctx: ctx() }), marcar, travas, log: () => {} }, { aplicar: true, agora: AGORA });
    if (r.feito === "desligado") return assert.fail();
    assert.equal(r.falhas, 1);
    assert.equal(r.marcados, 1);
    assert.deepEqual(Object.keys(travas).map((k) => k.split(":")[1]).sort(), ["b", "d"]);

    const vazias: Record<string, string> = {};
    const e = await passadaDosAlarmes({ env, ler, marcar: proibido, travas: vazias, log: () => {} }, { aplicar: false, agora: AGORA });
    assert.equal(e.feito, "ensaio");
    assert.deepEqual(vazias, {});
  });
});
