import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { regrasDoProcesso } from "./conta";
import {
  CONTA_EXPRESS, CONTA_FANTASTIC, CONTA_FIXFY, CONTA_HOUSEKEEP,
  acharClienteEntreContas, acharJobExistente, camposDaContaDoJob, deduplicarPorReportLink, escolherClienteEntreContas,
  nomesCompativeis, origemDoJob, padraoDoTelefone, precoFixoDoJob, telefoneNormalizado, type ClienteCandidato,
} from "./plataformas";
import { respostaManualDepoisDe, idsDaEquipe } from "./historico";
import { passoDepoisDoHistorico } from "./housekeep-quotes";
import {
  MARCA_EQUIPE_AGIU, MARCA_FECHADA_SEM_LANCE, MARCA_NO_BIDS, MARCA_PRECO_A_MAO, canalSemLance, fecharQuoteSemLance, passoComPrecoAMao, passoSemLance,
  precoMandadoAMao, saudacaoSemLance, textoSemLanceHtml, textoSemLancePlano, valorEmLibras,
} from "./quote-sem-lance";
import { escolherQuoteDoBooking, planoDoJobDoBooking, type QuoteDoBooking } from "./booking-housekeep";
import { mandarBoasVindasDoExpress, montarBoasVindasDoExpress, motivoParaNaoMandarBoasVindas, type DependenciasDaBoasVindas } from "./express-boas-vindas";
import * as textos from "./textos";

/* ------------------------- banco de mentira ------------------------- */

type Linha = Record<string, unknown>;
function bancoFalso(tabelas: Record<string, Linha[]> = {}) {
  const t: Record<string, Linha[]> = { outbound_messages: [], ...tabelas };
  const padraoParaRegex = (p: string) => new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*").replace(/_/g, ".")}$`, "i");
  function from(tabela: string) {
    t[tabela] ??= [];
    let op: "select" | "insert" | "update" = "select";
    let linha: Linha | null = null;
    let patch: Linha | null = null;
    let unico = false;
    let limite = Infinity;
    const filtros: Array<(r: Linha) => boolean> = [];
    const q = {
      select: () => q,
      insert: (r: Linha) => ((op = "insert"), (linha = r), q),
      update: (p: Linha) => ((op = "update"), (patch = p), q),
      eq: (c: string, v: unknown) => (filtros.push((r) => r[c] === v), q),
      is: (c: string, v: unknown) => (filtros.push((r) => (v === null ? r[c] == null : r[c] === v)), q),
      ilike: (c: string, p: string) => (filtros.push((r) => padraoParaRegex(p).test(String(r[c] ?? ""))), q),
      in: (c: string, vs: unknown[]) => (filtros.push((r) => vs.includes(r[c])), q),
      gte: (c: string, v: string) => (filtros.push((r) => String(r[c] ?? "") >= v), q),
      order: () => q,
      limit: (n: number) => ((limite = n), q),
      maybeSingle: () => ((unico = true), q),
      single: () => ((unico = true), q),
      then(res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) {
        return Promise.resolve(executar()).then(res, rej);
      },
    };
    function executar() {
      const rows = t[tabela]!;
      if (op === "insert") {
        if (tabela === "outbound_messages" && rows.some((r) => r.dedupe_key === linha!.dedupe_key)) return { data: null, error: { code: "23505", message: "duplicate" } };
        rows.push({ ...linha });
        return { data: linha, error: null };
      }
      const achadas = rows.filter((r) => filtros.every((f) => f(r))).slice(0, limite);
      if (op === "update") {
        for (const r of achadas) Object.assign(r, patch);
        return { data: achadas, error: null };
      }
      return { data: unico ? (achadas[0] ?? null) : achadas, error: null };
    }
    return q;
  }
  return { sb: { from } as unknown as SupabaseClient, t };
}

const comV2 = <T>(fn: () => T): T => {
  const antes = process.env.PROCESSOS_V2;
  process.env.PROCESSOS_V2 = "on";
  try {
    return fn();
  } finally {
    if (antes === undefined) delete process.env.PROCESSOS_V2;
    else process.env.PROCESSOS_V2 = antes;
  }
};

/* ------------------------------ Express ------------------------------ */

