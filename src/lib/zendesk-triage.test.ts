import { test } from "node:test";
import assert from "node:assert/strict";
import { triarTicket, ACAO_POR_CLASSE, tagDaClasse } from "./zendesk-triage";

/**
 * Todo assunto aqui é REAL, copiado da fila do Zendesk na medição de 14 dias
 * (07-21/08/2026). Teste de triagem com exemplo inventado prova que a regex
 * funciona; com assunto real prova que ela funciona no que chega.
 */

test("oferta do Checkatrade não é spam, mesmo o Zendesk dizendo que é", () => {
  // Os 51 casos que a tag do Zendesk teria mandado para o lixo.
  const t = triarTicket({
    subject: "£122.90 job offer in W1W 6BT",
    tags: ["intent__misc__unsolicited__marketing_or_newsletter", "intent_confidence__low"],
  });
  assert.equal(t.classe, "oferta_de_lead");
  assert.equal(t.fonte, "assunto");
  // Quem disputa oferta é o RPA. O Harvey só comenta.
  assert.equal(ACAO_POR_CLASSE[t.classe], "nota");
});

test("job da plataforma continua sendo job, nos três formatos que chegam", () => {
  for (const subject of [
    "Job booked - End-of-tenancy clean - BR3 4AE - Fri 21 Aug 2026",
    "Job Scheduled: (AB) After Builders Cleaning - EC1V 2NX",
    "You're booked in for the Assemble Double Storage Bed job through Checkatrade Express",
  ]) {
    const t = triarTicket({ subject });
    assert.equal(t.classe, "job_de_plataforma", subject);
    assert.equal(ACAO_POR_CLASSE[t.classe], "age", subject);
  }
});

test("ticket do próprio OS ganha de qualquer outra regra", () => {
  // "JOB-9480 · (EOT) End of Tenancy" tem "End of Tenancy" no meio, que
  // aparece também nos assuntos da Housekeep. A ordem das regras resolve.
  const t = triarTicket({ subject: "JOB-9480 · (EOT) End of Tenancy · Evan Tan" });
  assert.equal(t.classe, "ticket_do_os");
  assert.equal(ACAO_POR_CLASSE[t.classe], "passa");
});

test("confirmação de parceiro: o assunto do ticket 49108", () => {
  const t = triarTicket({
    subject: "Master Services, your booking with Landlord Certification is confirmed - Invoice Attached",
    tags: ["intent__service__appointment__confirmation", "intent_confidence__high"],
  });
  assert.equal(t.classe, "confirmacao_de_parceiro");
  assert.equal(ACAO_POR_CLASSE[t.classe], "age");
});

test("cancelamento da plataforma", () => {
  const t = triarTicket({ subject: "Your Checkatrade Express job has been cancelled" });
  assert.equal(t.classe, "cancelamento");
  assert.equal(ACAO_POR_CLASSE[t.classe], "age");
});

test("lembrete diário e código de acesso não pedem nada", () => {
  assert.equal(triarTicket({ subject: "You have 1 job on Tue 18 Aug" }).classe, "lembrete_de_plataforma");
  assert.equal(triarTicket({ subject: "Your Checkatrade one-time verification code is 753944" }).classe, "codigo_de_acesso");
});

test("pedido de quote pelo assunto e pela tag do Zendesk", () => {
  assert.equal(triarTicket({ subject: "[Housekeep] Quote Request – Plastering & Caulking (N7 9SX)" }).classe, "pedido_de_quote");
  assert.equal(
    triarTicket({ subject: "Couple of lights to replace", tags: ["intent__order__new__quote_request"] }).classe,
    "pedido_de_quote",
  );
});

test("reclamação pelo assunto, nas duas plataformas, e sem roubar job", () => {
  for (const subject of ["[Housekeep] Complaint - E5 8QN", "Complaint - UB1 2YQ"]) {
    const t = triarTicket({ subject });
    assert.equal(t.classe, "reclamacao", subject);
    // Reclamação nunca é automática: nota, e o humano decide.
    assert.equal(ACAO_POR_CLASSE[t.classe], "nota", subject);
  }
  // A regra de job continua ganhando, porque vem antes.
  assert.equal(triarTicket({ subject: "Job booked - Deep clean - E16 4DY - Wed 19 Aug 2026" }).classe, "job_de_plataforma");
});

test("disponibilidade sai do corpo, que é onde ela vive", () => {
  const t = triarTicket({
    subject: "Fixfy",
    description: "Hi, do you cover Croydon? And are you available this week for a small job?",
  });
  assert.equal(t.classe, "disponibilidade");
  assert.equal(ACAO_POR_CLASSE[t.classe], "nota");
});

test("financeiro vem da tag, que aqui é confiável porque só vira nota", () => {
  const t = triarTicket({
    subject: "Payment sent",
    tags: ["intent__billing__documentation__sending_proof_of_payment"],
  });
  assert.equal(t.classe, "financeiro");
  assert.equal(t.fonte, "tag_do_zendesk");
  assert.equal(ACAO_POR_CLASSE[t.classe], "nota");
});

test("o que não casa com nada cai no fluxo antigo, não no descarte", () => {
  const t = triarTicket({ subject: "Fixfy - Bathroom Quote" });
  assert.equal(t.classe, "indefinido");
  // `age` = segue exatamente como antes desta triagem existir.
  assert.equal(ACAO_POR_CLASSE[t.classe], "age");
});

test("nenhuma classe manda descartar um ticket que pode ser trabalho", () => {
  // A trava do desenho: só passa batido o que comprovadamente não pede nada.
  const podemPassar = ["ticket_do_os", "lembrete_de_plataforma", "codigo_de_acesso", "ruido"];
  for (const [classe, acao] of Object.entries(ACAO_POR_CLASSE)) {
    if (acao === "passa") assert.ok(podemPassar.includes(classe), `${classe} não devia passar batido`);
  }
});

test("a tag do ticket é derivada da classe, sem espaço nem acento", () => {
  assert.equal(tagDaClasse("oferta_de_lead"), "harvey_class__oferta_de_lead");
});
