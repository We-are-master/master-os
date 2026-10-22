/**
 * Dinheiro do job com visitas (dono, 22/10/2026): o total do job é a soma das
 * visitas, a linha de visita na lista mostra os totais e o pagamento do job, e o
 * parceiro de cada visita continua recebendo só o que ela paga.
 *
 * Fixture real: JOB-9705. V1 £730 cliente / £480 parceiro (+ £230 de extras do
 * job), V2 £0 / £140, V3 £0 / £35. No banco: total_client_price 730,
 * total_partner_cost 655. O resumo do card diz "3 visits · client £730 · partner £655".
 */
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { jobShareOfVisitSelfBill, rollUpJobVisits, rollupFromStoredColumns, visitCountsForPartnerPayout } from "@/lib/job-visit-rollup";
import { confirmAndRemoveJobVisit } from "@/services/job-visits-api";
import { summariseVisits } from "@/services/job-visits";
import { jobListClientAmount, jobListMargin, jobListPartnerCost, sumJobsMoney } from "@/lib/job-financials";
import { uniqueRowPerJob, visitAsJobRow, type VisitWithParent } from "@/lib/job-visit-day-rows";
import { jobPaymentState } from "@/lib/job-payment-badge";
import type { Job, JobVisit } from "@/types/database";

const JOB_9705 = {
  id: "99e489e2-f86d-45fb-a6d4-005af5f95fa6",
  reference: "JOB-9705",
  status: "scheduled",
  client_price: 730,
  extras_amount: 230,
  promotion_amount: 0,
  partner_cost: 480,
  materials_cost: 0,
  partner_id: "p-fixfy",
  partner_name: "Fixfy",
  scheduled_date: "2026-10-20",
  scheduled_start_at: "2026-10-20T08:00:00Z",
  invoice_id: "2be24490-246a-4fad-802a-9d337f9dafa5",
  finance_status: "partial",
  customer_deposit: 595,
  customer_final_payment: 365,
  job_type: "fixed",
} as unknown as Job;

function visita(over: Partial<JobVisit>): JobVisit {
  return {
    id: "v",
    job_id: JOB_9705.id,
    visit_index: 2,
    status: "scheduled",
    client_price: 0,
    partner_cost: 0,
    materials_cost: 0,
    scheduled_date: "2026-10-22",
    created_at: "",
    updated_at: "",
    deleted_at: null,
    ...over,
  } as JobVisit;
}

const V2 = visita({ id: "5c29b4ed", visit_index: 2, partner_cost: 140, partner_id: "p-fv", partner_name: "F&V Cleaning" });
const V3 = visita({
  id: "59ada91c-76d2-464c-922d-9cc465bf3d08", visit_index: 3, partner_cost: 35, partner_id: "p-tm", partner_name: "TM Handyman",
  scheduled_date: "2026-10-23", scheduled_start_at: "2026-10-23T07:00:00Z",
});

/** O que o gatilho da mig 274 grava no job: a mesma regra que o rollup em TS. */
function comTotais(job: Job, visits: JobVisit[]): Job {
  const r = rollUpJobVisits(job, visits);
  return {
    ...job,
    visits_count: r.visitCount,
    total_client_price: r.clientPriceTotal,
    total_partner_cost: r.partnerCostTotal,
    total_materials_cost: r.materialsCostTotal,
  } as Job;
}

