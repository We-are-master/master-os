/**
 * A nota só serve se for a mesma coisa que a plataforma cobra.
 *
 * Por isso os casos aqui são os motivos reais de recusa que já custaram envio:
 * relatório sem foto de uma das metades, formulário de trade sem descrição,
 * cômodo vazio no formulário de limpeza, e bloco acima do teto de 20, onde o
 * excedente some sem ninguém ver.
 *
 * A regra que mais importa é a última: nota alta com item bloqueante é pior do
 * que nota nenhuma, porque manda a pessoa apertar Approve confiante.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportHealth, faixaDaNota, validarSubmissaoDeReport } from "./report-health";
import { isFieldVisible, photoSlotsForTemplate } from "./public-report-templates";

const comodos = ["living_room", "hallways", "kitchen", "bathrooms", "bedrooms"];
const cheio = (n: number) => Object.fromEntries(comodos.map((c) => [c, Array(n).fill("u")]));

const limpezaOk = {
  template: "cleaner" as const,
  finalReportSubmitted: true,
  startReport: { photos: { equipment: Array(5).fill("u"), ...cheio(5) } },
  finalReport: { photos: cheio(5) },
  timerStartedAt: "2026-08-13T08:00:00Z",
  timerEndedAt: "2026-08-13T12:00:00Z",
};

test("limpeza completa dá 100 e não bloqueia", () => {
  const s = reportHealth(limpezaOk);
  assert.equal(s.bloqueado, false);
  assert.equal(s.nota, 100);
  assert.equal(s.pendencias.length, 0);
  assert.equal(faixaDaNota(s), "pronto");
});

test("sem foto de depois bloqueia, por mais completo que esteja o resto", () => {
  const s = reportHealth({ ...limpezaOk, finalReport: { photos: {} } });
  assert.equal(s.bloqueado, true);
  assert.equal(faixaDaNota(s), "bloqueado");
  // O item bloqueante encabeça a lista: é o que resolver primeiro.
  assert.equal(s.pendencias[0].chave, "fotos_depois");
  assert.ok(s.nota < 100);
});

test("trade sem descrição bloqueia, e limpeza sem descrição não", () => {
  const base = {
    finalReportSubmitted: true,
    startReport: { photos: ["u"] },
    finalReport: { photos: ["u"] },
    timerStartedAt: "x",
    timerEndedAt: "y",
  };
  const trade = reportHealth({ ...base, template: "general" });
  assert.equal(trade.bloqueado, true, "o formulário de trade tem campo de texto e ele é obrigatório");
  assert.ok(trade.pendencias.some((p) => p.chave === "descricao"));

  const comTexto = reportHealth({ ...base, template: "general", finalReport: { photos: ["u"], description: "Resealed the bath and made good." } });
  assert.equal(comTexto.bloqueado, false);

  // O formulário de limpeza da Housekeep não tem campo de texto nenhum, então
  // cobrar prosa ali seria inventar exigência.
  const limpeza = reportHealth({ ...base, template: "cleaner", startReport: { photos: cheio(5) }, finalReport: { photos: cheio(5) } });
  assert.ok(!limpeza.itens.some((i) => i.chave === "descricao"));
});

test("cômodo pela metade tira nota mas não impede o envio", () => {
  const s = reportHealth({
    ...limpezaOk,
    finalReport: { photos: { ...cheio(5), kitchen: Array(2).fill("u") } },
  });
  assert.equal(s.bloqueado, false, "duas fotos ainda são fotos: a Housekeep aceita");
  assert.ok(s.nota < 100 && s.nota > 80);
  const cozinha = s.pendencias.find((p) => p.chave === "After:kitchen");
  assert.ok(cozinha);
  assert.equal(cozinha.detalhe, "2 of 5");
});

test("bloco acima de 20 aparece, porque o excedente some calado", () => {
  const s = reportHealth({ ...limpezaOk, finalReport: { photos: { ...cheio(5), kitchen: Array(37).fill("u") } } });
  const item = s.pendencias.find((p) => p.chave === "acima_do_teto");
  assert.ok(item, "sem esse aviso, 17 fotos somem sem ninguém ver");
  assert.equal(item.bloqueia, false);
});

test("relatório que não chegou é o primeiro problema", () => {
  const s = reportHealth({ template: "cleaner", finalReportSubmitted: false });
  assert.equal(s.bloqueado, true);
  assert.equal(s.pendencias[0].chave, "final");
  assert.ok(s.nota < 30);
});

test("certificado PASSOU a cobrar foto de chegada, porque a plataforma cobra", () => {
  /**
   * Regra invertida em 20/08/2026, contra o formulário real deles.
   *
   * Certificado cai no formulário de trade da Housekeep, e esse formulário
   * exige no mínimo UMA foto em "Before photos". Enquanto o nosso template não
   * tinha seção de chegada, todo EPC e CP12 passava daqui e travava lá, pedindo
   * uma foto que nunca foi pedida ao parceiro.
   */
  const semAntes = reportHealth({
    template: "certificate",
    finalReportSubmitted: true,
    finalReport: { photos: ["cert.pdf"], inspection_summary: "EICR carried out, no C1 or C2 observed." },
    timerStartedAt: "x",
    timerEndedAt: "y",
  });
  assert.ok(semAntes.itens.some((i) => i.chave === "fotos_antes"));

  const comAntes = reportHealth({
    template: "certificate",
    finalReportSubmitted: true,
    startReport: { photos: ["arrival.jpg"] },
    finalReport: { photos: ["cert.pdf"], inspection_summary: "EICR carried out, no C1 or C2 observed." },
    timerStartedAt: "x",
    timerEndedAt: "y",
  });
  assert.equal(comAntes.bloqueado, false);
});