describe("Express v2: preço e custo não são inventados", () => {
  const base = { clientPrice: 120, clientPriceSent: true, partnerCost: 0, partnerCostSent: false, partnerCostEstimado: 72 };
  it("sem custo do parceiro: fica nulo, sem estimativa de 40%", () => {
    const r = precoFixoDoJob({ ...base, contaId: CONTA_EXPRESS, v2: true });
    assert.equal(r.partnerCost, null);
    assert.equal(r.clientPrice, 120);
    assert.equal(r.estimado, false);
  });
  it("sem preço ao cliente: fica nulo também", () => {
    const r = precoFixoDoJob({ ...base, clientPrice: 0, clientPriceSent: false, contaId: CONTA_EXPRESS, v2: true });
    assert.equal(r.clientPrice, null);
  });
  it("custo enviado vale", () => assert.equal(precoFixoDoJob({ ...base, partnerCost: 80, partnerCostSent: true, contaId: CONTA_EXPRESS, v2: true }).partnerCost, 80));
  it("fora do v2 continua estimando (produção igual)", () => {
    assert.equal(precoFixoDoJob({ ...base, contaId: CONTA_EXPRESS, v2: false }).partnerCost, 72);
    assert.equal(precoFixoDoJob({ ...base, contaId: CONTA_FIXFY, v2: true }).partnerCost, 72);
  });
  it("origem da plataforma só no v2 e só quando não veio", () => {
    assert.equal(origemDoJob(CONTA_EXPRESS, true), "checkatrade_express");
    assert.equal(origemDoJob(CONTA_HOUSEKEEP, true), "housekeep");
    assert.equal(origemDoJob(CONTA_FANTASTIC, true), "fantastic");
    assert.equal(origemDoJob(CONTA_EXPRESS, true, "meta_ad"), "meta_ad");
    assert.equal(origemDoJob(CONTA_EXPRESS, false), null);
    assert.equal(origemDoJob(CONTA_FIXFY, true), null);
  });
});

describe("Express v2: e-mail de boas-vindas", () => {
  const regras = comV2(() => regrasDoProcesso("platform", { v2: true }));
  const job = {
    jobId: "job-1", referencia: "JOB-9800", contaId: CONTA_EXPRESS, ticketId: 51000, clienteId: "cli-1", nome: "jane doe",
    email: "jane@example.com", servico: "Door repair", dataIso: "2026-10-24", inicioIso: "2026-10-24T08:00:00Z", fimIso: "2026-10-24T11:00:00Z",
    endereco: "14 Park Lane, London W1K 1BE",
  };
  const rotulos = { rotuloDoDia: () => "Saturday 24 October 2026", rotuloDaJanela: () => "between 9am and midday" };
  it("só no Express v2 com e-mail e ticket", () => {
    assert.equal(motivoParaNaoMandarBoasVindas(job, regras), null);
    assert.equal(motivoParaNaoMandarBoasVindas(job, regrasDoProcesso("platform", { v2: true })), "account not on v2");
    assert.equal(motivoParaNaoMandarBoasVindas({ ...job, email: null }, regras), "no customer email");
    assert.equal(motivoParaNaoMandarBoasVindas({ ...job, contaId: CONTA_FIXFY }, regras), "not an Express job");
  });
  it("leva serviço, dia, janela e endereço, sem travessão", () => {
    const e = montarBoasVindasDoExpress(job, rotulos);
    for (const t of ["Door repair", "Saturday 24 October 2026", "between 9am and midday", "14 Park Lane", "Jane", "JOB-9800"]) assert.ok(e.html.includes(t), t);
    assert.equal(e.assunto, "Your booking JOB-9800 is confirmed with Fixfy");
    assert.ok(!/[—–]/.test(e.html + e.assunto));
  });
  it("reserva express-welcome-email:<jobId> e sai uma vez só", async () => {
    const { sb, t } = bancoFalso();
    const entregas: string[] = [];
    const deps: DependenciasDaBoasVindas = {
      ...rotulos,
      definirSolicitante: async () => ({ ok: true }),
      entregar: async (a) => (entregas.push(a.para.email), { modo: "comentario_publico" }),
    };
    const a = await mandarBoasVindasDoExpress(sb, job, regras, deps);
    const b = await mandarBoasVindasDoExpress(sb, job, regras, deps);
    assert.equal(a.kind, "enviado");
    assert.equal(b.kind, "pulado");
    assert.deepEqual(entregas, ["jane@example.com"]);
    assert.equal(t.outbound_messages![0]!.dedupe_key, "express-welcome-email:job-1");
    assert.equal(t.outbound_messages![0]!.status, "sent");
  });
});

