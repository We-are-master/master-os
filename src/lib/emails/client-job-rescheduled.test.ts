import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClientJobRescheduledEmail } from "./client-job-rescheduled";

const base = {
  clientFirstName: "Sarah",
  jobReference: "JOB-9800",
  jobTitle: "Handyman",
  propertyAddress: "12 Example Road, London E1 6AN",
  oldDateLine: "2026-10-19",
  oldTimeLine: "1 PM – 4 PM",
  newDateLine: "Wed 21 Oct 26",
  newTimeLine: "between 9am and midday",
};

test("#6 remarcação ao cliente: assunto, saudação B2C e as duas datas", () => {
  const m = buildClientJobRescheduledEmail({ ...base, iniciadoPelaFixfy: false });
  assert.equal(m.subject, "Your booking has been rescheduled · Wed 21 Oct 26");
  assert.match(m.text, /^Hi Sarah,$/m);
  assert.match(m.text, /Previously: Mon 19 Oct 26 · between 1pm and 4pm/);
  assert.match(m.text, /Now: Wed 21 Oct 26 · between 9am and midday/);
  assert.match(m.text, /Thanks for keeping us up to date\./);
  for (const t of [m.subject, m.html, m.text]) {
    assert.doesNotMatch(t, /[–—]/);
    assert.doesNotMatch(t, /\{\{/);
  }
});

test("#6 Fixfy mudou: pede desculpas; sem saber, nenhum fecho", () => {
  assert.match(buildClientJobRescheduledEmail({ ...base, iniciadoPelaFixfy: true }).text, /We’re sorry for the change of plan/);
  const neutro = buildClientJobRescheduledEmail(base).text;
  assert.doesNotMatch(neutro, /sorry|Thanks for keeping/);
});

test("#6 B2B e sem nome", () => {
  assert.match(buildClientJobRescheduledEmail({ ...base, publico: { tipo: "b2b", empresa: "Acme Lettings" } }).text, /^Hi Acme Lettings team,$/m);
  assert.match(buildClientJobRescheduledEmail({ ...base, clientFirstName: "" }).text, /^Hi there,$/m);
});
