/**
 * The worth-taking rules, checked against REAL Checkatrade titles and prices
 * observed on the board and in the 48 historical jobs.
 *
 *   npx tsx --test src/jobRules.test.ts
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateJob, classifyJob, custoDoParceiro, pisoParaMargem } from "./jobRules.js";

const FLOOR = 100;      // NON_CERT_MIN_VALUE em vigor (11/ago)
const CERT_FLOOR = 70;  // CERT_MIN_VALUE

/** [title/brief, earnings, expected take?, note] */
const CASES: [string, number | undefined, boolean, string][] = [
  // ── Certificados: piso = preço do parceiro + margem (14 ago 2026) ─────
  ["2-Bed EICR Electrical Safety Check", 127, true, "EICR"],
  ["Gas Safety Check (CP12) x2 Appliances", 73, true, "gás £73 contra parceiro £60: 18%, acima dos 10%"],
  ["Fire Risk Assessment - 4 Bed House", 136, true, "FRA"],
  ["Fire Alarm Certificate", 91, true, "FAC comercial"],
  ["Fire Alarm Certificate", 68.5, false, "FAC sem preço acordado: piso genérico £70"],
  ["PAT Portable Appliance Testing", 45, false, "cert agora tem piso"],
  ["Emergency Lighting Certificate", 40, false, "cert abaixo do piso"],
  ["(EPC) Energy Performance Certificate", 63.55, false, "EPC £63.55 contra parceiro £79: prejuízo"],
  ["EPC - 5 Bed House", 97.3, true, "EPC de 5 quartos: £97,30 contra £79 mínimos"],
  ["Energy Performance Certificate", 200, true, "EPC a £200 paga o parceiro e sobra £121"],

  // ── Tudo o mais: piso £100 ────────────────────────────────────────────
  ["Emergency Plumbing Repair", 180, true, "hidráulica acima do piso"],
  ["Full Rewire - 2 Bed Flat", 450, false, "elétrica sem certificado: fora, pague o que pagar (17/08)"],
  ["Toilet Leak Repair", 109, true, "acima de 100"],
  ["Leaking Tap Repair", 88.4, false, "abaixo de 100"],
  ["Side Bath Panel Installation", 95.5, false, "abaixo de 100"],
  ["Gas Boiler Service", 80.2, false, "abaixo de 100"],
  ["Kitchen Tap Replacement", 55, false, "abaixo de 100"],

  ["Handyperson: Full Day (7 Hrs) General Repairs", 280, true, "diária acima do piso"],
  ["Handyperson for half day (3.5 hours)", 140, true, "meia diária acima do piso"],
  ["Handyperson: Full Day (7 Hrs) General Repairs", 60, false, "diária abaixo do piso"],

  // ── Avulsas: preço decide agora, não o formato do job ─────────────────
  ["Rehang 2 Misaligned External Doors", 191, true, "avulsa cara agora entra"],
  ["New Extractor Fan Install w/ Ducting", 190, false, "extractor fan é elétrica: fora (17/08)"],
  ["Mortice Lock Fitting (Deadlock)", 200, true, "avulsa cara agora entra"],
  ["Curtain Rod Installation (Up to 3m)", 73, false, "avulsa barata segue fora"],
  ["Office Desk Assembly (Up to 1.5m)", 53.65, false, "avulsa barata, 2% de margem"],
  ["TV Mounting - Large TV (Up To 100\")", 70, false, "abaixo de 100"],

  // ── Fora de escopo ────────────────────────────────────────────────────
  ["Garden Maintenance - Full Day", 280, false, "jardim ganha de tudo, até de diária"],
  ["Lawn mowing and hedge trimming", 150, false, "jardim"],
];

test("real Checkatrade jobs are bucketed the way the business decided", () => {
  const wrong: string[] = [];
  for (const [text, price, expected, note] of CASES) {
    const v = evaluateJob(text, price, FLOOR, 150, CERT_FLOOR);
    if (v.ok !== expected) {
      wrong.push(`"${text}" £${price} → ${v.ok ? "TAKE" : "SKIP"} [${v.bucket}] but expected ${expected ? "TAKE" : "SKIP"} (${note}) — ${v.reason}`);
    }
  }
  assert.deepEqual(wrong, [], `\n${wrong.join("\n")}\n`);
});

test("certificados têm piso próprio, mais baixo que o resto", () => {
  const cert = (t: string, p: number) => evaluateJob(t, p, FLOOR, 150, CERT_FLOOR).ok;
  // £85 passa como certificado e falha como qualquer outra coisa.
  assert.equal(cert("Gas Safety Check (CP12)", 85), true);
  assert.equal(cert("Leaking Tap Repair", 85), false);
  assert.equal(cert("Handyperson: Full Day (7 Hrs)", 85), false);
});