/* ------------------------ cliente entre contas ------------------------ */

describe("cliente de plataforma que contrata a Fixfy", () => {
  const daHousekeep: ClienteCandidato = { id: "cli-hk", full_name: "Mary Smith", email: null, phone: "07700 900 123", source_account_id: CONTA_HOUSEKEEP, created_at: "2026-05-01" };
  it("o telefone (últimos 10 dígitos) acha o cadastro da Housekeep", () => {
    const c = escolherClienteEntreContas([daHousekeep], { email: null, telefone: "+44 7700 900123", nome: "Mary Smith", contaId: CONTA_FIXFY });
    assert.equal(c?.id, "cli-hk");
  });
  it("o job novo fica na conta Fixfy, não na do cliente", () => {
    assert.equal(camposDaContaDoJob(CONTA_FIXFY, true).account_id, CONTA_FIXFY);
    assert.equal(camposDaContaDoJob(CONTA_FIXFY, false).account_id, CONTA_FIXFY);
  });
  it("busca no banco casa telefone formatado e não muda a conta do cliente", async () => {
    const { sb, t } = bancoFalso({ clients: [{ ...daHousekeep, deleted_at: null }] });
    const c = await acharClienteEntreContas(sb, { email: null, telefone: "07700900123", nome: "mary smith", contaId: CONTA_FIXFY });
    assert.equal(c?.id, "cli-hk");
    assert.equal(t.clients![0]!.source_account_id, CONTA_HOUSEKEEP);
  });
  it("nome sozinho nunca junta", () => {
    assert.equal(escolherClienteEntreContas([daHousekeep], { email: null, telefone: null, nome: "Mary Smith", contaId: CONTA_FIXFY }), null);
    assert.equal(escolherClienteEntreContas([{ ...daHousekeep, phone: "07111 111111" }], { email: "x@y.com", telefone: "07222 222222", nome: "Mary Smith", contaId: CONTA_FIXFY }), null);
  });
  it("mesmo telefone com nome nada a ver é outra pessoa", () => {
    assert.equal(nomesCompativeis("Mary Smith", "John Brown"), false);
    assert.equal(escolherClienteEntreContas([daHousekeep], { email: null, telefone: "07700900123", nome: "John Brown", contaId: CONTA_FIXFY }), null);
  });
  it("placeholder de empresa não serve e a conta que contrata ganha o empate", () => {
    const placeholder = { ...daHousekeep, id: "cli-corp", full_name: "Housekeep" };
    assert.equal(escolherClienteEntreContas([placeholder], { email: null, telefone: "07700900123", nome: "", contaId: CONTA_FIXFY, nomesProibidos: ["Housekeep"] }), null);
    const daFixfy = { ...daHousekeep, id: "cli-fx", source_account_id: CONTA_FIXFY, created_at: "2026-09-01" };
    assert.equal(escolherClienteEntreContas([daHousekeep, daFixfy], { email: null, telefone: "07700900123", nome: "Mary Smith", contaId: CONTA_FIXFY })?.id, "cli-fx");
  });
  it("normalização", () => {
    assert.equal(telefoneNormalizado("+44 (0) 7700-900123"), "7700900123");
    assert.equal(telefoneNormalizado("12345"), null);
    assert.equal(padraoDoTelefone("7700900123"), "%7%7%0%0%9%0%0%1%2%3");
  });
});

/* --------------------------- Housekeep dedupe --------------------------- */

