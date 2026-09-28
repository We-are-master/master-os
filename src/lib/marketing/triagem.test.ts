import { strict as assert } from "node:assert";
import { test } from "node:test";
import { MOTIVOS, chavesVazias, motivoDoPulo, pessoaDaLinha, type FatosDaTriagem, type Pessoa } from "./triagem";
import { escolherLembretes } from "./campanha";
import { notaDaCampanha } from "./zendesk-respostas";

const INICIO = Date.parse("2026-09-27T23:00:00Z");
const ANTES = INICIO - 10 * 86400000;
const DEPOIS = INICIO + 86400000;
const EMAIL_SAIU = Date.parse("2026-09-29T08:15:00Z");

const fatos = (over: Partial<FatosDaTriagem> = {}): FatosDaTriagem => ({
  inicio: INICIO,
  bloqueioEmail: new Map(),
  bloqueioFone: new Map(),
  semMarketing: new Set(),
  optOutSite: chavesVazias(),
  comprou: chavesVazias(),
  respondeu: chavesVazias(),
  ultimoTicketPorEmail: new Map(),
  ...over,
});
const chaves = (c: { clientes?: string[]; emails?: string[]; fones?: string[] }) => ({
  clientes: new Set(c.clientes ?? []),
  emails: new Set(c.emails ?? []),
  fones: new Set(c.fones ?? []),
});

const followup = (over: Partial<Pessoa> = {}): Pessoa => ({
  passo: "wa_followup", canal: "whatsapp", clientId: "c1", endereco: "447700900001",
  emails: ["jane@gmail.com"], fones: ["447700900001"], emailSaiuEm: EMAIL_SAIU, ...over,
});
const oferta = (over: Partial<Pessoa> = {}): Pessoa => ({
  passo: "wa_oferta", canal: "whatsapp", clientId: "c2", endereco: "447700900002",
  emails: [], fones: ["447700900002"], emailSaiuEm: null, ...over,
});
const email = (over: Partial<Pessoa> = {}): Pessoa => ({
  passo: "email_quente", canal: "email", clientId: "c3", endereco: "ana@gmail.com",
  emails: ["ana@gmail.com"], fones: ["447700900003"], emailSaiuEm: null, ...over,
});

test("ninguém comprou, respondeu ou saiu: tudo sai", () => {
  assert.equal(motivoDoPulo(followup(), fatos()), null);
  assert.equal(motivoDoPulo(oferta(), fatos()), null);
  assert.equal(motivoDoPulo(email(), fatos()), null);
});

test("respondeu ao e-mail (toque carimbado): o follow-up não sai", () => {
  assert.equal(motivoDoPulo(followup(), fatos({ respondeu: chaves({ clientes: ["c1"] }) })), MOTIVOS.respondeu);
  assert.equal(motivoDoPulo(followup(), fatos({ respondeu: chaves({ emails: ["jane@gmail.com"] }) })), MOTIVOS.respondeu);
});

test("ticket no Zendesk vindo do e-mail dela: só conta se abriu depois do e-mail", () => {
  const depois = fatos({ ultimoTicketPorEmail: new Map([["jane@gmail.com", EMAIL_SAIU + 3600000]]) });
  const antes = fatos({ ultimoTicketPorEmail: new Map([["jane@gmail.com", EMAIL_SAIU - 3600000]]) });
  assert.equal(motivoDoPulo(followup(), depois), MOTIVOS.respondeuNoZendesk);
  assert.equal(motivoDoPulo(followup(), antes), null);
  assert.equal(motivoDoPulo(followup({ emailSaiuEm: null }), depois), null);
});

test("resposta só segura o follow-up; o lembrete e a oferta seguem as outras regras", () => {
  const respondeu = fatos({ respondeu: chaves({ clientes: ["c3", "c2"] }) });
  assert.equal(motivoDoPulo(email({ passo: "email_lembrete" }), respondeu), null);
  assert.equal(motivoDoPulo(oferta(), respondeu), null);
});

