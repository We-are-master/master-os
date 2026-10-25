/**
 * Feedback pós-job: as regras do dono (14/10/2026) e as travas.
 */
import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { clienteDaFixfy, diasAntes, naJanelaDoFeedback, varrerFeedbackPosJob } from "./pos-job";
import { reclamacaoNoJob, reclamacaoNoTicket } from "./reclamacao";
import { fakeSupabase } from "@/lib/client-confirmation/fake-supabase.test-helper";
import type { AvisoNoTicket } from "@/lib/um-ticket/aviso-do-job";
import { buildClientFeedbackRequestEmail } from "@/lib/emails/client-feedback-request";

const FIXFY = "5cf896ec-ee42-441b-a698-34fdaeeb28b3";
const AGORA = new Date("2026-10-14T10:00:00Z"); // 11h de Londres

function job(id: string, extra: Record<string, unknown> = {}) {
  return {
    id, reference: `JOB-${id}`, title: "End of Tenancy Clean", status: "completed", client_id: `cli-${id}`, client_name: "X",
    external_source: "zendesk", external_ref: `90${id}`, internal_notes: null, property_address: "1 Test St, London",
    scheduled_date: "2026-10-12", scheduled_start_at: "2026-10-12T08:00:00Z", completed_date: null,
    partner_timer_ended_at: null, final_report: { submitted_at: "2026-10-12T15:00:00Z" },
    on_hold_reason_preset_id: null, on_hold_reason: null, on_hold_complaint_description: null,
    customer_review_submitted_at: null, feedback_requested_at: null, deleted_at: null, ...extra,
  };
}
function cliente(id: string, conta: string | null, email: string | null = `cliente${id}@example.com`) {
  return { id: `cli-${id}`, full_name: `Cliente ${id}`, email, source_account_id: conta };
}

const ENV = ["CLIENT_MESSAGING_ENABLED", "FIXFY_ACCOUNT_ID", "FEEDBACK_JANELA_DIAS", "FEEDBACK_REVIEW_URL"];
let salvo: Record<string, string | undefined> = {};

