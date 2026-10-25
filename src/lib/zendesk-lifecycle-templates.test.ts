import { strict as assert } from "node:assert";
import { test } from "node:test";
import { buildJobCancelled, buildJobCompleted, buildQuoteRejected, publicoDoAviso } from "./zendesk-lifecycle-templates";

const SARAH = publicoDoAviso(null, "Sarah Jones");
const ACME = publicoDoAviso("Acme Lettings", "Sarah Jones");

const todos = () => [
  buildJobCompleted({ publico: SARAH, reference: "JOB-9800", service: "End of Tenancy Clean", propertyAddress: "12 Elm Road, London SE12 8AA", photoCount: 3 }),
  buildJobCompleted({ publico: ACME, reference: "JOB-9800", service: "General Maintenance", photoCount: 0 }),
  buildJobCancelled({ publico: SARAH, reference: "JOB-9800", service: "Deep Clean", visitDate: "2026-10-21" }),
  buildJobCancelled({ publico: ACME, reference: "JOB-9800", service: "Deep Clean", visitDate: null }),
  buildQuoteRejected({ publico: SARAH, reference: "QT-1234", service: "Painting" }),
  buildQuoteRejected({ publico: ACME, reference: "QT-1234", service: "" }),
];

test("#37 assunto, fotos só quando anexadas, sem promessa de fatura", () => {
  const com = buildJobCompleted({ publico: SARAH, reference: "JOB-9800", service: "End of Tenancy Clean", propertyAddress: "12 Elm Road", photoCount: 3 });
  assert.equal(com.assunto, "Your End of Tenancy Clean work is complete · JOB-9800");
  assert.match(com.texto, /we’ve attached photos of the finished work/);
  assert.match(com.texto, /COMPLETED/);
  const sem = buildJobCompleted({ publico: SARAH, reference: "JOB-9800", service: "Deep Clean", photoCount: 0 });
  assert.doesNotMatch(sem.html + sem.texto + sem.preheader, /photo/i);
  for (const a of [com, sem]) assert.doesNotMatch(a.html + a.texto, /invoice|signed it off/i);
});

test("#38 data longa, sem frase de reembolso, sem data some a frase", () => {
  const a = buildJobCancelled({ publico: SARAH, reference: "JOB-9800", service: "Deep Clean", visitDate: "2026-10-21" });
  assert.equal(a.assunto, "Your booking has been cancelled · JOB-9800");
  assert.match(a.texto, /Your booking for Deep Clean on Wed 21 Oct 26 has been cancelled\./);
  assert.doesNotMatch(a.html + a.texto, /refund/i);
  const b = buildJobCancelled({ publico: SARAH, reference: "JOB-9800", service: "Deep Clean" });
  assert.match(b.texto, /Your booking for Deep Clean has been cancelled\./);
});

test("#23 não repete a nota de recusa e o WhatsApp é texto puro", () => {
  const q = buildQuoteRejected({ publico: SARAH, reference: "QT-1234", service: "Painting" });
  assert.equal(q.assunto, "Your quote has been closed · QT-1234");
  assert.match(q.texto, /won’t be going ahead with quote QT-1234 for Painting/);
  assert.doesNotMatch(q.whatsapp, /</);
  assert.ok(q.whatsapp.startsWith("Hi Sarah,"));
});

test("saudação: B2C pelo primeiro nome, B2B pela empresa, nunca o contato", () => {
  for (const a of todos()) {
    const b2b = a.texto.includes("Acme");
    if (b2b) {
      assert.match(a.texto, /Hi Acme Lettings team,/);
      assert.doesNotMatch(a.texto + a.html + a.whatsapp, /Sarah/);
    } else {
      assert.match(a.texto, /Hi Sarah,/);
    }
  }
  assert.match(buildQuoteRejected({ publico: publicoDoAviso("Acme Lettings Team", "x"), reference: "Q", service: "" }).texto, /Hi Acme Lettings Team,/);
  assert.match(buildQuoteRejected({ publico: publicoDoAviso(null, ""), reference: "Q", service: "" }).texto, /Hi there,/);
});

test("sem travessão, sem placeholder, sem emoji e com escape", () => {
  for (const a of todos()) {
    const tudo = a.assunto + a.preheader + a.html + a.texto + a.whatsapp;
    assert.doesNotMatch(tudo, /[—–]/);
    assert.ok(!tudo.includes("{{"));
    assert.doesNotMatch(tudo, /✓|\p{Extended_Pictographic}/u);
  }
  const x = buildJobCancelled({ publico: publicoDoAviso("<b>Evil</b>", ""), reference: "JOB-1", service: "<script>", propertyAddress: "a & b" });
  assert.ok(!x.html.includes("<script>") && !x.html.includes("<b>Evil"));
  assert.match(x.html, /a &amp; b/);
});

test("cancelado: chip vermelho e a data da visita riscada", async () => {
  const { buildJobCancelled } = await import("./zendesk-lifecycle-templates");
  const a = buildJobCancelled({ publico: { tipo: "b2c", primeiroNome: "Sarah" } as never, reference: "JOB-9800", service: "General Maintenance", visitDate: "2026-10-28" } as never);
  assert.match(a.html, /background:#FDECEC;color:#C62828[^>]*>Cancelled</);
  assert.match(a.html, /text-decoration:line-through[^>]*>Wed 28 Oct 26</);
});

test("#37 com o report na web: do report completo quando há link; sem link, nada", () => {
    const base = { publico: { tipo: "b2b" as const, empresa: "Housekeep" }, reference: "JOB-9800", service: "End of Tenancy Clean" };
    const com = buildJobCompleted({ ...base, reportUrl: "https://app.getfixfy.com/report/abc" });
    assert.match(com.html, /href="https:\/\/app\.getfixfy\.com\/report\/abc"[^>]*>See the full report</);
    assert.match(com.whatsapp, /Full report: https:\/\/app\.getfixfy\.com\/report\/abc/);
    assert.doesNotMatch(buildJobCompleted(base).html, /See the full report/);
});