describe("totais do job = soma das visitas", () => {
  it("JOB-9705: 3 visitas, cliente £730, parceiro £655 (o resumo do card)", () => {
    const s = summariseVisits(JOB_9705, [V2, V3]);
    assert.deepEqual(s, { count: 3, totalClientPrice: 730, totalPartnerCost: 655 });
  });

  it("visita nova com £0 cliente e £35 parceiro soma £35 só no parceiro", () => {
    const antes = rollUpJobVisits(JOB_9705, [V2]);
    const depois = rollUpJobVisits(JOB_9705, [V2, V3]);
    assert.equal(depois.clientPriceTotal - antes.clientPriceTotal, 0);
    assert.equal(depois.partnerCostTotal - antes.partnerCostTotal, 35);
  });

  it("visita com cobrança extra do cliente soma no cliente", () => {
    const comExtra = rollUpJobVisits(JOB_9705, [V2, { ...V3, client_price: 90 }]);
    assert.equal(comExtra.clientPriceTotal, 820);
    assert.equal(comExtra.partnerCostTotal, 655);
  });

  it("editar a visita muda o total", () => {
    assert.equal(rollUpJobVisits(JOB_9705, [V2, { ...V3, partner_cost: 60 }]).partnerCostTotal, 680);
  });

  it("apagar ou cancelar a visita tira do total", () => {
    assert.equal(rollUpJobVisits(JOB_9705, [V2, { ...V3, deleted_at: "2026-10-22T10:00:00Z" }]).partnerCostTotal, 620);
    assert.equal(rollUpJobVisits(JOB_9705, [V2, { ...V3, status: "cancelled" }]).partnerCostTotal, 620);
  });

  it("o card (linhas) e a lista (colunas do gatilho) dão o mesmo total", () => {
    const job = comTotais(JOB_9705, [V2, V3]);
    const doCard = summariseVisits(JOB_9705, [V2, V3]);
    const daLista = rollupFromStoredColumns(job);
    assert.equal(daLista.clientPriceTotal, doCard.totalClientPrice);
    assert.equal(daLista.partnerCostTotal, doCard.totalPartnerCost);
    assert.equal(jobListPartnerCost(job), 655);
    // A coluna Job amount inclui os extras do job, como sempre: £730 das visitas + £230.
    assert.equal(jobListClientAmount(job), 960);
  });

  it("margem do job sai dos totais", () => {
    const m = jobListMargin(comTotais(JOB_9705, [V2, V3]));
    assert.equal(m.profit, 305); // 960 − 655
    assert.equal(m.marginPct, 31.8);
  });

  it("job sem visita extra continua igual (sem colunas de total, ambiente antigo também)", () => {
    const simples = { ...JOB_9705, extras_amount: 0 } as Job;
    assert.equal(jobListClientAmount(simples), 730);
    assert.equal(jobListPartnerCost(simples), 480);
    assert.equal(jobListPartnerCost({ ...simples, total_partner_cost: 0 } as Job), 480);
  });
});

describe("linha de visita na lista", () => {
  const job = comTotais(JOB_9705, [V2, V3]);
  const linhaV3 = visitAsJobRow({ ...V3, parent: job } as VisitWithParent);

  it("Job amount e Cost são os totais do job, iguais aos da linha do job", () => {
    assert.equal(jobListClientAmount(linhaV3), jobListClientAmount(job));
    assert.equal(jobListPartnerCost(linhaV3), 655);
  });

  it("Payment vem do job: JOB-9705 é Partial (o sinal já foi pago), nunca vazio", () => {
    assert.equal(linhaV3.invoice_id, JOB_9705.invoice_id);
    assert.equal(jobPaymentState(linhaV3, new Set()), "partial");
    assert.equal(jobPaymentState(linhaV3, new Set()), jobPaymentState(job, new Set()));
    // Fatura vencida do job marca a linha da visita também.
    assert.equal(jobPaymentState(linhaV3, new Set([JOB_9705.invoice_id!])), "overdue");
  });

  it("o extra da própria visita fica guardado para o hover e para o parceiro dela", () => {
    assert.deepEqual(linhaV3.__visit_money, { client_price: 0, partner_cost: 35, materials_cost: 0 });
    assert.equal(linhaV3.partner_name, "TM Handyman");
  });

  it("rodapé da aba conta o job uma vez, mesmo com a linha dele e as das visitas", () => {
    const linhaV2 = visitAsJobRow({ ...V2, parent: job } as VisitWithParent);
    const linhas = [job, linhaV2, linhaV3];
    assert.equal(uniqueRowPerJob(linhas).length, 1);
    assert.deepEqual(sumJobsMoney(uniqueRowPerJob(linhas)), { revenue: 960, cost: 655, profit: 305, marginPct: 31.8 });
  });
});

describe("self-bill por visita, sem contar duas vezes", () => {
  it("cada parceiro recebe a linha dele: V1 do job, cada visita a dela", () => {
    const r = rollUpJobVisits(JOB_9705, [V2, V3]);
    assert.deepEqual(
      r.perVisit.map((l) => [l.visitIndex, l.partnerName, l.partnerCost]),
      [[1, "Fixfy", 480], [2, "F&V Cleaning", 140], [3, "TM Handyman", 35]],
    );
    assert.equal(r.perVisit.reduce((s, l) => s + l.partnerCost, 0), r.partnerCostTotal);
  });

  it("a linha da visita não muda o custo de visita 1 que o self-bill lê do job", () => {
    const job = comTotais(JOB_9705, [V2, V3]);
    const linha = visitAsJobRow({ ...V3, parent: job } as VisitWithParent);
    assert.equal(job.partner_cost, 480);
    assert.equal(linha.__visit_money.partner_cost, 35);
  });
});

