import { strict as assert } from "node:assert";
import { test } from "node:test";
import {
  avaliarParceiro,
  escolherAutoAceite,
  penalidadeDeCancelamento,
  vagasNaCategoria,
  type Catalogo,
  type JobParaEscala,
  type ParceiroParaEscala,
} from "./elegibilidade-parceiro";

const CLEAN = "cat-clean";
const GM = "cat-gm";
const catalogo: Catalogo = new Map([
  ["eot", { category_id: CLEAN }],
  ["deep", { category_id: CLEAN }],
  ["handyman", { category_id: GM }],
]);
const semana = { mon: { on: true, start: "08:00", end: "18:00" }, tue: { on: true, start: "08:00", end: "18:00" }, wed: { on: true, start: "08:00", end: "18:00" }, thu: { on: true, start: "08:00", end: "18:00" }, fri: { on: true, start: "08:00", end: "18:00" }, sat: { on: false } };

const maria: ParceiroParaEscala = { id: "maria", status: "active", catalog_service_ids: ["eot"], availability: { days: semana, maxJobsPerDay: 2 } };
const joao: ParceiroParaEscala = { id: "joao", status: "active", catalog_service_ids: ["handyman"], availability: { days: semana, maxJobsPerDay: 3 } };
const semAgenda: ParceiroParaEscala = { id: "ana", status: "active", catalog_service_ids: ["eot"], availability: null };

// 01/10/2026 é quinta; 03/10/2026 é sábado.
const jobEot: JobParaEscala = { status: "auto_assigning", catalog_service_id: "eot", data: "2026-10-01", partner_cost: 140 };

test("serviço exato; degrau 2 aceita a mesma categoria", () => {
  assert.deepEqual(avaliarParceiro(maria, jobEot, [], catalogo), { ok: true });
  assert.deepEqual(avaliarParceiro(joao, jobEot, [], catalogo), { ok: false, motivo: "sem_o_servico" });
  const jobDeep = { ...jobEot, catalog_service_id: "deep" };
  assert.deepEqual(avaliarParceiro(maria, jobDeep, [], catalogo, "servico"), { ok: false, motivo: "sem_o_servico" });
  assert.deepEqual(avaliarParceiro(maria, jobDeep, [], catalogo, "categoria"), { ok: true });
});

test("sem disponibilidade, fim de semana fechado, horário e folga", () => {
  assert.deepEqual(avaliarParceiro(semAgenda, jobEot, [], catalogo), { ok: false, motivo: "sem_disponibilidade" });
  assert.deepEqual(avaliarParceiro(maria, { ...jobEot, data: "2026-10-03" }, [], catalogo), { ok: false, motivo: "nao_trabalha_nesse_dia_ou_horario" });
  // 19h de Londres (BST) = 18h UTC, depois do fim do dia dela
  assert.deepEqual(avaliarParceiro(maria, { ...jobEot, startAt: "2026-10-01T18:00:00Z", endAt: "2026-10-01T20:00:00Z" }, [], catalogo), { ok: false, motivo: "nao_trabalha_nesse_dia_ou_horario" });
  const deFolga = { ...maria, availability: { ...maria.availability, daysOff: ["2026-10-01"] } };
  assert.deepEqual(avaliarParceiro(deFolga, jobEot, [], catalogo), { ok: false, motivo: "folga" });
});