describe("Housekeep v2: o mesmo booking em dois tickets é um job", () => {
  const card = "https://app.housekeep.com/jobs/abc123?token=x";
  it("com ticket, só Housekeep v2 procura pelo report_link", () => {
    assert.equal(deduplicarPorReportLink({ ticketId: "2", reportLink: card, contaId: CONTA_HOUSEKEEP, v2: true }), true);
    assert.equal(deduplicarPorReportLink({ ticketId: "2", reportLink: card, contaId: CONTA_HOUSEKEEP, v2: false }), false);
    assert.equal(deduplicarPorReportLink({ ticketId: "2", reportLink: card, contaId: CONTA_FIXFY, v2: true }), false);
    assert.equal(deduplicarPorReportLink({ ticketId: null, reportLink: card, contaId: CONTA_FIXFY, v2: false }), true);
  });
  it("segundo ticket com o mesmo card devolve o job do primeiro", async () => {
    const { sb } = bancoFalso({
      jobs: [{ id: "j1", reference: "JOB-1", status: "unassigned", report_link: card, external_source: "zendesk", external_ref: "1", deleted_at: null }],
    });
    assert.equal(await acharJobExistente(sb, { ticketId: "2", reportLink: card, porReportLink: false }), null);
    const dup = await acharJobExistente(sb, { ticketId: "2", reportLink: card, porReportLink: true });
    assert.equal(dup?.reference, "JOB-1");
  });
});

/* --------------------------- Housekeep quotes --------------------------- */

describe("Housekeep v2: lance viável", () => {
  it("processa na hora; só para se a equipe já mandou preço à mão", () => {
    assert.equal(passoDepoisDoHistorico({ respostaManual: false, respostaManualComPreco: false }), "processar");
    assert.equal(passoDepoisDoHistorico({ respostaManual: true, respostaManualComPreco: false }), "processar");
    assert.equal(passoDepoisDoHistorico({ respostaManual: true, respostaManualComPreco: true }), "equipe_respondeu");
  });
});

describe("quote sem lance: 24h No Bids, 48h fecha (dono, 23/10/2026)", () => {
  const p = (primeiro: number, ultimo: number, marca: string | null = null) =>
    passoSemLance({ horasDesdePrimeiroConvite: primeiro, horasDesdeUltimoConvite: ultimo, marca });
  it("espera até 24h, vai para No Bids uma vez, fecha às 48h", () => {
    assert.equal(p(7, 7), "esperar");
    assert.equal(p(23.9, 23.9), "esperar");
    assert.equal(p(24, 24), "no_bids");
    assert.equal(p(30, 30, MARCA_NO_BIDS), "esperar");
    assert.equal(p(47.9, 47.9, MARCA_NO_BIDS), "esperar");
    assert.equal(p(48, 48, MARCA_NO_BIDS), "fechar");
  });
  it("convidar mais parceiros conta como agir: as 48h contam do último convite", () => {
    assert.equal(p(50, 20, MARCA_NO_BIDS), "esperar");
    assert.equal(p(76, 48, MARCA_NO_BIDS), "fechar");
  });
  it("marca antiga das 8h da Housekeep entra na régua nova", () => {
    assert.equal(p(30, 30, "housekeep_no_bid_8h"), "no_bids");
  });
  it("fechada, equipe agiu ou caso de gente: nada mais", () => {
    for (const m of [MARCA_FECHADA_SEM_LANCE, MARCA_EQUIPE_AGIU, "no_bids_needs_person", "no_bids_ticket_closed", "housekeep_no_availability_sent", "housekeep_team_replied"]) {
      assert.equal(p(60, 60, m), "nada", m);
    }
  });
  it("Hi team para conta, primeiro nome para cliente direto", () => {
    assert.equal(saudacaoSemLance({ b2b: true, primeiroNome: "Yosheeta" }), "Hi team,");
    assert.equal(saudacaoSemLance({ b2b: false, primeiroNome: "Joan" }), "Hi Joan,");
    assert.equal(saudacaoSemLance({ b2b: false, primeiroNome: null }), "Hi there,");
  });
  it("o texto do dono, sem travessão, assinado Fixfy Team", () => {
    for (const t of [textoSemLanceHtml("Hi team,"), textoSemLancePlano("Hi team,")]) {
      assert.match(t, /Hi team,/);
      assert.match(t, /not able to quote for this job at the moment/);
      assert.match(t, /If anything changes we will get back to you/);
      assert.match(t, /Fixfy Team/);
      assert.ok(!/[—–]/.test(t));
    }
  });
  it("canal: ticket de e-mail responde no ticket; WhatsApp só com a janela aberta; senão e-mail; senão gente", () => {
    assert.deepEqual(canalSemLance({ daConversa: false, janelaAberta: false, harveyNaConversa: false, emailDoCliente: null }), { via: "ticket" });
    assert.deepEqual(canalSemLance({ daConversa: true, janelaAberta: true, harveyNaConversa: true, emailDoCliente: null }), { via: "whatsapp" });
    assert.deepEqual(canalSemLance({ daConversa: true, janelaAberta: false, harveyNaConversa: true, emailDoCliente: "joan@example.com" }), { via: "email", para: "joan@example.com" });
    assert.deepEqual(canalSemLance({ daConversa: true, janelaAberta: true, harveyNaConversa: false, emailDoCliente: "joan@example.com" }), { via: "email", para: "joan@example.com" });
    assert.equal(canalSemLance({ daConversa: true, janelaAberta: false, harveyNaConversa: true, emailDoCliente: "hello@getfixfy.com" }).via, "nenhum");
    assert.equal(canalSemLance({ daConversa: true, janelaAberta: false, harveyNaConversa: true, emailDoCliente: null }).via, "nenhum");
  });
  it("o 'not able to quote' sai uma vez e fecha a quote", async () => {
    const { sb, t } = bancoFalso({ quotes: [{ id: "q1", reference: "QT-1", status: "bidding", external_ref: "777" }] });
    const enviados: number[] = [];
    const deps = { canal: "email" as const, enviar: async (id: number) => { enviados.push(id); return `zendesk:${id}`; } };
    const a = await fecharQuoteSemLance(sb, { id: "q1", reference: "QT-1", external_ref: "777" }, deps);
    const b = await fecharQuoteSemLance(sb, { id: "q1", reference: "QT-1", external_ref: "777" }, deps);
    assert.equal(a.enviado, true);
    assert.equal(b.enviado, false);
    assert.deepEqual(enviados, [777]);
    assert.equal(t.quotes![0]!.status, "rejected");
    assert.equal(t.quotes![0]!.automation_status, MARCA_FECHADA_SEM_LANCE);
    assert.ok(String(t.quotes![0]!.rejection_reason).length > 0);
    assert.equal(t.outbound_messages![0]!.dedupe_key, "quote-sem-lance:q1");
  });
  it("envio que falhou não fecha a quote", async () => {
    const { sb, t } = bancoFalso({ quotes: [{ id: "q2", reference: "QT-2", status: "bidding", external_ref: "778" }] });
    const r = await fecharQuoteSemLance(sb, { id: "q2", reference: "QT-2", external_ref: "778" }, { canal: "email", enviar: async () => { throw new Error("Zendesk 500"); } });
    assert.equal(r.enviado, false);
    assert.equal(t.quotes![0]!.status, "bidding");
  });
});

