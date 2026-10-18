import { describe, test } from "node:test";
import assert from "node:assert/strict";
import {
  conferirLinha,
  dataDoResumo,
  ehResumoDiario,
  horaEmLondres,
  linhasDoResumo,
  notaDoResumo,
  quantosNoAssunto,
  type JobDoResumo,
} from "./resumo-diario-housekeep";

/** Ticket 51528, 18/10/2026, o plain text como o Zendesk entrega. */
const EMAIL_51528 = `Hi Fixfy,

You have 2 jobs booked on Monday 19 October.

Please review job reports in advance to check full job details and customer notes.

Job type
Postcode
Arrival
Frequency
Hours
Total
Job report

Handyman

SW1V 3AX

09:00-15:00 start

One-off

1.0 hrs

£75.00

Link

Handyman

NW9 4DX

15:00-18:00 start

One-off

2.0 hrs

£135.00

Link

Job reports must be submitted on the same day as the visit.
Housekeep 105 Farringdon Rd, Farringdon, London EC1R 3BU`;

const job = (p: Partial<JobDoResumo>): JobDoResumo => ({
  reference: "JOB-1",
  status: "scheduled",
  client_name: "Cliente",
  property_address: "1 Street, London, SW1V 3AX",
  scheduled_date: "2026-10-19",
  scheduled_start_at: "2026-10-19T08:00:00+00:00",
  partner_name: "WHistyle Service",
  partner_id: "p1",
  client_price: 75,
  ...p,
});

describe("ehResumoDiario", () => {
  test("pega o diário e deixa o booking passar", () => {
    assert.equal(ehResumoDiario("You have 2 jobs on Mon 19 Oct"), true);
    assert.equal(ehResumoDiario("You have 1 job on Tue 18 Aug"), true);
    assert.equal(ehResumoDiario("Job booked - Handyman - NW9 4DX - Mon 19 Oct 2026"), false);
  });
});

describe("dataDoResumo", () => {
  test("ano vem de quando o e-mail chegou", () => {
    assert.equal(dataDoResumo("You have 2 jobs on Mon 19 Oct", "2026-10-18T16:04:03Z"), "2026-10-19");
  });
  test("virada de ano", () => {
    assert.equal(dataDoResumo("You have 1 job on Fri 1 Jan", "2026-12-31T16:00:00Z"), "2027-01-01");
  });
  test("assunto sem data", () => {
    assert.equal(dataDoResumo("You have jobs", "2026-10-18T16:04:03Z"), null);
  });
});

describe("linhasDoResumo", () => {
  test("lê as duas linhas do 51528 e ignora o endereço da Housekeep no rodapé", () => {
    const l = linhasDoResumo(EMAIL_51528);
    assert.equal(l.length, 2);
    assert.deepEqual(l[0], {
      tipo: "Handyman", postcode: "SW1V 3AX", chave: "SW1V3AX", inicio: "09:00", fim: "15:00", horas: 1, total: 75,
    });
    assert.equal(l[1]!.chave, "NW94DX");
    assert.equal(l[1]!.inicio, "15:00");
    assert.equal(l[1]!.total, 135);
  });
  test("quantos o assunto promete", () => {
    assert.equal(quantosNoAssunto("You have 2 jobs on Mon 19 Oct"), 2);
    assert.equal(quantosNoAssunto("You have 1 job on Tue 18 Aug"), 1);
  });
});

describe("conferirLinha", () => {
  const linha = linhasDoResumo(EMAIL_51528)[0]!;

  test("job vivo, com parceiro, no postcode: booked", () => {
    const c = conferirLinha(linha, [job({})]);
    assert.equal(c.job?.reference, "JOB-1");
    assert.deepEqual(c.falta, []);
    assert.deepEqual(c.avisos, []);
  });
  test("sem job no OS", () => {
    const c = conferirLinha(linha, [job({ property_address: "Other, E1 6AN" })]);
    assert.equal(c.job, null);
    assert.equal(c.falta.length, 1);
  });
  test("cancelado não conta", () => {
    const c = conferirLinha(linha, [job({ status: "cancelled" })]);
    assert.equal(c.job, null);
  });
  test("sem parceiro segura o ticket", () => {
    const c = conferirLinha(linha, [job({ partner_id: null, partner_name: null })]);
    assert.deepEqual(c.falta, ["no partner assigned"]);
  });
  test("dois no mesmo postcode é ambíguo", () => {
    const c = conferirLinha(linha, [job({}), job({ reference: "JOB-2" })]);
    assert.equal(c.job, null);
    assert.equal(c.ambiguos.length, 2);
  });
  test("preço e horário diferentes só avisam", () => {
    const c = conferirLinha(linha, [job({ client_price: 90, scheduled_start_at: "2026-10-19T15:00:00+00:00" })]);
    assert.deepEqual(c.falta, []);
    assert.equal(c.avisos.length, 2);
  });
});

describe("notaDoResumo", () => {
  test("tudo booked fecha", () => {
    const l = linhasDoResumo(EMAIL_51528);
    const cs = [conferirLinha(l[0]!, [job({})]), conferirLinha(l[1]!, [job({ reference: "JOB-2", property_address: "Flat 57, NW9 4DX", client_price: 135, scheduled_start_at: "2026-10-19T14:00:00+00:00" })])];
    const n = notaDoResumo("2026-10-19", cs, 2);
    assert.equal(n.ok, true);
    assert.match(n.corpo, /Solving this ticket/);
  });
  test("linha a menos que o assunto não fecha", () => {
    const l = linhasDoResumo(EMAIL_51528);
    const n = notaDoResumo("2026-10-19", [conferirLinha(l[0]!, [job({})])], 2);
    assert.equal(n.ok, false);
  });
});

describe("horaEmLondres", () => {
  test("BST", () => assert.equal(horaEmLondres("2026-10-19T08:00:00+00:00"), "09:00"));
  test("GMT", () => assert.equal(horaEmLondres("2026-11-02T08:00:00+00:00"), "08:00"));
});