test("nota alta nunca convive com item bloqueante", () => {
  // A regra que protege quem confia na nota: se bloqueia, a faixa diz bloqueado
  // por mais alta que a nota esteja.
  const s = reportHealth({ ...limpezaOk, finalReport: { photos: {} } });
  assert.equal(faixaDaNota(s), "bloqueado");
});

// ─── o portão da submissão ───────────────────────────────────────────────────

test("submissão sem o que a plataforma exige volta com a lista", () => {
  const v = validarSubmissaoDeReport({
    template: "general",
    finalData: {},          // sem descrição
    startPhotos: [],        // sem antes
    finalPhotos: [],        // sem depois
  });
  assert.equal(v.ok, false);
  assert.ok(v.motivos.some((m) => /description/i.test(m)));
  assert.ok(v.motivos.some((m) => /before/i.test(m)));
  assert.ok(v.motivos.some((m) => /after/i.test(m)));
});

test("submissão completa passa e já traz a nota", () => {
  const v = validarSubmissaoDeReport({
    template: "general",
    finalData: { description: "Replaced the flush valve and resealed the cistern." },
    startPhotos: ["a.jpg"],
    finalPhotos: ["b.jpg"],
    timerStartedAt: "x",
    timerEndedAt: "y",
  });
  assert.equal(v.ok, true);
  assert.equal(v.nota, 100);
  assert.equal(v.faixa, "pronto");
});

test("limpeza acima do teto de 5 por cômodo é recusada na porta", () => {
  const seis = ["1", "2", "3", "4", "5", "6"];
  const cinco = seis.slice(0, 5);
  const quartos = {
    living_room: cinco, hallways: cinco, kitchen: seis,
    bathrooms: cinco, bedrooms: cinco,
  };
  const v = validarSubmissaoDeReport({
    template: "cleaner",
    finalData: {},
    startPhotos: { equipment: cinco, ...quartos },
    finalPhotos: quartos,
  });
  assert.equal(v.ok, false);
  assert.ok(v.motivos.some((m) => /Kitchen: 6 photos — maximum 5/.test(m)));
});

test("piso da limpeza não bloqueia a porta: 3 fotos num cômodo passam", () => {
  // O piso de 5 é padrão nosso e continua só avisando (nota < 100); o teto e
  // o zero é que barram. Campo com sinal ruim manda 3 fotos, não nenhuma.
  const tres = ["1", "2", "3"];
  const quartos = {
    living_room: tres, hallways: tres, kitchen: tres, bathrooms: tres, bedrooms: tres,
  };
  const v = validarSubmissaoDeReport({
    template: "cleaner",
    finalData: {},
    startPhotos: { equipment: tres, ...quartos },
    finalPhotos: quartos,
  });
  assert.equal(v.ok, true);
  assert.ok(v.nota < 100);
});

test("trade acima de 20 na metade é recusado: o excedente seria cortado em silêncio", () => {
  const v = validarSubmissaoDeReport({
    template: "general",
    finalData: { description: "Full repaint of the hallway and ceiling." },
    startPhotos: ["a.jpg"],
    finalPhotos: Array.from({ length: 21 }, (_, i) => `f${i}.jpg`),
  });
  assert.equal(v.ok, false);
  assert.ok(v.motivos.some((m) => /After photos: 21/.test(m)));
});

