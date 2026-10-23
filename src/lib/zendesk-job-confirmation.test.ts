import { test } from "node:test";
import assert from "node:assert/strict";
import { ehContaPropria, resolveCustomerGreetingName } from "./zendesk-job-confirmation";

test("conta com o nome da nossa empresa é a dos clientes diretos", () => {
  assert.equal(ehContaPropria("Fixfy", "Fixfy"), true);
  assert.equal(ehContaPropria(" fixfy ", "Fixfy"), true);
  assert.equal(ehContaPropria("Housekeep", "Fixfy"), false);
  assert.equal(ehContaPropria("Fixfy", null), false);
  assert.equal(ehContaPropria(null, "Fixfy"), false);
});

test("cliente direto é chamado pelo primeiro nome, organização pelo nome dela", () => {
  assert.equal(resolveCustomerGreetingName(null, "Catherine Dennis"), "Catherine");
  assert.equal(resolveCustomerGreetingName("Housekeep", "Julian Smith"), "Housekeep");
  assert.equal(resolveCustomerGreetingName(null, ""), "there");
});

import {
  buildJobConfirmationEmail,
  buildJobRescheduledEmail,
  formatJobConfirmationArrivalWindow,
  formatJobConfirmationLongDate,
  janelaDoAviso,
  lerLinhaDaAgenda,
} from "./zendesk-job-confirmation";

const SEM = (t: string) => {
  assert.doesNotMatch(t, /[–—]/);
  assert.doesNotMatch(t, /\{\{/);
};

const base = {
  greetingName: "Sarah",
  jobReference: "JOB-9800",
  jobTitle: "Handyman",
  jobDate: formatJobConfirmationLongDate("2026-10-21"),
  arrivalWindow: formatJobConfirmationArrivalWindow({ scheduled_start_at: "2026-10-21T08:00:00Z", scheduled_end_at: "2026-10-21T11:00:00Z" }),
  propertyAddress: "12 Example Road, London",
  propertyPostcode: "E1 6AN",
  typeOfWork: "Handyman",
};

test("data e janela no formato da copy", () => {
  assert.equal(base.jobDate, "Wed 21 Oct 26");
  assert.equal(base.arrivalWindow, "09:00-12:00");
  assert.equal(janelaDoAviso("9 AM – 12 PM"), "09:00-12:00");
  assert.equal(janelaDoAviso("To be confirmed"), null);
  assert.deepEqual(lerLinhaDaAgenda("2026-10-21", "9AM – 12PM"), { data: "Wed 21 Oct 26", janela: "09:00-12:00" });
});

test("#1 confirmação: B2C pelo primeiro nome, linhas e sem travessão", () => {
  const m = buildJobConfirmationEmail({ ...base, publico: { tipo: "b2c", primeiroNome: "Sarah" } });
  assert.equal(m.subject, "Your Fixfy booking is confirmed · Wed 21 Oct 26");
  assert.match(m.text, /^Hi Sarah,$/m);
  assert.match(m.text, /Your professional is confirmed for Wed 21 Oct 26, arriving 09:00-12:00\./);
  assert.match(m.text, /Property: 12 Example Road, London, E1 6AN/);
  assert.match(m.text, /Booking: JOB-9800/);
  assert.doesNotMatch(m.html, /<table[^>]*><tr><td[^>]*>.*<table/); // comentário do Zendesk: sem tabela interna
  SEM(m.html);
  SEM(m.text);
});

test("#1 confirmação: organização resolvida vira B2B 'Hi {empresa} team,'", () => {
  const nome = resolveCustomerGreetingName("Acme Lettings", "Julian Bajada");
  const m = buildJobConfirmationEmail({ ...base, greetingName: nome });
  assert.match(m.text, /^Hi Acme Lettings team,$/m);
  assert.doesNotMatch(m.text, /Julian/);
});

test("#1 confirmação sem janela: diz que a hora vem depois", () => {
  const m = buildJobConfirmationEmail({ ...base, arrivalWindow: "To be confirmed" });
  assert.match(m.text, /We’ll confirm the arrival time before the visit\./);
  assert.doesNotMatch(m.text, /Arrival:/);
  SEM(m.text);
});

test("#5 remarcação para a conta: assunto, antes e depois, B2B", () => {
  const m = buildJobRescheduledEmail({
    ...base,
    greetingName: "",
    publico: { tipo: "b2b", empresa: "Acme Lettings" },
    previousDate: "2026-10-19",
    previousArrivalWindow: "1 PM – 4 PM",
    iniciadoPelaFixfy: true,
  });
  assert.equal(m.subject, "Booking rescheduled · JOB-9800 · Wed 21 Oct 26");
  assert.match(m.text, /^Hi Acme Lettings team,$/m);
  assert.match(m.text, /Previous visit: Mon 19 Oct 26 · 13:00-16:00/);
  assert.match(m.text, /Revised visit: Wed 21 Oct 26 · 09:00-12:00/);
  assert.match(m.text, /We’re sorry for the disruption\./);
  SEM(m.html);
  SEM(m.text);
  const semEmpresa = buildJobRescheduledEmail({ ...base, greetingName: "", publico: { tipo: "b2b", empresa: null }, previousDate: "2026-10-19" });
  assert.match(semEmpresa.text, /^Hi team,$/m);
  assert.doesNotMatch(semEmpresa.text, /sorry/);
});