describe("preço mandado à mão não é 'sem lance' (dono, 23/10/2026)", () => {
  // QT-2026-1174, #51397: primeiro convite 15/10 07:23; Joan cotada à mão em 16/10 14:05.
  const desde = "2026-10-15T07:23:00Z";
  const parceiros = ["contact@tm-handyman.co.uk", "andre.vicente@mfs-ltd.com"];
  const convite = {
    participantes: ["contact@tm-handyman.co.uk", "leonardo@getfixfy.com"],
    mensagens: [{ em: "2026-10-15T07:23:10Z", deEmail: "leonardo@getfixfy.com", texto: "New opportunity, bid within 12 hours. Typical job £150" }],
  };
  const notasDoHarvey = [
    { public: false, created_at: "2026-10-16T09:27:00Z", via: { channel: "api" }, plain_body: "🤖 HARVEY — nobody bid on QT-2026-1174 5 partner(s) invited" },
    { public: false, created_at: "2026-10-23T12:01:00Z", via: { channel: "api" }, plain_body: "⚡ Action Required: No bids after 197h on QT-2026-1174: invite more partners or call" },
  ];
  const base = { desde, emailsDeParceiros: parceiros, equipeIds: [5], solicitanteId: 9 };

  it("side conversation nossa com o cliente citando £: Approval com o valor", () => {
    const quote = {
      participantes: ["victor@getfixfy.com", "joan.munro@btopenworld.com"],
      mensagens: [
        { em: "2026-10-16T14:05:00Z", deEmail: "victor@getfixfy.com", texto: "Hi Joan, Thanks for the photos. ... our fixed day rate: £329 covers up to 7 hours" },
        { em: "2026-10-16T14:45:00Z", deEmail: "joan.munro@btinternet.com", texto: "Thanks for the quote. Does the day rate include VAT?" },
      ],
    };
    const p = precoMandadoAMao({ ...base, comentarios: notasDoHarvey, sideConversations: [convite, quote] });
    assert.deepEqual(p, { comValor: true, valor: 329, onde: "side conversation with the customer" });
    assert.equal(passoComPrecoAMao(p, "bidding"), "approval");
  });

  it("nota interna com o preço: Approval com o valor", () => {
    const nota = { public: false, created_at: "2026-10-16T14:05:30Z", via: { channel: "api" }, plain_body: "Owner, 16 Oct: no partner bid; quoted ourselves as handyman day rate £329 (up to 7h). Sent by email." };
    const p = precoMandadoAMao({ ...base, comentarios: [...notasDoHarvey, nota], sideConversations: [convite] });
    assert.deepEqual(p, { comValor: true, valor: 329, onde: "internal note" });
    assert.equal(passoComPrecoAMao(p, "bidding"), "approval");
  });

  it("resposta pública à mão com £ também conta; a do Harvey (api) não", () => {
    const daEquipe = { public: true, created_at: "2026-10-17T10:00:00Z", author_id: 5, via: { channel: "web" }, plain_body: "Hi Joan, we can do it for £329." };
    assert.equal(precoMandadoAMao({ ...base, comentarios: [daEquipe], sideConversations: [] })?.onde, "public reply on the ticket");
    const doHarvey = { ...daEquipe, via: { channel: "api" } };
    assert.equal(precoMandadoAMao({ ...base, comentarios: [doHarvey], sideConversations: [] }), null);
  });

  it("nada à mão (QT-2026-1255, #51642: só convites e notas do Harvey): segue a régua e fecha", () => {
    const lembrete = { ...convite, mensagens: [...convite.mensagens, { em: "2026-10-21T14:01:00Z", deEmail: "leonardo@getfixfy.com", texto: "Just a reminder that we're still waiting for your price" }] };
    const p = precoMandadoAMao({ ...base, comentarios: notasDoHarvey, sideConversations: [lembrete] });
    assert.equal(p, null);
    assert.equal(passoComPrecoAMao(p, "bidding"), "seguir");
  });

  it("side conversation com o cliente sem £ (PDF anexo): gente, não fecha", () => {
    const pdf = { participantes: ["victor@getfixfy.com", "joan.munro@btopenworld.com"], mensagens: [{ em: "2026-10-16T14:05:00Z", deEmail: "victor@getfixfy.com", texto: "Hi Joan, please find our quote attached." }] };
    const p = precoMandadoAMao({ ...base, comentarios: [], sideConversations: [pdf] });
    assert.deepEqual(p, { comValor: false, onde: "side conversation with the customer" });
    assert.equal(passoComPrecoAMao(p, "bidding"), "gente");
  });

  it("antes do primeiro convite não conta; quote que já saiu de Bidding não muda", () => {
    const velha = { public: false, created_at: "2026-10-14T10:00:00Z", via: { channel: "web" }, plain_body: "Priced at £329" };
    assert.equal(precoMandadoAMao({ ...base, comentarios: [velha], sideConversations: [] }), null);
    assert.equal(passoComPrecoAMao({ comValor: true, valor: 329, onde: "internal note" }, "awaiting_customer"), "nada");
  });

  it("valor em libras", () => {
    assert.equal(valorEmLibras("day rate £329 covers"), 329);
    assert.equal(valorEmLibras("£ 1,250.50 total"), 1250.5);
    assert.equal(valorEmLibras("no price"), null);
  });

  it("a marca de preço à mão encerra a régua", () => {
    assert.equal(passoSemLance({ horasDesdePrimeiroConvite: 60, horasDesdeUltimoConvite: 60, marca: MARCA_PRECO_A_MAO }), "nada");
  });
});

