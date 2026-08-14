import assert from "node:assert/strict";
import { test } from "node:test";

import { coverageFor, postcodeArea } from "./coverage";
import { extractPostcode, firstName, isCheckatradeLead, parseLeadBrief, type LeadBrief } from "./lead-brief";
import { customerLabel, isQuoteOnly, matchService, tradeSlug, tradeSlugParaRespondIo } from "./service-match";
import { decideDispatch } from "./dispatch-gate";
import { parseBookingDay, parseArrivalWindow, JANELAS } from "./booking-day";
import { conversationState } from "./conversation-state";
import type { CatalogService } from "@/types/database";

function svc(name: string, over: Partial<CatalogService> = {}): CatalogService {
  return {
    id: `id-${name}`,
    name,
    pricing_mode: "fixed",
    fixed_price: 100,
    hourly_rate: 0,
    default_hours: 1,
    partner_cost: 60,
    sort_order: 0,
    is_active: true,
    created_at: "2026-01-01T00:00:00Z",
    updated_at: "2026-01-01T00:00:00Z",
    ...over,
  } as CatalogService;
}

/** Espelha o catálogo real depois da curadoria de 2026-08-11. */
const CATALOG: CatalogService[] = [
  svc("General Maintenance", { pricing_mode: "hourly", fixed_price: 0, hourly_rate: 72, partner_cost: 40 }),
  svc("Carpenter", { pricing_mode: "hourly", fixed_price: 0, hourly_rate: 0, partner_cost: 0 }),
  svc("Painter", { pricing_mode: "hourly", fixed_price: 0, hourly_rate: 0, partner_cost: 0 }),
  svc("Builder", { fixed_price: 0, partner_cost: 0 }),
  svc("(EICR) Electrical Installation Condition Report", { fixed_price: 100, partner_cost: 69 }),
  svc("(FRA) Fire Risk Assessment", { fixed_price: 99, partner_cost: 70 }),
  svc("(PAT) Portable Appliance Testing", { fixed_price: 69, partner_cost: 50 }),
  svc("(EOT) End of Tenancy", { fixed_price: 234, partner_cost: 130 }),
  svc("(DC) Deep Cleaning", { fixed_price: 129.6, partner_cost: 87 }),
  svc("(AB) After Builders Cleaning", { fixed_price: 234, partner_cost: 130 }),
];

function brief(over: Partial<LeadBrief> = {}): LeadBrief {
  return {
    externalId: "lead-1",
    clientId: "client-1",
    name: "Sam Taylor",
    phone: "+44 7712 345678",
    email: null,
    postcode: "SE22 8PS",
    location: "London SE22 8PS, UK",
    enquiry: "Need a TV mounted and a curtain rail put up",
    rawCategory: "Handyman",
    ...over,
  };
}

// ------------------------------------------------------------------ cobertura

test("postcodeArea lê a área nos formatos reais do Checkatrade", () => {
  assert.equal(postcodeArea("SW16 2HJ"), "SW");
  assert.equal(postcodeArea("London W3 6XR, UK"), "W");
  assert.equal(postcodeArea("e14 9lu"), "E");
  assert.equal(postcodeArea("EC1A 1BB"), "EC");
  assert.equal(postcodeArea(null), null);
  assert.equal(postcodeArea("sem postcode aqui"), null);
});

test("cobertura separa centro, cinturão e fora", () => {
  assert.equal(coverageFor("SW16 2HJ"), "core");
  assert.equal(coverageFor("N7 9QL"), "core");
  // Todas estas aparecem em job real de 2026.
  for (const p of ["HA5 1AB", "KT7 0XP", "RM16 6YA", "UB8 1SS", "EN1 1NY"]) {
    assert.equal(coverageFor(p), "fringe", p);
  }
  assert.equal(coverageFor("M1 1AE"), "outside");
  assert.equal(coverageFor("EH1 1YZ"), "outside");
});

// -------------------------------------------------------------- catálogo

test("zerado significa quote-only, com preço significa cotável", () => {
  assert.equal(isQuoteOnly(svc("X", { fixed_price: 0, hourly_rate: 0 })), true);
  assert.equal(isQuoteOnly(svc("X", { fixed_price: 100 })), false);
  assert.equal(isQuoteOnly(svc("X", { fixed_price: 0, hourly_rate: 72 })), false);
});

