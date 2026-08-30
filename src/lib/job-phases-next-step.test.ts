import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { proximaFaseDoJob } from "@/lib/job-phases";
import type { Job } from "@/types/database";

/**
 * A seta da lista move o job uma fase. Estes testes existem porque a seta é um
 * clique de UMA batida, sem tela de confirmação no meio: o que ela pode e o que
 * ela NÃO pode fazer precisa estar escrito em algum lugar que quebra quando
 * alguém mexe.
 */
const job = (over: Partial<Job>): Job =>
  ({
    id: "j1",
    reference: "JOB-1",
    status: "scheduled",
    partner_id: "p1",
    partner_name: "RJ Cleaner Services",
    scheduled_date: "2026-08-27",
  }) as unknown as Job;

describe("seta da lista: próxima fase", () => {
  it("scheduled vira Start job → in_progress", () => {
    const r = proximaFaseDoJob(job({}));
    assert.equal(r?.to, "in_progress");
    assert.equal(r?.label, "Start Job");
    assert.equal(r?.bloqueio, null);
  });

  it("late anda igual scheduled: atrasado é agendado que passou da hora", () => {
    const r = proximaFaseDoJob({ ...job({}), status: "late" } as Job);
    assert.equal(r?.to, "in_progress");
    assert.equal(r?.bloqueio, null);
  });

  it("in_progress vira Job completed → final_check", () => {
    const r = proximaFaseDoJob({ ...job({}), status: "in_progress" } as Job);
    assert.equal(r?.to, "final_check");
    assert.equal(r?.label, "Job completed");
    assert.equal(r?.bloqueio, null);
  });

  it("sem parceiro a seta explica em vez de andar", () => {
    const r = proximaFaseDoJob({ ...job({}), partner_id: null, partner_name: null } as unknown as Job);
    assert.equal(r?.to, "in_progress");
    assert.match(r?.bloqueio ?? "", /Assign a partner/i);
  });

  it("sem data agendada também trava, com o motivo", () => {
    const r = proximaFaseDoJob({
      ...job({}),
      scheduled_date: null,
      scheduled_start_at: null,
    } as unknown as Job);
    assert.match(r?.bloqueio ?? "", /scheduled date/i);
  });

  /**
   * O guarda que mais importa: os passos que custam dinheiro ou abrem tela não
   * podem cair num clique de lista. final_check abre a revisão final (relatório,
   * fatura, self-bill) e awaiting_payment exige conferir os dois pagamentos.
   */
  it("final_check, awaiting_payment, unassigned, on_hold e completed não andam pela seta", () => {
    for (const status of ["final_check", "awaiting_payment", "unassigned", "on_hold", "completed", "cancelled"]) {
      assert.equal(proximaFaseDoJob({ ...job({}), status } as unknown as Job), null, status);
    }
  });
});
