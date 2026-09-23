import { strict as assert } from "node:assert";
import { test } from "node:test";
import { NURTURE } from "./lifecycle-templates";
import { AGENDA, indiceDaData, pecaDaData, dataDaPeca } from "./agenda";
import { linkDaPeca, renderPeca, ofertaDaPeca, type Peca } from "./render";
import { getSequence, FUNIL } from "./definitions";
import { CUPONS, acharCupom, comoSeLe, INICIO_DA_TEMPORADA } from "@/lib/marketing/cupons";

const CTX = { name: "Marta", unsubscribeUrl: "https://app.getfixfy.com/api/email/unsubscribe?e=abc" };

const textoDaPeca = (p: Peca) =>
  [p.assunto, p.preheader, p.titulo, p.cta, ...p.blocos.map((b) =>
    b.tipo === "texto" ? b.html
      : b.tipo === "lista" ? b.titulo + b.itens.join(" ")
      : b.tipo === "citacao" ? b.texto + b.autor
      : b.itens.map((i) => i.valor + i.rotulo).join(" "),
  )].join(" ");

test("quem não comprou recebe nos dias 0, 1, 2 e 4, e não depois do 30", () => {
  // A cadência é o ponto do aperto: lead de serviço de casa decide na primeira
  // semana, e quem some no dia 3 já contratou outro.
  const seq = getSequence(FUNIL.naoComprou)!;
  assert.deepEqual(seq.steps.map((s) => s.offsetHours / 24), [0, 1, 2, 4, 6, 8, 11, 14, 21, 30]);
  assert.equal(seq.steps.length, NURTURE.length);
  assert.equal(seq.recurring, undefined, "o aperto acaba; quem segue é a agenda");
});

test("quem já comprou só ouve marketing a partir da segunda semana, e aí duas por semana", () => {
  // Na primeira semana quem fala com o cliente é o transacional: confirmação,
  // relatório, cobrança. Promoção no meio disso confunde as duas coisas.
  const seq = getSequence(FUNIL.jaComprou)!;
  assert.equal(seq.steps[0].offsetHours, 14 * 24);
  assert.equal(seq.recurring, true);
  assert.equal(seq.recurEveryHours, 84, "84h dá duas por semana");
});

test("quem não comprou e é velho recebe a mesma agenda, na metade do ritmo", () => {
  const seq = getSequence(FUNIL.naoComprouFogoBaixo)!;
  assert.equal(seq.recurEveryHours, 7 * 24, "uma por semana");
  assert.equal(seq.steps[0].key, getSequence(FUNIL.jaComprou)!.steps[0].key, "a mesma edição");
});

test("a temporada tem 52 edições, seis meses a duas por semana", () => {
  assert.equal(AGENDA.length, 52);
  const chaves = AGENDA.map((p) => p.key);
  assert.equal(new Set(chaves).size, 52, "chave repetida soma duas peças na mesma linha do painel");
  assert.deepEqual(AGENDA.map((p) => p.n), Array.from({ length: 52 }, (_, i) => i + 1));

  // Seis meses: a última edição cai perto do fim de março.
  const fim = dataDaPeca(52);
  assert.ok(fim > new Date("2027-03-01") && fim < new Date("2027-04-15"), fim.toISOString());
});

test("a peça sai da data, não do contador da pessoa", () => {
  // É isto que faz o e-mail de inverno chegar no inverno para quem entrou em
  // outubro E para quem entrou em fevereiro.
  const inicio = new Date(`${INICIO_DA_TEMPORADA}T00:00:00Z`);
  assert.equal(indiceDaData(inicio), 0);
  assert.equal(indiceDaData(new Date(inicio.getTime() + 3.4 * 864e5)), 0, "antes de 3,5 dias, mesma edição");
  assert.equal(indiceDaData(new Date(inicio.getTime() + 3.6 * 864e5)), 1);
  assert.equal(indiceDaData(new Date(inicio.getTime() + 7 * 864e5)), 2, "duas por semana");

  // Antes da temporada começar, a primeira. Depois do fim, recomeça.
  assert.equal(indiceDaData(new Date("2020-01-01")), 0);
  assert.equal(indiceDaData(new Date(inicio.getTime() + 52 * 3.5 * 864e5)), 0);
  assert.ok(pecaDaData().n >= 1);
});

test("todo cupom prometido na agenda existe na lista da Stripe", () => {
  // O erro que isto evita: o cliente lê "15% off" no e-mail e leva "promo
  // codes are not available right now" na cara do pagamento.
  for (const peca of [...AGENDA, ...NURTURE]) {
    if (!peca.cupom) continue;
    assert.ok(acharCupom(peca.cupom), `cupom ${peca.cupom} da peça ${peca.key} não está em cupons.ts`);
  }
});