test("certificados e limpeza casam e são cotáveis", () => {
  for (const [text, name] of [
    ["Need an EICR for a 2 bed flat", "(EICR) Electrical Installation Condition Report"],
    ["Fire risk assessment for a HMO", "(FRA) Fire Risk Assessment"],
    ["PAT testing for 15 items", "(PAT) Portable Appliance Testing"],
    ["End of tenancy clean, 2 bed", "(EOT) End of Tenancy"],
    ["Deep clean of the flat", "(DC) Deep Cleaning"],
    ["After builders clean needed", "(AB) After Builders Cleaning"],
  ] as const) {
    const m = matchService(text, CATALOG);
    assert.equal(m.kind, "quote_and_close", text);
    assert.equal(m.kind === "quote_and_close" && m.service.name, name);
  }
});

test("painter, carpenter e builder são quote-only por estarem zerados", () => {
  for (const text of [
    "Need the hallway repainting",
    "Bespoke shelving in an alcove",
    "Looking to build a stud wall",
  ]) {
    assert.equal(matchService(text, CATALOG).kind, "quote_only", text);
  }
});

test("handyman cota porque tem preço", () => {
  const m = matchService("Can someone mount a TV and fix a curtain rail?", CATALOG);
  assert.equal(m.kind, "quote_and_close");
  assert.equal(m.kind === "quote_and_close" && m.service.name, "General Maintenance");
});

test("a trade maior ganha o empate", () => {
  const wall = matchService("build a stud wall and then paint it", CATALOG);
  assert.equal(wall.kind === "quote_only" && wall.service.name, "Builder");
  const skirt = matchService("fit new skirting and paint it", CATALOG);
  assert.equal(skirt.kind === "quote_only" && skirt.service.name, "Carpenter");
});

test("jardim é recusado em qualquer redação", () => {
  for (const t of ["Lawn cut and hedge trimmed", "Fence panel replacement", "Lay new decking", "Landscaping the garden"]) {
    const m = matchService(t, CATALOG);
    assert.equal(m.kind, "refuse", t);
    assert.match(m.kind === "refuse" ? m.reason : "", /jardim/);
  }
});

test("'patio doors' é serralheria, não paisagismo", () => {
  // Um job de persiana foi descartado por isso em 2026-08-03.
  const m = matchService("Fit a roller blind over the patio doors", CATALOG);
  assert.equal(m.kind, "quote_and_close");
});

test("hidráulica e gás viram outro time, não recusa", () => {
  for (const t of ["Leaking tap under the sink", "Gas boiler service", "Radiator not heating"]) {
    assert.equal(matchService(t, CATALOG).kind, "other_team", t);
  }
});

test("serviço fora do catálogo ativo vira handoff, não recusa", () => {
  // Renomear uma linha não pode custar um lead bom.
  const semEicr = CATALOG.filter((s) => !s.name.includes("EICR"));
  assert.equal(matchService("Need an EICR", semEicr).kind, "other_team");
});

test("customerLabel fala a língua do cliente", () => {
  assert.equal(customerLabel(svc("General Maintenance")), "handyman work");
  assert.equal(customerLabel(svc("Carpenter")), "carpentry");
  assert.equal(customerLabel(svc("(EICR) Electrical Installation Condition Report")), "electrical installation condition report");
});

// ------------------------------------------------------------- lead brief

test("parseLeadBrief lê a nota que o RPA escreve", () => {
  const b = parseLeadBrief({
    id: "c1", name: "Gledis Hoxha", phone: "+44 7712 345678", email: null,
    postcode: null, address: "London SW7 5JT, UK",
    notes: "checkatrade-lead:6f21b0c4\n\nCheckatrade lead (New) — Handyman\n\nHi, I need the hallway painting.",
  });
  assert.equal(b.externalId, "6f21b0c4");
  assert.equal(b.rawCategory, "Handyman");
  assert.equal(b.enquiry, "Hi, I need the hallway painting.");
  // Postcode só existe na linha de endereço, que é o formato comum.
  assert.equal(b.postcode, "SW7 5JT");
});

test("uma segunda nota não vaza para o pedido da primeira", () => {
  const notes = [
    "checkatrade-lead:lead-one\n\nCheckatrade lead (New) — Handyman\n\nShelves in the front room.",
    "checkatrade-lead:lead-two\n\nCheckatrade lead (New) — Painter\n\nDifferent job entirely.",
  ].join("\n\n");
  const b = parseLeadBrief({ id: "c", name: "A", phone: null, email: null, postcode: "N1 1AA", address: null, notes });
  assert.equal(b.externalId, "lead-one");
  assert.equal(b.enquiry, "Shelves in the front room.");
  assert.ok(!b.enquiry?.includes("Different job"));
});