test("EPC é recusado pela conta, não pelo nome", () => {
  // Custa £79 ao parceiro e a Checkatrade paga £56 a £97: a banda inteira dá
  // prejuízo ou quase. Antes a exclusão era por nome; agora é aritmética, e
  // por isso um EPC que pague de verdade passa a entrar.
  for (const p of [56.35, 66.7]) {
    const v = evaluateJob("(EPC) Energy Performance Certificate", p, FLOOR, 150, CERT_FLOOR);
    assert.equal(v.ok, false, `£${p}`);
    // A recusa agora mostra a conta, não o nome: é o que deixa o log
    // auditável quando o preço deles mudar.
    assert.match(v.reason, /partner £79/);
  }
});

test("a missing price never silently drops a certificate", () => {
  // Continua valendo mesmo agora que certificado tem piso: falha de scraping
  // custa no máximo um CP12 barato, e perder um EICR custa o job mais
  // disputado do board.
  assert.equal(evaluateJob("2-Bed EICR Electrical Safety Check", undefined, FLOOR, 150, CERT_FLOOR).ok, true);
  // O resto não dá para conferir sem preço. Recusa, e diz por quê.
  for (const text of ["Handyperson: Full Day (7 Hrs)", "Emergency Plumbing Repair", "Mortice Lock Fitting"]) {
    const v = evaluateJob(text, undefined, FLOOR, 150, CERT_FLOOR);
    assert.equal(v.ok, false, text);
    assert.match(v.reason, /NO PRICE PARSED/);
  }
});

test("garden is excluded before any other rule can pass it", () => {
  assert.equal(classifyJob("Garden fence repair - EICR certificate"), "excluded");
});

test("EICR is priority at any price; other work only above the high-value mark", () => {
  const HIGH = 150;
  // EICR is chased regardless of what it pays — it's the most contested thing
  // on the board (28 of them on 2026-08-04, every single one already Taken).
  assert.equal(evaluateJob("EICR Safety Check - Studio/1-Bed Flat", 100, FLOOR, HIGH).priority, true);
  assert.equal(evaluateJob("2 Bed Property EICR Safety Check", 127, FLOOR, HIGH).priority, true);
  assert.equal(evaluateJob("Electrical Installation Condition Report", 59, FLOOR, HIGH).priority, true);

  // A non-EICR only earns priority by paying well.
  assert.equal(evaluateJob("Gas Safety Check (CP12) x2 Appliances", 73, FLOOR, HIGH).priority, false);
  assert.equal(evaluateJob("Handyperson: Full Day (7 Hrs)", 280, FLOOR, HIGH).priority, true);
  assert.equal(evaluateJob("Thermostatic Shower Installation", 172, FLOOR, HIGH).priority, true);
  assert.equal(evaluateJob("Toilet Leak Repair", 109, FLOOR, HIGH).priority, false);
});

test("priority never overrides a rejection", () => {
  // A £280 garden day booking is still garden; priority is about how hard we
  // chase something we already want, not a licence to take what we refused.
  const garden = evaluateJob("Garden Maintenance - Full Day", 280, FLOOR, 150);
  assert.equal(garden.ok, false);
  assert.equal(garden.priority, false);
  // Jardim é o que continua fora por natureza, pague o que pagar.
  assert.equal(evaluateJob("Garden Fence Replacement", 400, FLOOR, 150, CERT_FLOOR).ok, false);
});

/* ── Piso derivado do preço do parceiro (14 ago 2026) ─────────────────────── */

test("a faixa do EICR sai do tamanho anunciado no título", () => {
  assert.deepEqual(custoDoParceiro("EICR Safety Check Studio Flat"), { tipo: "acordado", valor: 69 });
  // "Studio/1-Bed" cobre as duas faixas: assume a cara, porque errar para baixo
  // aceita prejuízo e errar para cima só recusa um job.
  assert.deepEqual(custoDoParceiro("EICR Safety Check Studio/1-Bed Flat"), { tipo: "acordado", valor: 79 });
  assert.deepEqual(custoDoParceiro("2 Bed Domestic EICR Safety Check"), { tipo: "acordado", valor: 79 });
  assert.deepEqual(custoDoParceiro("3 Bed Property EICR Safety Check"), { tipo: "acordado", valor: 99 });
  assert.deepEqual(custoDoParceiro("4-Bed EICR Electrical Safety Check"), { tipo: "acordado", valor: 99 });
  // Sem tamanho no título, a faixa do meio.
  assert.deepEqual(custoDoParceiro("EICR"), { tipo: "acordado", valor: 79 });
});

test("gás cobra mais a partir de 3 aparelhos", () => {
  assert.deepEqual(custoDoParceiro("Gas Safety Check (CP12)"), { tipo: "acordado", valor: 60, aoMenos: false });
  assert.deepEqual(custoDoParceiro("Gas Safety Check (CP12) x2 Appliances"), { tipo: "acordado", valor: 60, aoMenos: false });
  assert.deepEqual(custoDoParceiro("Gas Safety Check (CP12) x3 Appliances"), { tipo: "acordado", valor: 70, aoMenos: false });
});