test("comprou desde o início da campanha: não sai nada, por qualquer cadastro dela", () => {
  assert.equal(motivoDoPulo(followup(), fatos({ comprou: chaves({ emails: ["jane@gmail.com"] }) })), MOTIVOS.comprou); // lead do site pago
  assert.equal(motivoDoPulo(oferta(), fatos({ comprou: chaves({ clientes: ["c2"] }) })), MOTIVOS.comprou); // job no cliente
  assert.equal(motivoDoPulo(email(), fatos({ comprou: chaves({ fones: ["447700900003"] }) })), MOTIVOS.comprou); // job em cadastro duplicado
  assert.equal(motivoDoPulo(email({ passo: "email_lembrete" }), fatos({ comprou: chaves({ emails: ["ana@gmail.com"] }) })), MOTIVOS.comprou);
});

test("o endereço desta mensagem bloqueado, por qualquer motivo e de quando for: não sai", () => {
  const foneMorto = fatos({ bloqueioFone: new Map([["447700900002", { motivo: "invalid", desde: ANTES }]]) });
  const emailMorto = fatos({ bloqueioEmail: new Map([["ana@gmail.com", { motivo: "bounced", desde: DEPOIS }]]) });
  assert.equal(motivoDoPulo(oferta(), foneMorto), MOTIVOS.bloqueado);
  assert.equal(motivoDoPulo(email(), emailMorto), MOTIVOS.bloqueado);
});

test("recusa que apareceu no meio da campanha vale para os dois canais", () => {
  const unsub = fatos({ bloqueioEmail: new Map([["jane@gmail.com", { motivo: "unsubscribed", desde: DEPOIS }]]) });
  const spam = fatos({ bloqueioEmail: new Map([["jane@gmail.com", { motivo: "complained", desde: DEPOIS }]]) });
  const stop = fatos({ bloqueioFone: new Map([["447700900003", { motivo: "stopped", desde: DEPOIS }]]) });
  assert.equal(motivoDoPulo(followup(), unsub), MOTIVOS.saiu);
  assert.equal(motivoDoPulo(followup(), spam), MOTIVOS.saiu);
  assert.equal(motivoDoPulo(email(), stop), MOTIVOS.saiu);
});

test("bloqueio de antes da campanha no outro canal não segura (a fila já tirou só aquele canal)", () => {
  const antigo = fatos({ bloqueioEmail: new Map([["velho@gmail.com", { motivo: "unsubscribed", desde: ANTES }]]) });
  assert.equal(motivoDoPulo(oferta({ emails: ["velho@gmail.com"] }), antigo), null);
});

test("endereço morto não é recusa: fecha só o canal dele", () => {
  const bounce = fatos({ bloqueioEmail: new Map([["jane@gmail.com", { motivo: "bounced", desde: DEPOIS }]]) });
  const semWhats = fatos({ bloqueioFone: new Map([["447700900003", { motivo: "invalid", desde: DEPOIS }]]) });
  assert.equal(motivoDoPulo(followup(), bounce), null);
  assert.equal(motivoDoPulo(email(), semWhats), null);
});

test("tag no-marketing e opt-out no site tiram a pessoa", () => {
  assert.equal(motivoDoPulo(followup(), fatos({ semMarketing: new Set(["c1"]) })), MOTIVOS.saiu);
  assert.equal(motivoDoPulo(oferta(), fatos({ optOutSite: chaves({ fones: ["447700900002"] }) })), MOTIVOS.saiu);
});

test("a pessoa da linha junta o cadastro e o e-mail da campanha", () => {
  const p = pessoaDaLinha(
    { id: "q1", client_id: "c1", grupo: "os_dois", passo: "wa_followup", email: null, phone: "447700900001" },
    { email: " Jane@Gmail.com", phone: "07700 900001" },
    { email: "jane@gmail.com", enviado_em: "2026-09-29T08:15:00Z" },
  );
  assert.deepEqual(p, {
    passo: "wa_followup", canal: "whatsapp", clientId: "c1", endereco: "447700900001",
    emails: ["jane@gmail.com"], fones: ["447700900001"], emailSaiuEm: EMAIL_SAIU,
  });
  const e = pessoaDaLinha({ id: "q2", client_id: null, grupo: "so_email", passo: "email_lembrete", email: "Ana@Gmail.com", phone: null });
  assert.equal(e.canal, "email");
  assert.equal(e.endereco, "ana@gmail.com");
  assert.deepEqual(e.fones, []);
});