test("lead sem mensagem liberada tem enquiry null, não vazio", () => {
  const b = parseLeadBrief({
    id: "c2", name: "Sam", phone: null, email: null, postcode: "E8 3PN", address: null,
    notes: "checkatrade-lead:abc\n\nCheckatrade lead (New) — ",
  });
  assert.equal(b.enquiry, null);
  assert.equal(b.rawCategory, null);
});

test("firstName evita cumprimentar uma empresa pelo nome", () => {
  assert.equal(firstName("Sarah Moneypenny-Dixon"), "Sarah");
  assert.equal(firstName("Tom"), "Tom");
  assert.equal(firstName("Aerofieldhomesltd"), null);
  assert.equal(firstName(null), null);
});

test("extractPostcode normaliza o espaço ausente", () => {
  assert.equal(extractPostcode("sw162hj"), "SW16 2HJ");
  assert.equal(extractPostcode("Flat 3, 21 Torrington Place, E1W 2UY"), "E1W 2UY");
  assert.equal(extractPostcode("sem postcode"), null);
});

test("isCheckatradeLead só casa o marcador", () => {
  assert.equal(isCheckatradeLead("checkatrade-lead:x1"), true);
  assert.equal(isCheckatradeLead("uma nota sobre checkatrade"), false);
  assert.equal(isCheckatradeLead(null), false);
});

// ----------------------------------------------------------- gate completo

test("lead bom de handyman é despachado para cotar", () => {
  const d = decideDispatch(brief(), CATALOG);
  assert.equal(d.dispatch, true);
  assert.equal(d.dispatch && d.handling, "quote_and_close");
  assert.equal(d.dispatch && d.label, "handyman work");
  assert.equal(d.dispatch && d.coverage, "core");
});

test("lead de pintura é despachado como quote-only", () => {
  const d = decideDispatch(brief({ enquiry: "Need the hallway repainting" }), CATALOG);
  assert.equal(d.dispatch, true);
  assert.equal(d.dispatch && d.handling, "quote_only");
});

test("certificado é despachado, não mais recusado", () => {
  // Era a maior categoria de descarte antes de abrirmos certificados.
  const d = decideDispatch(brief({ enquiry: "Need an EICR for a 2 bed flat" }), CATALOG);
  assert.equal(d.dispatch, true);
  assert.equal(d.dispatch && d.handling, "quote_and_close");
});

test("os quatro motivos de descarte são distinguíveis", () => {
  const cases: Array<[Partial<LeadBrief>, string]> = [
    [{ phone: null }, "unreachable"],
    [{ postcode: "M1 1AE", location: "Manchester M1 1AE" }, "outside_area"],
    [{ enquiry: "Hedge trimming" }, "not_our_work"],
    [{ enquiry: "Leaking tap in the kitchen" }, "other_team"],
  ];
  for (const [over, kind] of cases) {
    const d = decideDispatch(brief(over), CATALOG);
    assert.equal(d.dispatch, false, JSON.stringify(over));
    assert.equal(d.dispatch === false && d.skipKind, kind, JSON.stringify(over));
  }
});

test("postcode vazio nunca chega ao template", () => {
  // Variável vazia faz a Meta recusar o envio no meio do lote.
  const d = decideDispatch(brief({ postcode: null, location: null }), CATALOG);
  assert.equal(d.dispatch, false);
  if (d.dispatch === false) assert.equal(d.skipKind, "unreachable");
});

test("cinturão passa e vem marcado, para não prometer mesma semana", () => {
  const d = decideDispatch(brief({ postcode: "KT7 0XP", location: "Thames Ditton KT7 0XP" }), CATALOG);
  assert.equal(d.dispatch, true);
  assert.equal(d.dispatch && d.coverage, "fringe");
});

// ------------------------------ o veto não pode ser mais forte que o pedido
//
// Regressão medida em 2026-08-11: a varredura dos 500 leads do Checkatrade
// descartou 76 como "outro time" e 27 como "não é nosso". Relendo o texto, a
// maioria era trabalho de handyman que só *encostava* numa palavra vetada. O
// veto olhava a lista inteira e uma palavra derrubava as outras oito tarefas.

test("lista multi-tarefa não é vetada por um item de banheiro", () => {
  const casos = [
    "Bathroom Re-Sealing & Wall Repair. The existing silicone is mouldy",
    "Hang a door, Fix Silicon shower, Paint some edges, Screw in a switch",
    "assembling a KALLAX unit, fitting a worktop, resealing the shower tray",
    "I need 2 shelves fixed that have become loose. The tap is also dripping",
  ];
  for (const t of casos) {
    const m = matchService(t, CATALOG);
    assert.notEqual(m.kind, "other_team", t);
    assert.notEqual(m.kind, "refuse", t);
  }
});