describe("resposta manual no histórico do ticket", () => {
  const desde = "2026-10-20T10:00:00Z";
  const coment = (o: Record<string, unknown>) => ({ public: true, created_at: "2026-10-21T10:00:00Z", author_id: 5, via: { channel: "web" }, body: "Hi", ...o });
  it("só agente, público, depois da quote, fora da API", () => {
    const equipe = idsDaEquipe([{ id: 5, role: "agent" }, { id: 9, role: "end-user" }]);
    const op = { solicitanteId: 9, equipeIds: equipe };
    assert.equal(respostaManualDepoisDe([coment({ via: { channel: "api" } })], desde, op), null);
    assert.equal(respostaManualDepoisDe([coment({ public: false })], desde, op), null);
    assert.equal(respostaManualDepoisDe([coment({ created_at: "2026-10-19T10:00:00Z" })], desde, op), null);
    assert.equal(respostaManualDepoisDe([coment({ author_id: 9, via: { channel: "email" } })], desde, op), null);
    assert.ok(respostaManualDepoisDe([coment({})], desde, op));
    assert.equal(respostaManualDepoisDe([coment({})], desde, { ...op, soComPreco: true }), null);
    assert.ok(respostaManualDepoisDe([coment({ body: "Our price is £180" })], desde, { ...op, soComPreco: true }));
  });
});