test("JOB-9450: com a exigência real da plataforma, 20 fotos soltas param de dar 100", () => {
  /**
   * O relatório que tirou 100/100 e voltou recusado. Vinte fotos de cada lado,
   * template chapado, num job cujo formulário pede cômodo a cômodo. Enquanto a
   * nota mediu o nosso piso, ela dizia "pronto para enviar".
   */
  const exigencias = [
    { metade: "antes" as const, chave: "kitchen", rotulo: "Kitchen", min: 5 },
    { metade: "antes" as const, chave: "hallways", rotulo: "Hallways", min: 3 },
    { metade: "depois" as const, chave: "kitchen", rotulo: "Kitchen", min: 5 },
  ];
  const s = reportHealth({
    template: "general",
    startReport: { photos: Array.from({ length: 20 }, (_, i) => `a${i}`) },
    finalReport: { photos: Array.from({ length: 20 }, (_, i) => `d${i}`), description: "All good" },
    finalReportSubmitted: true,
    timerStartedAt: "2026-08-19T16:01:05Z",
    timerEndedAt: "2026-08-19T16:03:29Z",
    exigencias,
  });
  assert.equal(s.bloqueado, true);
  assert.ok(s.nota < 100);
  assert.ok(s.pendencias.some((p) => p.rotulo === "Before: Kitchen" && p.detalhe === "0 of 5"));
});

test("exigência atendida por cômodo libera a nota", () => {
  const exigencias = [
    { metade: "antes" as const, chave: "kitchen", rotulo: "Kitchen", min: 5 },
    { metade: "depois" as const, chave: "kitchen", rotulo: "Kitchen", min: 5 },
  ];
  const cinco = Array.from({ length: 5 }, (_, i) => `f${i}`);
  const s = reportHealth({
    template: "cleaner",
    startReport: { photos: { kitchen: cinco } },
    finalReport: { photos: { kitchen: cinco } },
    finalReportSubmitted: true,
    timerStartedAt: "2026-08-19T09:00:00Z",
    timerEndedAt: "2026-08-19T12:00:00Z",
    exigencias,
  });
  assert.equal(s.bloqueado, false);
  assert.equal(s.nota, 100);
});

test("balde único do formulário de trade conta a lista plana", () => {
  // `all` é o formulário de trade: lá a foto não tem cômodo e nem precisa ter.
  const s = reportHealth({
    template: "general",
    startReport: { photos: ["a"] },
    finalReport: { photos: ["b"], description: "Replaced the tap and tested it" },
    finalReportSubmitted: true,
    timerStartedAt: "2026-08-19T09:00:00Z",
    timerEndedAt: "2026-08-19T10:00:00Z",
    exigencias: [
      { metade: "antes", chave: "all", rotulo: "Before photos", min: 1 },
      { metade: "depois", chave: "all", rotulo: "After photos", min: 1 },
    ],
  });
  assert.equal(s.bloqueado, false);
});

test("cliente recusou foto: a exigência de foto some, o resto fica", () => {
  /**
   * A Housekeep some com os treze campos de foto quando isto é marcado. Do
   * nosso lado a exigência continuava de pé, então o parceiro respondia a
   * verdade e ficava preso numa tela cobrando o que ele acabou de dizer que
   * não tem. Foi o que travou o JOB-9483 em 20/08/2026.
   */
  const semFoto = {
    template: "cleaner" as const,
    finalData: { job_complete: true },
    startData: { photos_refused: true },
    startPhotos: null,
    finalPhotos: null,
    timerStartedAt: "x",
    timerEndedAt: "y",
  };
  const comRecusa = validarSubmissaoDeReport({ ...semFoto, photosRefused: true });
  assert.equal(comRecusa.motivos.some((m) => /photo/i.test(m)), false);

  // Sem a recusa, a mesma submissão continua barrada por falta de foto.
  const semRecusa = validarSubmissaoDeReport({ ...semFoto, photosRefused: false });
  assert.ok(semRecusa.motivos.some((m) => /photo/i.test(m)));
});

test("bloco de foto condicional só aparece quando o gatilho abre", () => {
  const slots = photoSlotsForTemplate("cleaner");
  const dano = slots.start.find((s) => s.key === "pre_existing_damage_photos");
  assert.ok(dano, "o bloco de foto do dano prévio existe na limpeza");
  assert.equal(dano?.max, 10);
  // Sem piso: ele não causou o dano, e exigir quantidade de prova disso seria
  // cobrar dele o trabalho do cliente.
  assert.equal(dano?.min, undefined);
  assert.equal(isFieldVisible(dano!, {}), false);
  assert.equal(isFieldVisible(dano!, { pre_existing_damage: true }), true);
});