test("desconto grande é exceção, não regra", () => {
  // Em limpeza o parceiro leva 70%: 15% de desconto já é metade da margem.
  const acimaDe15 = CUPONS.filter((c) => (c.percentual ?? 0) > 15);
  assert.equal(acimaDe15.length, 0, `percentual acima de 15%: ${acimaDe15.map((c) => c.codigo).join(", ")}`);
  const quinze = CUPONS.filter((c) => c.percentual === 15);
  assert.ok(quinze.length <= 6, `meia margem em ${quinze.length} cupons, revisar`);
  // Valor fixo só onde o ticket é grande ou é indicação assumida.
  for (const c of CUPONS.filter((x) => x.pence)) {
    assert.ok(["PAINT50", "REFER20"].includes(c.codigo), `valor fixo inesperado em ${c.codigo}`);
  }
});

test("o nome do cupom está em inglês", () => {
  // O `name` do cupom aparece na caixa da oferta dentro do e-mail e no recibo
  // da Stripe. Quem lê é cliente em Londres. Errei isto na primeira prévia: a
  // caixa dizia "deep clean de outono".
  for (const c of CUPONS) {
    assert.ok(!/[áàâãéêíóôõúüç]/i.test(c.nome), `nome em português em ${c.codigo}: ${c.nome}`);
  }
});

test("a lista não é só promoção", () => {
  // Lista que só recebe oferta vira lista morta, e o custo não é o clique
  // perdido: é a marcação de spam, que cai sobre o domínio inteiro.
  // O dono pediu temporada com desconto, então a metade com oferta é de
  // propósito. O teto existe para a próxima temporada não virar só cupom.
  const comOferta = AGENDA.filter((p) => p.cupom).length;
  assert.ok(comOferta / AGENDA.length <= 0.55, `${comOferta} de ${AGENDA.length} peças com cupom`);
  assert.ok(comOferta >= 12, "poucas ofertas para seis meses");
});

test("todo link sai etiquetado, e com o cupom na URL quando há oferta", () => {
  const semOferta = linkDaPeca({}, "client_season", AGENDA.find((p) => !p.cupom)!);
  assert.match(semOferta, /utm_source=email&utm_medium=lifecycle&utm_campaign=client_season/);
  assert.ok(!semOferta.includes("promo="));

  const comOferta = linkDaPeca({}, "client_season", AGENDA.find((p) => p.cupom)!);
  assert.match(comOferta, /promo=[A-Z0-9]+/);

  // Link que já tem query recebe &, senão o site perde o parâmetro.
  assert.match(linkDaPeca({ bookingUrl: "https://x.com/book?svc=eot" }, "c", AGENDA[0]), /\?svc=eot&utm_source/);
});

test("o e-mail sai com logo oficial, saída em um clique e a caixa do cupom", () => {
  const comCupom = AGENDA.find((p) => p.cupom)!;
  const html = renderPeca(comCupom, "client_season", CTX);
  assert.match(html, /logos\/fixfy-email-header\.png/, "logo oficial");
  assert.match(html, /Unsubscribe/, "saída em um clique");
  assert.ok(html.includes(comCupom.cupom!), "o código tem que aparecer na caixa");
  assert.ok(html.includes(comoSeLe(acharCupom(comCupom.cupom!)!)), "o valor do desconto");
  assert.match(html, /Hi Marta,/, "personalização pelo primeiro nome");

  // Sem nome vira "there". "Hi ," é pior do que não personalizar.
  assert.match(renderPeca(AGENDA[0], "client_season", {}), /Hi there,/);
});

test("peça sem cupom não inventa caixa de oferta", () => {
  const sem = AGENDA.find((p) => !p.cupom)!;
  assert.equal(ofertaDaPeca(sem), undefined);
  assert.ok(!renderPeca(sem, "client_season", CTX).includes("Enter it at checkout"));
});

test("a copy não usa travessão", () => {
  // Decisão de marca do dono. Vale para tudo que o cliente lê.
  for (const peca of [...AGENDA, ...NURTURE]) {
    assert.ok(!textoDaPeca(peca).includes("—"), `travessão em ${peca.key}`);
  }
});

test("nenhuma peça sai sem assunto, corpo e botão", () => {
  for (const peca of [...AGENDA, ...NURTURE]) {
    assert.ok(peca.assunto.length > 12, `assunto curto em ${peca.key}`);
    assert.ok(peca.assunto.length <= 78, `assunto longo demais em ${peca.key} (corta no celular)`);
    assert.ok(peca.preheader.length > 12, `preheader curto em ${peca.key}`);
    assert.ok(peca.blocos.length >= 2, `corpo raso em ${peca.key}`);
    assert.ok(peca.cta.length > 4, `botão sem texto em ${peca.key}`);
  }
});