describe("varrerFeedbackPosJob", () => {
  beforeEach(() => {
    salvo = Object.fromEntries(ENV.map((k) => [k, process.env[k]]));
    process.env.CLIENT_MESSAGING_ENABLED = "1";
    process.env.FIXFY_ACCOUNT_ID = FIXFY;
    delete process.env.FEEDBACK_JANELA_DIAS; delete process.env.FEEDBACK_REVIEW_URL;
  });
  afterEach(() => {
    for (const k of ENV) { if (salvo[k] === undefined) delete process.env[k]; else process.env[k] = salvo[k]; }
  });

  function banco() {
    return fakeSupabase({
      jobs: [
        job("1"), // B2C sem conta: manda
        job("2"), // conta Fixfy: manda
        job("3"), // Housekeep, conta sem a chave: não
        job("4"), // Good Place, conta com a chave: manda
        job("5", { on_hold_reason_preset_id: "complaint" }), // reclamou
        job("6", { external_ref: "777" }), // ticket passou por Complaint
        job("7", { final_report: { submitted_at: "2026-10-14T09:00:00Z" } }), // concluído hoje: amanhã
        job("8", { final_report: { submitted_at: "2026-09-20T09:00:00Z" }, scheduled_date: "2026-09-20" }), // velho
        job("9", { customer_review_submitted_at: "2026-10-13T10:00:00Z" }),
        job("10", { client_id: "cli-1" }), // mesmo cliente do 1: um pedido só
        job("11", { status: "awaiting_payment" }),
        job("12"), // sem e-mail do cliente
        job("13", { external_source: null, external_ref: null }), // sem ticket
      ],
      clients: [
        cliente("1", null), cliente("2", FIXFY), cliente("3", "acc-hk"), cliente("4", "acc-gp"),
        cliente("5", null), cliente("6", null), cliente("7", null), cliente("8", null), cliente("9", null),
        cliente("12", null, null), cliente("13", null),
      ],
      accounts: [
        { id: "acc-hk", company_name: "Housekeep", client_feedback_whatsapp: false },
        { id: "acc-gp", company_name: "Good Place Lettings", client_feedback_whatsapp: true },
      ],
      partner_feedback: [],
    });
  }
  const lerZendesk = async (id: string) => (id === "777" ? "ticket went through 🚨 Complaint" : null);

  test("ensaio: quem receberia e por que os outros não", async () => {
    const { client, escritas } = banco();
    const r = await varrerFeedbackPosJob(client, { agora: AGORA, lerZendesk });
    const por = Object.fromEntries(r.linhas.map((l) => [l.reference, l]));
    assert.equal(r.modo, "ensaio");
    assert.equal(por["JOB-1"].resultado, "enviaria");
    assert.equal(por["JOB-2"].resultado, "enviaria");
    assert.match(por["JOB-3"].detalhe, /Housekeep customer: account does not send/);
    assert.equal(por["JOB-4"].resultado, "enviaria");
    assert.match(por["JOB-5"].detalhe, /complaint/);
    assert.match(por["JOB-6"].detalhe, /Complaint/);
    assert.equal(por["JOB-7"], undefined, "concluído hoje espera até amanhã");
    assert.equal(por["JOB-8"], undefined, "fora da janela de 7 dias");
    assert.match(por["JOB-9"].detalhe, /already left a review/);
    assert.match(por["JOB-10"].detalhe, /already asked in this run/);
    assert.equal(por["JOB-11"], undefined, "só status completed");
    assert.match(por["JOB-1"].detalhe, /email in ticket #901 → cliente1@example\.com/);
    assert.match(por["JOB-12"].detalhe, /no customer email/);
    assert.match(por["JOB-13"].detalhe, /no Zendesk ticket/);
    assert.equal(escritas.length, 0);
  });

  test("aplicando: e-mail no ticket do job, trava gravada, e a rodada seguinte não repete", async () => {
    const { client, tabelas } = banco();
    const enviados: AvisoNoTicket[] = [];
    const avisar = async (a: AvisoNoTicket) => { enviados.push(a); };
    await varrerFeedbackPosJob(client, { agora: AGORA, aplicar: true, avisar, lerZendesk });
    assert.equal(enviados.length, 3);
    const primeiro = enviados.find((a) => a.ticketId === 901)!;
    assert.equal(primeiro.para.email, "cliente1@example.com");
    assert.equal(primeiro.assunto, "How did your End of Tenancy Clean go?");
    assert.match(primeiro.html, /Hi Cliente,/);
    assert.doesNotMatch(primeiro.html, /Leave feedback/, "sem FEEDBACK_REVIEW_URL, sem botão");
    assert.ok(tabelas.jobs.find((j) => j.id === "1")!.feedback_requested_at);
    const r2 = await varrerFeedbackPosJob(client, { agora: AGORA, aplicar: true, avisar, lerZendesk });
    assert.equal(enviados.length, 3);
    // O job 10 (mesmo cliente do 1) agora cai na regra da semana.
    assert.match(r2.linhas.find((l) => l.reference === "JOB-10")!.detalhe, /last 7 days/);
  });

  test("falha no envio devolve a trava", async () => {
    const { client, tabelas } = banco();
    await varrerFeedbackPosJob(client, { agora: AGORA, aplicar: true, lerZendesk, avisar: async () => { throw new Error("Zendesk 422"); } });
    assert.equal(tabelas.jobs.find((j) => j.id === "1")!.feedback_requested_at, null);
  });

  test("ticket ilegível: na dúvida, não pede", async () => {
    const { client } = banco();
    const r = await varrerFeedbackPosJob(client, { agora: AGORA, lerZendesk: async () => { throw new Error("401"); } });
    assert.match(r.linhas.find((l) => l.reference === "JOB-6")!.detalhe, /not asking blind/);
  });

  test("fora das 9h-20h de Londres só lista", async () => {
    const { client } = banco();
    const r = await varrerFeedbackPosJob(client, { agora: new Date("2026-10-14T20:30:00Z"), aplicar: true, lerZendesk, avisar: async () => {} });
    assert.equal(r.modo, "ensaio");
  });
});

describe("e-mail de feedback", () => {
  test("com link: botão; sem link: só a resposta", () => {
    const base = { clientFirstName: "Sarah", jobReference: "JOB-1", jobTitle: "Deep Clean", completedOn: "Monday 19 October 2026" };
    const com = buildClientFeedbackRequestEmail({ ...base, feedbackUrl: "https://example.com/review" });
    assert.match(com.html, /Leave feedback/);
    assert.match(com.html, /https:\/\/example\.com\/review/);
    const sem = buildClientFeedbackRequestEmail(base);
    assert.doesNotMatch(sem.html, /Leave feedback/);
    assert.match(sem.text, /reply to this email/);
    assert.doesNotMatch(com.html + sem.html, /\u2014/, "sem travessão");
  });
});

describe("regras puras do feedback", () => {
  test("janela: de ontem até 7 dias atrás", () => {
    assert.equal(diasAntes("2026-10-01", 1), "2026-09-30");
    assert.equal(naJanelaDoFeedback("2026-10-13", "2026-10-14", 7), true);
    assert.equal(naJanelaDoFeedback("2026-10-14", "2026-10-14", 7), false);
    assert.equal(naJanelaDoFeedback("2026-10-07", "2026-10-14", 7), true);
    assert.equal(naJanelaDoFeedback("2026-10-06", "2026-10-14", 7), false);
    assert.equal(naJanelaDoFeedback(null, "2026-10-14", 7), false);
  });
  test("cliente da Fixfy: sem conta ou conta Fixfy", () => {
    assert.equal(clienteDaFixfy(null, FIXFY), true);
    assert.equal(clienteDaFixfy(FIXFY, FIXFY), true);
    assert.equal(clienteDaFixfy("acc-hk", FIXFY), false);
  });
  test("reclamação no job", () => {
    assert.equal(reclamacaoNoJob({}), null);
    assert.ok(reclamacaoNoJob({ on_hold_reason: "Complaint - Client Complaint" }));
    assert.ok(reclamacaoNoJob({ on_hold_complaint_description: "left a mess" }));
    assert.ok(reclamacaoNoJob({ title: "Remedial: End of Tenancy Clean" }));
    assert.ok(reclamacaoNoJob({ internal_notes: "remedial-of:JOB-9600" }));
  });
  test("reclamação no ticket, agora e no histórico", () => {
    assert.equal(reclamacaoNoTicket({ custom_status_id: 5679178036383, tags: ["job"] }), null);
    assert.ok(reclamacaoNoTicket({ custom_status_id: 5739880624543 }));
    assert.ok(reclamacaoNoTicket({ tags: ["in_complaint"] }));
    assert.ok(reclamacaoNoTicket({ ticket_form_id: 5834299713951 }));
    assert.ok(reclamacaoNoTicket({}, [{ events: [{ type: "Change", field_name: "custom_status_id", value: "5739880624543" }] }]));
    assert.ok(reclamacaoNoTicket({}, [{ events: [{ type: "Change", field_name: "tags", value: ["in_complaint"] }] }]));
    assert.equal(reclamacaoNoTicket({}, [{ events: [{ type: "Change", field_name: "status", value: "solved" }] }]), null);
  });
});