test("lembrete: só checkout abandonado que veio da WEEK10 ou recebeu e-mail dela", () => {
  const quando = new Date("2026-10-01T08:30:00Z");
  const { linhas, fora } = escolherLembretes(
    [
      { email: "a@gmail.com", full_name: "anna smith", phone: null, client_id: "cA", source: { utm_campaign: "week10_email_quente" } },
      { email: "b@gmail.com", full_name: null, phone: null, client_id: null, source: {} },
      { email: "c@gmail.com", full_name: "Carl", phone: null, client_id: "cC", source: { utm_campaign: "meta_eot" } },
      { email: null, full_name: "Dan", phone: "07700900004", client_id: "cD", source: { utm_campaign: "week10_wa_oferta" } },
      { email: "e@gmail.com", full_name: "Eve", phone: null, client_id: "cE", source: { utm_campaign: "week10_email_oferta" } },
      { email: " A@gmail.com", full_name: "Anna", phone: null, client_id: null, source: { utm_campaign: "week10_email_quente" } },
      { email: "g@gmail.com", full_name: "Gus", phone: null, client_id: "cG", source: { utm_campaign: "WEEK10_wa_oferta" } },
    ],
    { campanha: "week10", receberamEmail: new Set(["b@gmail.com"]), jaNaFila: { clientes: new Set(["cE"]), emails: new Set() }, quando },
  );
  assert.deepEqual(linhas.map((l) => [l.email, l.client_id, l.primeiro_nome]), [
    ["a@gmail.com", "cA", "Anna"],
    ["b@gmail.com", null, "there"],
    ["g@gmail.com", "cG", "Gus"],
  ]);
  for (const l of linhas) {
    assert.equal(l.passo, "email_lembrete");
    assert.equal(l.canal, "email");
    assert.equal(l.grupo, "so_email");
    assert.equal(l.phone, null);
    assert.equal(l.agendado_para, "2026-10-01T08:30:00.000Z");
  }
  assert.deepEqual(fora, { sem_email: 1, fora_da_campanha: 1, ja_na_fila: 1, duplicado: 1 });
});

test("lembrete sem cliente não entra duas vezes: quem já está na fila sai pelo e-mail", () => {
  const { linhas, fora } = escolherLembretes(
    [{ email: "b@gmail.com", full_name: null, phone: null, client_id: null, source: { utm_campaign: "week10_email_oferta" } }],
    { campanha: "week10", receberamEmail: new Set(), jaNaFila: { clientes: new Set(), emails: new Set(["b@gmail.com"]) }, quando: new Date() },
  );
  assert.equal(linhas.length, 0);
  assert.equal(fora.ja_na_fila, 1);
});

test("nota do ticket: o que recebeu, hora de Londres, código e link, sem travessão", () => {
  const nota = notaDaCampanha([
    { passo: "email_quente", enviado_em: "2026-09-29T08:15:00Z" },
    { passo: "wa_followup", enviado_em: "2026-09-29T14:05:00Z" },
  ]);
  assert.match(nota, /WEEK10/);
  assert.match(nota, /Email "Fixed-price cleaning in London is here", sent Tue 29\/09 09:15 \(London time\)/);
  assert.match(nota, /WhatsApp follow-up \(template fixfy_week10_followup_v2\), sent Tue 29\/09 15:05 \(London time\)/);
  assert.match(nota, /promo=WEEK10/);
  assert.match(nota, /utm_campaign=week10_email_quente/);
  assert.match(nota, /utm_campaign=week10_wa_followup/);
  assert.equal(nota.includes("—"), false);
});
