import { strict as assert } from "node:assert";
import { test } from "node:test";
import { podeSerCard } from "./quoter";

test("a assinatura do e-mail nao e card", () => {
  // Os cinco links do ticket 49174, que fizeram o JOB-9493 nascer apontando
  // para a home da plataforma.
  const daAssinatura = [
    "https://housekeep.com",
    "https://housekeep.com/?utm_source=housekeep_zendesk_signature&utm_medium=email",
    "https://housekeep.com/tradespeople/gardener/regions-all/?utm_source=housekeep_zendesk_signature",
    "https://housekeep.com/tradespeople/?utm_source=housekeep_zendesk_signature",
    "http://s3-eu-west-1.amazonaws.com/housekeepassets/email/Housekeep_Wordmark_White_480.png",
  ];
  for (const u of daAssinatura) assert.equal(podeSerCard(u), false, `deixou passar ${u}`);
});

test("o endereco direto do card entra", () => {
  assert.equal(podeSerCard("https://housekeep.com/job-reports/0e9aee28da134a08a5fe5102fdf20294"), true);
  assert.equal(podeSerCard("https://housekeep.com/job-reports/abc123?utm_campaign=x"), true);
});

test("o link rastreado entra: so seguindo da pra saber", () => {
  assert.equal(podeSerCard("https://links.housekeep.com/ls/click?upn=u001.hgeYll9qlX7TMan3"), true);
});

test("rastreado que nao e /ls/click fica de fora", () => {
  assert.equal(podeSerCard("https://links.housekeep.com/unsubscribe?id=9"), false);
});

test("lixo nao derruba", () => {
  for (const u of ["", "nao e url", "javascript:alert(1)"]) assert.equal(podeSerCard(u), false);
});