/* ------------------------ confirmação do booking ------------------------ */

describe("Housekeep v2: confirmação liga na quote existente", () => {
  const agora = new Date("2026-10-22T12:00:00Z");
  const quote: QuoteDoBooking = {
    id: "q-hk", reference: "QT-2026-1200", status: "quote_ready", postcode: null, property_address: "14 Park Lane, London W1K 1BE",
    created_at: "2026-10-15T09:00:00Z", partner_id: "p1", partner_name: "Ana Clean", partner_cost: 90,
    start_date_option_1: "2026-10-25", start_date_option_2: null, external_ref: "50001",
  };
  it("acha a quote de outro ticket pelo postcode", () => {
    const q = escolherQuoteDoBooking([quote], { postcode: "w1k1be", endereco: "14 Park Lane", agora });
    assert.equal(q?.id, "q-hk");
  });
  it("mais de 30 dias, fechada ou outro postcode: não liga", () => {
    assert.equal(escolherQuoteDoBooking([{ ...quote, created_at: "2026-09-01T00:00:00Z" }], { postcode: "W1K 1BE", endereco: null, agora }), null);
    assert.equal(escolherQuoteDoBooking([{ ...quote, status: "converted_to_job" }], { postcode: "W1K 1BE", endereco: null, agora }), null);
    assert.equal(escolherQuoteDoBooking([quote], { postcode: "SW1A 1AA", endereco: null, agora }), null);
  });
  it("duas no mesmo postcode: o número da casa desempata; sem desempate, não chuta", () => {
    const outra = { ...quote, id: "q-outra", property_address: "20 Park Lane, London W1K 1BE" };
    assert.equal(escolherQuoteDoBooking([quote, outra], { postcode: "W1K 1BE", endereco: "20 Park Lane", agora })?.id, "q-outra");
    assert.equal(escolherQuoteDoBooking([quote, outra], { postcode: "W1K 1BE", endereco: "Park Lane", agora }), null);
  });
  it("parceiro escolhido e data oferecida: Scheduled com ele", () => {
    const p = planoDoJobDoBooking(quote, { dataDoBooking: "2026-10-25", janelaDoCard: true });
    assert.equal(p.status, "scheduled");
    assert.equal(p.partnerId, "p1");
    assert.equal(p.partnerCost, 90);
    assert.equal(p.quoteId, "q-hk");
  });
  it("falta data, janela ou parceiro: Unassigned, ligado na quote, com o motivo", () => {
    const semData = planoDoJobDoBooking(quote, { dataDoBooking: "2026-10-26", janelaDoCard: true });
    assert.equal(semData.status, "unassigned");
    assert.equal(semData.quoteId, "q-hk");
    assert.match(semData.notas[0]!, /not one the partner offered/);
    assert.equal(planoDoJobDoBooking(quote, { dataDoBooking: "2026-10-25", janelaDoCard: false }).status, "unassigned");
    assert.equal(planoDoJobDoBooking({ ...quote, status: "bidding" }, { dataDoBooking: "2026-10-25", janelaDoCard: true }).partnerId, null);
    assert.equal(planoDoJobDoBooking(null, { dataDoBooking: "2026-10-25", janelaDoCard: true }).quoteId, null);
  });
});

describe("textos ao cliente", () => {
  it("nenhum travessão em texto novo", () => {
    for (const [nome, v] of Object.entries(textos)) if (typeof v === "string") assert.ok(!/[—–]/.test(v), nome);
  });
});