test("EPC entra na conta em vez de ser excluído por decreto", () => {
  assert.deepEqual(custoDoParceiro("(EPC) Energy Performance Certificate"), { tipo: "acordado", valor: 79 });
  // O que a Checkatrade vinha pagando: prejuízo em todos.
  for (const preco of [56.35, 63.55, 66.7]) {
    const v = evaluateJob("(EPC) Energy Performance Certificate", preco, 100);
    assert.equal(v.ok, false, `EPC a £${preco} não pode entrar`);
  }
  // Se um dia pagarem o que cobre o parceiro mais margem, entra sozinho.
  // £79 de parceiro a 10% pede £87,78.
  assert.equal(evaluateJob("(EPC) Energy Performance Certificate", 80, 100).ok, true);
  assert.equal(evaluateJob("(EPC) Energy Performance Certificate", 79, 100).ok, false);
});

test("gás entra sempre que passa do custo do parceiro", () => {
  // Preços reais da tabela deles: 64 / 73 / 82 por 1, 2 e 3 aparelhos,
  // contra 60 / 60 / 70 de parceiro.
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 1 appliance", 64, 100).ok, true);
  assert.equal(evaluateJob("Gas Safety Check (CP12) x2 Appliances", 73, 100).ok, true);
  assert.equal(evaluateJob("Gas Safety Check (CP12) x3 Appliances", 82, 100).ok, true);
  // Abaixo do custo, nunca.
  assert.equal(evaluateJob("Gas Safety Check (CP12) x3 Appliances", 68, 100).ok, false);
});

test("os EICR que deram lucro continuam entrando", () => {
  // Preços reais do board, com a margem que sobrou de cada um.
  const casos: Array<[string, number]> = [
    ["EICR Safety Check Studio/1-Bed Flat", 100],
    ["2 Bed Domestic EICR Safety Check (<=8 circuits)", 127],
    ["EICR Safety Check - 2 Bed Property", 127],
    ["Electrical Installation Condition Report", 145],
    ["(EICR) Electrical Installation Condition Report", 255],
  ];
  for (const [titulo, preco] of casos) {
    const v = evaluateJob(titulo, preco, 100);
    assert.equal(v.ok, true, `${titulo} a £${preco} devia entrar — ${v.reason}`);
  }
});

test("jardim continua fora, por mais que pague", () => {
  assert.equal(evaluateJob("Garden Fence Repair", 500, 100).ok, false);
});

test("certificado entra sempre que passa do custo do parceiro", () => {
  // Decisão do dono: parceiro ocioso, slot vazio não rende. £6 é melhor que £0.
  assert.equal(evaluateJob("2-Bed EICR Electrical Safety Check", 85, 70).ok, true);
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 1 appliance", 64, 70).ok, true);
  assert.equal(evaluateJob("EPC (4 Bed House)", 81.55, 70).ok, true);
  // Empatar ou perder, nunca.
  assert.equal(evaluateJob("2-Bed EICR Electrical Safety Check", 79, 70).ok, false);
  assert.equal(evaluateJob("EPC (3 Bed House)", 74.35, 70).ok, false);
});

test("a margem se mede sobre a venda, não sobre o custo", () => {
  // £79 de parceiro a 10%: £87,78, e não £86,90. A diferença parece pequena
  // mas é ela que decide um job na fronteira.
  assert.equal(pisoParaMargem(79, 0.1), 87.78);
  assert.equal(pisoParaMargem(60, 0.1), 66.67);
  assert.equal(pisoParaMargem(99, 0.1), 110);
});

test("EICR de £95,50 entra: 17% em cima de £79", () => {
  // Com lucro mínimo fixo em £20 este saía. A 10% ele passa, que é a regra
  // combinada: por menor que seja, se tem margem entra.
  const v = evaluateJob("EICR", 95.5, 100);
  assert.equal(v.ok, true, v.reason);
  assert.match(v.reason, /17%/);
});

test("imóvel maior que a faixa cotada usa o topo conhecido como mínimo", () => {
  // Um EICR de 6 quartos custa pelo menos o que custa um de 4 (£99). Se não
  // fecha nem com esse mínimo, não fecharia com o preço real.
  assert.equal(evaluateJob("6 Bed Property EICR Safety Check", 400, 70).ok, true);
  assert.equal(evaluateJob("6 Bed Property EICR Safety Check", 98, 70).ok, false);
  // EPC grande: a tabela deles paga £97,30 no 5 quartos, contra £79 mínimos.
  assert.equal(evaluateJob("EPC (5 Bed House)", 97.3, 70).ok, true);
  assert.equal(evaluateJob("EPC (4 Bed House)", 81.55, 70).ok, true);
  // Gás de 4 aparelhos: £91 contra £70 mínimos.
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 4 appliances", 91, 70).ok, true);
});