describe("self-bill da visita no card do job: só a parte deste job", () => {
  // SB-14535 (F&V Cleaning, quinzena 12-25/10) somava £1,309.66: 9 jobs dela + a V2 do JOB-9705.
  const SB_FV = "83919054-c56d-4ffa-b20c-c30b7433a90e";

  it("JOB-9705: a V2 ainda marcada já vale £140 no documento (não os £1,309.66 da quinzena), marcada como não feita", () => {
    const parte = jobShareOfVisitSelfBill([{ ...V2, self_bill_id: SB_FV }, { ...V3, self_bill_id: null }], SB_FV);
    assert.deepEqual(parte, { labour: 140, materials: 0, gross: 140, pending: 140, visitIndexes: [2] });
  });

  it("depois do Done a V2 conta £140", () => {
    const parte = jobShareOfVisitSelfBill([{ ...V2, self_bill_id: SB_FV, status: "completed" }], SB_FV);
    assert.deepEqual(parte, { labour: 140, materials: 0, gross: 140, pending: 0, visitIndexes: [2] });
  });

  it("mesmo parceiro em duas visitas do job: o mesmo documento soma as duas; cancelada ou apagada não", () => {
    const visitas = [
      { ...V2, self_bill_id: SB_FV, status: "completed" as const },
      { ...V3, self_bill_id: SB_FV, status: "completed" as const, materials_cost: 12.5 },
      { ...V3, id: "x", visit_index: 4, self_bill_id: SB_FV, status: "cancelled" as const },
      { ...V3, id: "y", visit_index: 5, self_bill_id: SB_FV, deleted_at: "2026-10-22T00:00:00Z" },
    ];
    assert.deepEqual(jobShareOfVisitSelfBill(visitas, SB_FV), { labour: 175, materials: 12.5, gross: 187.5, pending: 0, visitIndexes: [2, 3] });
  });

  it("visita de outro documento não entra", () => {
    assert.equal(jobShareOfVisitSelfBill([{ ...V2, self_bill_id: "outro", status: "completed" }], SB_FV).gross, 0);
  });
});

describe("visita feita (só marca; o valor vale desde que a visita nasce)", () => {
  it("marcada ou em andamento não está feita; Done ou relatório enviado está", () => {
    assert.equal(visitCountsForPartnerPayout({ status: "scheduled", deleted_at: null }), false);
    assert.equal(visitCountsForPartnerPayout({ status: "in_progress", deleted_at: null }), false);
    assert.equal(visitCountsForPartnerPayout({ status: "completed", deleted_at: null }), true);
    assert.equal(visitCountsForPartnerPayout({ status: "in_progress", deleted_at: null, report_submitted_at: "2026-10-22T10:00:00Z" }), true);
  });

  it("cancelada ou apagada nunca conta como feita", () => {
    assert.equal(visitCountsForPartnerPayout({ status: "cancelled", deleted_at: null, report_submitted_at: "x" }), false);
    assert.equal(visitCountsForPartnerPayout({ status: "completed", deleted_at: "2026-10-22T00:00:00Z" }), false);
  });

  it("o total do job (cliente e margem) continua contando a visita marcada", () => {
    assert.equal(rollUpJobVisits(JOB_9705, [V2, V3]).partnerCostTotal, 655);
  });
});

describe("remover visita: sempre pergunta", () => {
  it("diz o que sai do self-bill e da fatura, em inglês e sem travessão; desistir não remove nada", async () => {
    const perguntas: string[] = [];
    const fetchAntes = globalThis.fetch;
    let chamadas = 0;
    globalThis.fetch = (async () => { chamadas++; return new Response("{}"); }) as typeof fetch;
    try {
      const removida = await confirmAndRemoveJobVisit(
        JOB_9705.id,
        { id: V3.id, visit_index: 3, partner_name: "TM Handyman", partner_cost: 35, client_price: 0 },
        { confirm: (m) => { perguntas.push(m); return false; } },
      );
      assert.equal(removida, false);
      assert.equal(chamadas, 0);
    } finally {
      globalThis.fetch = fetchAntes;
    }
    assert.equal(perguntas.length, 1);
    assert.match(perguntas[0]!, /Remove visit 3 \(TM Handyman\)\?/);
    assert.match(perguntas[0]!, /TM Handyman's self-bill now \(£35\.00\)/);
    assert.match(perguntas[0]!, /client invoice does not change/);
    assert.doesNotMatch(perguntas[0]!, /—/);
  });

  it("com cobrança do cliente, avisa que a fatura cai", async () => {
    let msg = "";
    await confirmAndRemoveJobVisit(JOB_9705.id, { id: "v", visit_index: 2, client_price: 90 }, { confirm: (m) => { msg = m; return false; } });
    assert.match(msg, /client invoice go down by £90\.00/);
  });
});