test("máx. por dia, valor mínimo e jobs ativos", () => {
  const dois: JobParaEscala[] = [
    { status: "scheduled", partner_id: "maria", catalog_service_id: "eot", data: "2026-10-01" },
    { status: "scheduled", partner_id: "maria", catalog_service_id: "eot", data: "2026-10-01" },
    { status: "cancelled", partner_id: "maria", catalog_service_id: "eot", data: "2026-10-01" },
  ];
  assert.deepEqual(avaliarParceiro(maria, jobEot, dois, catalogo), { ok: false, motivo: "dia_cheio" });
  assert.deepEqual(avaliarParceiro(maria, jobEot, dois.slice(1), catalogo), { ok: true }, "cancelado não ocupa vaga");
  const exigente = { ...maria, job_preferences: { minJobValue: 150 } };
  assert.deepEqual(avaliarParceiro(exigente, jobEot, [], catalogo), { ok: false, motivo: "valor_abaixo_do_minimo" });
  const cheia = { ...maria, job_preferences: { maxActiveJobs: 1 } };
  assert.deepEqual(avaliarParceiro(cheia, jobEot, [{ status: "scheduled", partner_id: "maria", catalog_service_id: "eot", data: "2026-10-09" }], catalogo), { ok: false, motivo: "jobs_ativos_demais" });
});

test("vagas do dia = soma dos parceiros livres menos o vendido sem parceiro", () => {
  const outra: ParceiroParaEscala = { id: "bia", status: "active", catalog_service_ids: ["deep"], availability: { days: semana } }; // padrão 5
  const jobs: JobParaEscala[] = [
    { status: "scheduled", partner_id: "maria", catalog_service_id: "eot", data: "2026-10-01" },
    { status: "unassigned", partner_id: null, catalog_service_id: "deep", data: "2026-10-01" },
  ];
  const v = vagasNaCategoria(CLEAN, "2026-10-01", [maria, outra, semAgenda, joao], jobs, catalogo);
  assert.deepEqual(v, { vagas: 1 + 5 - 1, parceiros: 2, semParceiro: 1 });
  assert.equal(vagasNaCategoria(CLEAN, "2026-10-03", [maria, outra], [], catalogo).vagas, 0, "sábado ninguém trabalha");
  assert.equal(vagasNaCategoria(GM, "2026-10-01", [maria, joao], [], catalogo).vagas, 3);
});

test("auto-accept: quem tem menos jobs no dia; sem ninguém ligado, ninguém", () => {
  const liga = (p: ParceiroParaEscala) => ({ ...p, job_preferences: { autoAccept: { on: true, acceptedAt: "2026-09-29T10:00:00Z", termsVersion: "v1" } } });
  const a = liga({ ...maria, id: "a" });
  const b = liga({ ...maria, id: "b" });
  const jobs: JobParaEscala[] = [{ status: "scheduled", partner_id: "a", catalog_service_id: "eot", data: "2026-10-01" }];
  assert.equal(escolherAutoAceite([a, b], jobs, "2026-10-01")?.id, "b");
  assert.equal(escolherAutoAceite([maria], [], "2026-10-01"), null);
  const semAceite = { ...maria, job_preferences: { autoAccept: { on: true } } };
  assert.equal(escolherAutoAceite([semAceite], [], "2026-10-01"), null, "sem aceite dos termos não vale");
});

test("penalidade: 50% a menos de 36h, nada a 36h ou mais", () => {
  const agora = new Date("2026-10-01T00:00:00Z");
  assert.equal(penalidadeDeCancelamento("2026-10-02T11:00:00Z", 140, agora), 70); // 35h
  assert.equal(penalidadeDeCancelamento("2026-10-02T13:00:00Z", 140, agora), 0); // 37h
  assert.equal(penalidadeDeCancelamento(null, 140, agora), 0);
});

test("regra v1 (contrato atual): £50 a menos de 24h", async () => {
  const { penalidadePelaRegra } = await import("./elegibilidade-parceiro");
  const agora = new Date("2026-10-01T00:00:00Z");
  assert.equal(penalidadePelaRegra("v1_50gbp_24h", "2026-10-01T23:00:00Z", 140, agora), 50);
  assert.equal(penalidadePelaRegra("v1_50gbp_24h", "2026-10-02T01:00:00Z", 140, agora), 0);
  assert.equal(penalidadePelaRegra("v2_50pct_36h", "2026-10-02T01:00:00Z", 140, agora), 70);
});