test("diária e meia diária seguem o piso único: são job fechado", () => {
  // Do Checkatrade nada chega por hora. Mesmo anunciado como "full day", é
  // preço fechado e quem decide quantas pessoas e quantas horas somos nós, o
  // que torna a diária do parceiro um custo possível e não o custo do job.
  //
  // O dado sustenta: as meias diárias reais pagaram £149,50, £168,50, £326 —
  // nenhuma perto do piso.
  assert.equal(evaluateJob("Handyperson - Half Day General Repairs", 149.5, 70).ok, true);
  assert.equal(evaluateJob("Handyperson Half Day (3.5 Hrs)", 326, 70).ok, true);
  assert.equal(evaluateJob("Handyperson: Full Day (7 Hrs) General Repairs", 150, 70).ok, true);
  // Abaixo do piso continua saindo.
  assert.equal(evaluateJob("Handyperson: Full Day (7 Hrs) General Repairs", 65, 70).ok, false);
});

test("gás: a tabela do Checkatrade contra a do parceiro", () => {
  // Checkatrade paga 64 / 73 / 82 por 1, 2 e 3 aparelhos; o parceiro cobra
  // 60 / 60 / 70. Só o de 1 aparelho não fecha 10%.
  // £4 de lucro entra: o parceiro está ocioso e o gás não paga a margem cheia.
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 1 appliance", 64, 100).ok, true);
  // O que não passa é empatar ou perder.
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 1 appliance", 60, 100).ok, false);
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 1 appliance", 55, 100).ok, false);
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 2 appliances", 73, 100).ok, true);
  assert.equal(evaluateJob("Gas Safety Check (CP12) - 3 appliances", 82, 100).ok, true);
});

test("EPC: a tabela inteira do Checkatrade fica abaixo do parceiro", () => {
  // Preços reais deles, 1 a 3 quartos, contra £79 de parceiro.
  // Toda a faixa de 1 a 3 quartos fica abaixo dos £79 do parceiro.
  for (const p of [56.35, 59.05, 63.55, 66.7, 71.2, 74.35]) {
    const v = evaluateJob("(EPC) Energy Performance Certificate", p, 100);
    assert.equal(v.ok, false, `EPC a £${p} devia sair — ${v.reason}`);
  }
});

test("elétrica sem certificado fica fora; certificado elétrico continua entrando", () => {
  // Ordem do dono (17/08/2026): "elétrica é o único que não vamos arriscar for
  // now — não pegamos nada, só certificados". Preço não compra a entrada.
  for (const [titulo, preco] of [
    ["Socket Replacement", 120],
    ["Light Fitting Installation", 150],
    ["Electrician Required - Various Jobs", 300],
    ["Consumer Unit Replacement", 485],
    ["Electric Shower Installation", 400],
  ] as const) {
    const v = evaluateJob(titulo, preco, 100);
    assert.equal(v.ok, false, `${titulo} a £${preco} devia sair — ${v.reason}`);
    assert.match(v.reason, /electrical work without certificate/);
  }
  // O certificado tem precedência: EICR e Emergency Lighting contêm "electrical"
  // e "lighting" e continuam entrando pela conta de sempre.
  assert.equal(evaluateJob("2-Bed EICR Electrical Safety Check", 127, 100).ok, true);
  assert.equal(evaluateJob("Emergency Lighting Certificate", 91, 100).ok, true);
});

test("o gate de elétrica lê o título, nunca o brief", () => {
  // Um TV mount perfeitamente bom diz "hide cables in the socket behind the
  // TV" no brief. Com o título separado, o job entra; sem ele, o texto todo
  // decide e o mesmo job sairia — que é o comportamento antigo dos testes.
  const texto = 'TV Mounting - Large TV (Up To 100") \n Please hide the cables in the socket behind the TV';
  const comTitulo = evaluateJob(texto, 120, 100, 150, undefined, undefined, 'TV Mounting - Large TV (Up To 100")');
  assert.equal(comTitulo.ok, true, comTitulo.reason);
  const semTitulo = evaluateJob(texto, 120, 100);
  assert.equal(semTitulo.ok, false);
});

test("General Maintenance pequeno volta a entrar com o piso de £70", () => {
  // Os quatro jobs reais que o piso de £100 recusava. Os de £77,50 deram 61%
  // e 40% de margem; os de £55 ficam de fora por pouco, e é onde o risco de
  // passar de uma hora mora.
  assert.equal(evaluateJob("General Maintenance", 77.5, 70).ok, true);
  assert.equal(evaluateJob("General Maintenance", 55, 70).ok, false);
});


