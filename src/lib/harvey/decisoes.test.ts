import { test } from "node:test";
import assert from "node:assert/strict";
import { esperadoDa, medirDecisoes, statusBate, textoDaMedida, trocaHumanaDeStatus, STATUS_ESPERADO } from "./decisoes";
import { ZD_STATUS_BIDDING, ZD_STATUS_COMPLAINT, ZD_STATUS_FINANCE, ZD_STATUS_OPEN, ZD_STATUS_TO_CALL } from "@/lib/zendesk-statuses";

test("reclamação espera 🚨 Complaint, nota de financeiro espera 🟣 Finance", () => {
  assert.deepEqual(esperadoDa({ acao: "reclamacao_hold", classe: "reclamacao" }), [ZD_STATUS_COMPLAINT]);
  assert.deepEqual(esperadoDa({ acao: "nota_de_triagem", classe: "financeiro" }), [ZD_STATUS_FINANCE]);
  assert.equal(esperadoDa({ acao: "certificado", classe: "indefinido" }), null);
  assert.deepEqual(esperadoDa({ acao: "passou_equipe", classe: "call", statusEsperado: [ZD_STATUS_TO_CALL] }), [ZD_STATUS_TO_CALL]);
  assert.equal(esperadoDa({ acao: "passou_equipe", classe: "handoff", statusEsperado: null }), null);
});

test("status bate: o 51747 ficou em Open e não em Complaint", () => {
  assert.equal(statusBate([ZD_STATUS_COMPLAINT], { status: "open", custom_status_id: ZD_STATUS_OPEN }), false);
  assert.equal(statusBate([ZD_STATUS_COMPLAINT], { status: "open", custom_status_id: ZD_STATUS_COMPLAINT }), true);
  assert.equal(statusBate(STATUS_ESPERADO.confirmacao_parceiro!, { status: "solved", custom_status_id: 5688725804959 }), true);
  assert.equal(statusBate(null, { status: "open", custom_status_id: ZD_STATUS_OPEN }), null);
});

test("troca humana é a do painel (web) depois da decisão; API não conta", () => {
  const auds = [
    { created_at: "2026-10-23T21:10:00Z", via: { channel: "api" }, events: [{ type: "Change", field_name: "custom_status_id", value: String(ZD_STATUS_OPEN) }] },
    { created_at: "2026-10-23T20:00:00Z", via: { channel: "web" }, events: [{ type: "Change", field_name: "custom_status_id", value: String(ZD_STATUS_BIDDING) }] },
    { created_at: "2026-10-24T08:36:00Z", via: { channel: "web" }, events: [{ type: "Change", field_name: "custom_status_id", value: String(ZD_STATUS_COMPLAINT) }] },
  ];
  assert.equal(trocaHumanaDeStatus(auds, "2026-10-23T21:04:00Z"), ZD_STATUS_COMPLAINT);
  assert.equal(trocaHumanaDeStatus(auds.slice(0, 2), "2026-10-23T21:04:00Z"), null);
});

test("medida por classe e o texto do brief", () => {
  const m = medirDecisoes([
    { classe: "reclamacao", acao: "reclamacao_hold", resultado: "ok", canal: "email", status_ok: false, humano_mudou: true },
    { classe: "reclamacao", acao: "reclamacao_nota", resultado: "nota", canal: "email", status_ok: true, humano_mudou: false },
    { classe: "job_de_plataforma", acao: "job_criado", resultado: "ok", canal: "email", status_ok: null, humano_mudou: null },
    { classe: "job_de_plataforma", acao: "falhou", resultado: "falhou", canal: "email", status_ok: null, humano_mudou: null },
  ]);
  assert.equal(m[0]!.total, 2);
  const rec = m.find((c) => c.classe === "reclamacao")!;
  assert.deepEqual([rec.conferidos, rec.statusCerto, rec.conferidos24h, rec.equipeCorrigiu], [2, 1, 2, 1]);
  const t = textoDaMedida(m, 7);
  assert.match(t, /^Harvey decisions \(7d\): 4 · right status 50% · team changed status 50%/);
  assert.match(t, /Platform booking: 2 \(job created 1, failed 1\) · right status n\/a · team changed status n\/a · 1 failed/);
  assert.doesNotMatch(t, /[—–]/);
});