test("job que é só hidráulica continua indo para outro time", () => {
  for (const t of [
    "Remove pipework from the toilet and replace the bathroom radiator",
    "The valve in the shower only changes from very hot to cold",
    "Leaking tap in the kitchen",
  ]) {
    assert.equal(matchService(t, CATALOG).kind, "other_team", t);
  }
});

test("a categoria do Checkatrade não sobrepõe a descrição do cliente", () => {
  // O marketplace tagueia como Handyman; o cliente descreveu hidráulica pura.
  // Quem manda é o cliente.
  assert.equal(matchService("Leaking tap in the kitchen", CATALOG, "Handyman").kind, "other_team");
  // Mas quando o Checkatrade não libera a mensagem, a categoria é tudo que há.
  assert.equal(matchService(null, CATALOG, "Handyman").kind, "quote_and_close");
});

test("objeto de jardim não veta trabalho nosso, jardinagem veta", () => {
  // O objeto fica lá fora, mas o trabalho é furar parede e carpintaria.
  for (const t of ["Fix two brackets to a garden concrete fence post", "Need a cat flap fitted in a garden door"]) {
    const m = matchService(t, CATALOG);
    assert.ok(m.kind === "quote_and_close" || m.kind === "quote_only", t);
  }
  // Atividade que nenhum handyman reivindica.
  for (const t of ["Lawn cut and hedge trimmed", "Landscaping the garden", "Install garden fence and cutting grass"]) {
    const m = matchService(t, CATALOG);
    assert.equal(m.kind, "refuse", t);
    assert.match(m.kind === "refuse" ? m.reason : "", /jardim/);
  }
});

test("'fitted' e 'install' casam como 'fitting' e 'fit'", () => {
  // `\bfit(ting)?\b` não pegava "fitted", e "install" faltava por inteiro: dois
  // leads bons viraram "não é um serviço que vendemos".
  for (const t of ["Want a wood table top fitted 6ft x 3ft", "Install a handrail going up the stairs"]) {
    assert.notEqual(matchService(t, CATALOG).kind, "refuse", t);
  }
});

test("tradeSlug traduz o catálogo para o enum do respond.io", () => {
  const nome = (n: string) => svc(n);
  assert.equal(tradeSlug(nome("General Maintenance")), "handyman");
  assert.equal(tradeSlug(nome("Carpenter")), "carpenter");
  assert.equal(tradeSlug(nome("(EOT) End of Tenancy")), "cleaning");
  assert.equal(tradeSlug(nome("(EICR) Electrical Installation Condition Report")), "certificate");
  // `cleaning` e `certificate` ainda não existem no painel: escrever esse valor
  // faria a API recusar o contato inteiro, então o dispatcher omite o campo.
  assert.equal(tradeSlugParaRespondIo(nome("General Maintenance")), "handyman");
  assert.equal(tradeSlugParaRespondIo(nome("(EOT) End of Tenancy")), null);
});

// ---------------------------------------------------- data que o Mike gravou

/** Uma terça-feira, para que "Tuesday" tenha resposta verificável. */
const HOJE = new Date(Date.UTC(2026, 7, 11)); // 2026-08-11, terça

test("parseBookingDay entende as redações que um agente em inglês produz", () => {
  const p = (s: string) => parseBookingDay(s, HOJE);
  assert.equal(p("2026-08-15"), "2026-08-15");
  assert.equal(p("today"), "2026-08-11");
  assert.equal(p("tomorrow"), "2026-08-12");
  assert.equal(p("15 Aug"), "2026-08-15");
  assert.equal(p("Aug 15"), "2026-08-15");
  assert.equal(p("15 August 2026"), "2026-08-15");
  assert.equal(p("15/08"), "2026-08-15");
  assert.equal(p("15/08/2026"), "2026-08-15");
  // Dia primeiro: o negócio é em Londres.
  assert.equal(p("08/09"), "2026-09-08");
});

test("nome do dia da semana significa a próxima ocorrência, nunca hoje", () => {
  // HOJE é terça. "Tuesday" é a terça que vem, não hoje: quem diria hoje
  // teria dito "today".
  assert.equal(parseBookingDay("Tuesday", HOJE), "2026-08-18");
  assert.equal(parseBookingDay("Wednesday", HOJE), "2026-08-12");
  assert.equal(parseBookingDay("Monday", HOJE), "2026-08-17");
});

