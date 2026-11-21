import { test } from "node:test";
import assert from "node:assert/strict";
import { triarTicket, ACAO_POR_CLASSE, tagDaClasse, semCotacao, numerosDeJobCitados } from "./zendesk-triage";

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
  // pedido_de_cobertura é trabalho, mas da equipe (dono, 26/10/2026): o ticket fica aberto na fila
  // dela, o Harvey só não mexe.
  const podemPassar = ["ticket_do_os", "lembrete_de_plataforma", "codigo_de_acesso", "ruido", "pedido_de_cobertura"];
  for (const [classe, acao] of Object.entries(ACAO_POR_CLASSE)) {
    if (acao === "passa") assert.ok(podemPassar.includes(classe), `${classe} não devia passar batido`);
  }
});

test("a tag do ticket é derivada da classe, sem espaço nem acento", () => {
  assert.equal(tagDaClasse("oferta_de_lead"), "harvey_class__oferta_de_lead");
});

test("cobertura da Housekeep não é quote: o Harvey não age (26/10/2026)", () => {
  const t = triarTicket({
    subject: "[Housekeep] Job needing coverage: Handyperson | Odd jobs in SW12 8JT on 26/10/26",
    tags: ["intent__order__new__quote_request"],
  });
  assert.equal(t.classe, "pedido_de_cobertura");
  assert.equal(ACAO_POR_CLASSE[t.classe], "passa");
});

test("reclamação sem a palavra no assunto: o texto real do #52299 (Li & Fung, 09/11/2026)", () => {
  const t = triarTicket({
    subject: "Outstanding Works - Li& Fung",
    description:
      "Hello Guys, I hope you are well. I am writing regarding three items: Sink Blockage Unfortunately, the sink is still blocked following the engineer's recent visit. Could we please arrange a return visit at your earliest convenience?",
  });
  assert.equal(t.classe, "reclamacao");
  assert.equal(t.fonte, "corpo");
  // Virou quote ao vivo. Agora nunca chega ao classificador de preço.
  assert.equal(semCotacao(t), true);
});

test("cobrança de resposta sobre job que já existe: o texto real do #51868", () => {
  const texto =
    "We are following up on two outstanding jobs for which we have yet to receive an update, despite several follow-ups with the Fixfy team via WhatsApp. 1. E16 2HF – Job Ref: 9695 ... 2. SW9 0SL – Job Ref: 9704";
  const t = triarTicket({ subject: "Update on Call Out Amount for 9704 and Pending Quote for 9695", description: texto });
  assert.equal(semCotacao(t), true);
  // O worker confere estes números no banco antes de chamar de job existente.
  assert.deepEqual(numerosDeJobCitados(`Update on Call Out Amount for 9704\n${texto}`).sort(), ["9695", "9704"]);
});

test("pedido novo com 'still' não é reclamação: falta o trabalho nosso antes", () => {
  for (const description of [
    "Hi, my kitchen tap is still leaking and I'd like it replaced. Could you quote?",
    "The engineer attended yesterday and did a great job, thanks. Can we book another visit for the boiler?",
  ]) {
    const t = triarTicket({ subject: "Fixfy", description });
    assert.notEqual(t.classe, "reclamacao", description);
  }
});

test("o assunto continua ganhando do corpo", () => {
  const t = triarTicket({
    subject: "[Housekeep] Quote Request – Painting Works in N1 2NH",
    description: "The wall is still damp following the previous decorator's work, please quote to repaint.",
  });
  assert.equal(t.classe, "pedido_de_quote");
  // Reclamação vinda do assunto segue o fluxo de sempre.
  assert.equal(semCotacao(triarTicket({ subject: "[Housekeep] Complaint - E5 8QN" })), false);
});

test("JOB-#### no texto é assunto de job que já existe; no começo do assunto é ticket do OS", () => {
  const t = triarTicket({ subject: "Question", description: "Hi, about JOB-9704 at our office, can the professional come earlier?" });
  assert.equal(t.classe, "sobre_job_existente");
  assert.equal(ACAO_POR_CLASSE[t.classe], "nota");
  assert.equal(semCotacao(t), true);
  assert.equal(triarTicket({ subject: "JOB-9704 · Blinds · Kvadrat" }).classe, "ticket_do_os");
});

test("lembrete de reports da Housekeep não é financeiro (12 de 14 fechados na mão)", () => {
  const t = triarTicket({
    subject: "Reminder: you have unsubmitted job reports",
    tags: ["intent__billing__invoice"],
  });
  assert.equal(t.classe, "lembrete_de_plataforma");
  assert.equal(ACAO_POR_CLASSE[t.classe], "passa");
});

test("replay de 30 dias: no-show é reclamação, e-mail que não chegou não é", () => {
  // #51708: a Housekeep repassa que ninguém apareceu.
  assert.equal(
    triarTicket({ subject: "[Housekeep] Handyman tomorrow: NW9 4DX", description: "Hi Team Can we have an update on this job? The customer has said that nobody attended the job. Is that correct?" }).classe,
    "reclamacao",
  );
  // #51531: "the individual job emails didn't arrive" virava reclamação na 1ª versão.
  assert.notEqual(
    triarTicket({ subject: "WHistyle · Your Fixfy jobs this week", description: "Weekly job list sent by email (they said the individual job emails didn't arrive)." }).classe,
    "reclamacao",
  );
});

test("e-mail nosso que virou ticket não vai para a fila humana", () => {
  for (const subject of [
    "Almost there, Leo: confirm your booking for Wednesday 14 October",
    "Confirm your Fixfy booking · Tuesday 20 October",
    "Your invoice INV-2026-904 is ready",
    "Outstanding invoice INV-2026-245 · JOB-9011 · £80.00",
  ]) {
    assert.equal(triarTicket({ subject, description: "… JOB-9011 …" }).classe, "ticket_do_os", subject);
  }
  // Fatura de fornecedor com JOB no corpo e tag de financeiro continua financeiro.
  assert.equal(triarTicket({ subject: "EICR Report", description: "Invoice for JOB-9500", tags: ["intent__billing__invoice"] }).classe, "financeiro");
});
