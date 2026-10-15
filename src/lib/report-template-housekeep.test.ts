/**
 * O template do relatório decide o formulário da Housekeep, e por isso este
 * teste existe.
 *
 * Havia duas listas de palavras em arquivos diferentes: a do OS, que escolhe o
 * que o escritório digita, e uma regex dentro da Stefane, que escolhia o
 * formulário a preencher. Elas discordavam numa palavra, `tenancy`. O job mais
 * comum da Housekeep chama-se "(EOT) End of Tenancy": o escritório digitava um
 * relatório chapado e a Stefane o submetia no formulário de limpeza, que
 * pergunta cômodo a cômodo. 29 dos 182 jobs Housekeep estavam assim.
 *
 * Os casos abaixo são títulos reais, com a contagem que tinham na base em
 * 14/08/2026. Se alguém encurtar a lista de palavras, é aqui que quebra.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  pickReportTemplate,
  usesCleaningForm,
  photoSlotsForTemplate,
  type ReportTemplate,
} from "./public-report-templates";

const tpl = (title: string): ReportTemplate => pickReportTemplate({ title });

test("toda limpeza da Housekeep cai no template por cômodo", () => {
  for (const titulo of [
    "(EOT) End of Tenancy",        // 29 jobs, o que estava errado
    "Cleaning",                    // 11
    "(AB) After Builders Cleaning", // 4
    "(DC) Deep Cleaning",          // 2
    "Domestic Clean",
    "End of tenancy clean",
  ]) {
    assert.equal(tpl(titulo), "cleaner", `"${titulo}" precisa ser cleaner`);
    assert.equal(usesCleaningForm(tpl(titulo)), true, `"${titulo}" vai ao formulário de limpeza`);
  }
});

test("o que não é limpeza vai ao formulário de trade", () => {
  for (const [titulo, esperado] of [
    ["General Maintenance", "general"],
    ["Carpenter", "general"],
    ["Painter", "general"],
    ["Plumber", "general"],
    ["Handyman - Furniture Assembly", "general"],
  ] as const) {
    assert.equal(tpl(titulo), esperado, `"${titulo}"`);
    assert.equal(usesCleaningForm(tpl(titulo)), false, `"${titulo}" não é formulário de limpeza`);
  }
});

test("a categoria do serviço decide antes da palavra (15/10/2026)", () => {
  assert.equal(pickReportTemplate({ title: "Deep clean", categorySlug: "general-maintenance" }), "general");
  assert.equal(pickReportTemplate({ title: "Painter", categorySlug: "cleaning" }), "cleaner");
  assert.equal(pickReportTemplate({ title: "Anything", categorySlug: "certificates" }), "certificate");
  // Sem categoria conhecida, vale a palavra.
  assert.equal(pickReportTemplate({ title: "End of Tenancy Clean", categorySlug: null }), "cleaner");
  // Jardinagem saiu: não existe mais formulário próprio.
  assert.equal(pickReportTemplate({ title: "Garden clean up" }), "cleaner");
  assert.equal(pickReportTemplate({ title: "Gardener" }), "general");
});

test("o template de limpeza é o único que pede foto por cômodo", () => {
  const limpeza = photoSlotsForTemplate("cleaner");
  const chaves = limpeza.final.map((s) => s.key);
  for (const comodo of ["living_room", "kitchen", "bathrooms", "bedrooms"]) {
    assert.ok(chaves.includes(comodo), `falta o slot ${comodo}`);
  }
  // O chapado tem um bloco só, e é essa diferença que o bug apagava.
  assert.equal(photoSlotsForTemplate("general").final.length < chaves.length, true);
});

test("EICR com 'domestic' no título é certificado, nunca limpeza", () => {
  // JOB-9406, 17/08/2026: "2 Bed Domestic EICR Safety Check" caía no
  // formulário de cômodos porque "domestic" casava antes do certificado.
  assert.equal(pickReportTemplate({ title: "2 Bed Domestic EICR Safety Check (<=8 Ckts)" }), "certificate");
});

test("EPC é certificado", () => {
  assert.equal(pickReportTemplate({ title: "(EPC) Energy Performance Certificate" }), "certificate");
});