test("data sem ano que já passou vira o ano que vem", () => {
  // Ninguém agenda um job para trás.
  assert.equal(parseBookingDay("5 Jan", HOJE), "2027-01-05");
  assert.equal(parseBookingDay("05/01", HOJE), "2027-01-05");
});

test("na dúvida devolve null em vez de inventar uma data", () => {
  // Job com data errada manda parceiro no dia errado. Null vira pendência.
  for (const s of ["", "asap", "next week", "when you're free", "sometime soon", "31/02", "31 Feb"]) {
    assert.equal(parseBookingDay(s, HOJE), null, s);
  }
});

// ------------------------------------------ estado da conversa → job ou não

test("venda com dia legível vira job", () => {
  const s = conversationState({ booking_day: "15 Aug", quoted_price: "180", booking_window: "08:00 - 12:00" }, HOJE);
  assert.equal(s.kind, "vendido");
  assert.equal(s.kind === "vendido" && s.data, "2026-08-15");
  assert.equal(s.kind === "vendido" && s.preco, 180);
  assert.equal(s.kind === "vendido" && s.janela, "08:00 - 12:00");
});

test("venda com dia ilegível vira pendência, nunca job com data chutada", () => {
  const s = conversationState({ booking_day: "asap please", quoted_price: "180", booking_window: "08:00 - 12:00" }, HOJE);
  assert.equal(s.kind, "data_ilegivel");
});

test("handoff vence venda", () => {
  // O Mike só escreve handoff_reason quando algo saiu do roteiro. Criar o job
  // por cima disso é o erro caro: o motivo costuma ser mudança de escopo.
  const s = conversationState(
    { handoff_reason: "cliente quer mudar o escopo", booking_day: "15 Aug", quoted_price: "180", booking_window: "08:00 - 12:00" },
    HOJE,
  );
  assert.equal(s.kind, "handoff");
});

test("preço sem dia ainda é cotação, não venda", () => {
  assert.equal(conversationState({ quoted_price: "180" }, HOJE).kind, "cotado");
  assert.equal(conversationState({ quoted_at: "2026-08-11" }, HOJE).kind, "cotado");
  // Dia sem preço não é cotação nem conversa: é anomalia que precisa aparecer.
  assert.equal(conversationState({ booking_day: "15 Aug" }, HOJE).kind, "sem_preco");
});

test("contato sem nada é conversa em andamento", () => {
  assert.equal(conversationState({}, HOJE).kind, "conversando");
  assert.equal(conversationState({ quoted_price: "0", booking_day: "" }, HOJE).kind, "conversando");
});

// -------------------------------------------------- janela de chegada

test("parseArrivalWindow aceita a lista fechada e as redações humanas", () => {
  for (const j of JANELAS) assert.equal(parseArrivalWindow(j), j);
  assert.equal(parseArrivalWindow("morning"), "08:00 - 12:00");
  assert.equal(parseArrivalWindow("afternoon"), "12:00 - 16:00");
  assert.equal(parseArrivalWindow("evening"), "16:00 - 20:00");
  assert.equal(parseArrivalWindow("all day"), "08:00 - 17:00");
  assert.equal(parseArrivalWindow("8am - 12pm"), "08:00 - 12:00");
  assert.equal(parseArrivalWindow("9-1"), "09:00 - 13:00");
  // "8 - 5" é 8h às 17h, não 8h às 5h: fim antes do início é sempre PM.
  assert.equal(parseArrivalWindow("8 - 5"), "08:00 - 17:00");
});

test("janela ilegível não vira horário chutado", () => {
  for (const s of ["", "whenever", "asap", "flexible", "he'll call"]) {
    assert.equal(parseArrivalWindow(s), null, s);
  }
});

test("venda sem hora confirmada não vira job", () => {
  // O dono decidiu em 2026-08-11: data E hora, as duas. Job sem janela faz o
  // cliente esperar o dia inteiro e o parceiro achar a casa vazia.
  const s = conversationState({ booking_day: "15 Aug", quoted_price: "180" }, HOJE);
  assert.equal(s.kind, "sem_janela");
  assert.equal(s.kind === "sem_janela" && s.data, "2026-08-15");

  const ilegivel = conversationState(
    { booking_day: "15 Aug", quoted_price: "180", booking_window: "whenever suits" }, HOJE,
  );
  assert.equal(ilegivel.kind, "sem_janela");
});
