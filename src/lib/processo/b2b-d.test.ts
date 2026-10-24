import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { regrasDoProcesso, type RegrasDoProcesso } from "./conta";
import {
  ehB2bSoHumano, foraDaCotacaoAutomatica, planoDoPedido, proximaAcaoDaRevisao,
  TAG_B2B_COTADO, TAG_B2B_COTAR, TAG_REVISAO_HUMANA,
} from "./b2b-humano";
import { chaveDoB2bCotar, pedeCotacaoPelaMacro, varrerB2bCotar, type DependenciasDoB2bCotar, type TicketDaMacro } from "./b2b-cotar";
import { chaveDasBoasVindas, decidirBoasVindas, mandarBoasVindasDoLead, type DependenciasDasBoasVindas, type LeadParaBoasVindas } from "./boas-vindas-lead";
import { decidirAviso, TAG_AVISO_COTANDO } from "@/lib/zendesk-quoter/aviso-de-cotacao";
import { notaDaAcao } from "@/lib/fila-de-acao";
import { chipsPorJob, idsSegurosParaFiltro, MAX_IDS_COM_MOTIVO } from "@/lib/pendencias/chips";

function comV2<T>(fn: () => T): T {
  const antes = process.env.PROCESSOS_V2;
  process.env.PROCESSOS_V2 = "on";
  try { return fn(); } finally { if (antes === undefined) delete process.env.PROCESSOS_V2; else process.env.PROCESSOS_V2 = antes; }
}
const b2bV2 = (): RegrasDoProcesso => comV2(() => regrasDoProcesso("b2b", { v2: true }));
const b2bSemV2 = (): RegrasDoProcesso => comV2(() => regrasDoProcesso("b2b", {}));
const directV2 = (): RegrasDoProcesso => comV2(() => regrasDoProcesso("direct", { v2: true }));

/* ─────────────────────────── A: pedido B2B para em revisão humana ─────────────────────────── */

describe("B2B só com gente: o pedido para em revisão humana", () => {
  it("conta b2b v2: registra, reconhece, sem convite, sem hora, sem perguntas, sem transmitir", () => {
    const p = planoDoPedido(b2bV2());
    assert.equal(ehB2bSoHumano(b2bV2()), true);
    assert.deepEqual(p, { revisaoHumana: true, transmitir: false, convidarParceiros: false, aceitarHora: false, pedirInfo: false, avisoSempre: true });
  });
  it("fora do v2 o plano é o de sempre (produção igual)", () => {
    const normal = { revisaoHumana: false, transmitir: true, convidarParceiros: true, aceitarHora: true, pedirInfo: true, avisoSempre: false };
    assert.deepEqual(planoDoPedido(b2bSemV2()), normal);
    assert.deepEqual(planoDoPedido(null), normal);
    assert.deepEqual(planoDoPedido(directV2()), normal);
    // Exceção da conta: b2b v2 com b2b_human_only=false volta ao automático.
    assert.equal(planoDoPedido(comV2(() => regrasDoProcesso("b2b", { v2: true, b2b_human_only: false }))).convidarParceiros, true);
  });
  it("o aviso sai mesmo com HARVEY_QUOTE_ACK desligado, sem mudar status, uma vez só", () => {
    const base = { armado: false, orgReconhecida: true, temEndereco: true, convitesEnviados: 0, tags: [] as string[] };
    assert.equal(decidirAviso(base).fala, false, "sem b2bSoHumano continua calado");
    const d = decidirAviso({ ...base, b2bSoHumano: true });
    assert.equal(d.fala, true);
    if (d.fala) {
      assert.equal(d.cara, "cotando");
      assert.equal(d.status, null);
      assert.equal(d.tag, TAG_AVISO_COTANDO);
      assert.match(d.html, /working on a quote/);
    }
    assert.equal(decidirAviso({ ...base, b2bSoHumano: true, tags: [TAG_AVISO_COTANDO] }).fala, false);
    // Sem endereço também: não pede postcode (pergunta é da equipe).
    const semEndereco = decidirAviso({ ...base, temEndereco: false, b2bSoHumano: true });
    assert.equal(semEndereco.fala && semEndereco.cara, "cotando");
    // Organização desconhecida continua calada.
    assert.equal(decidirAviso({ ...base, orgReconhecida: false, b2bSoHumano: true }).fala, false);
  });
  it("Action Required leva o motivo Human Review Required", () => {
    const nota = notaDaAcao(proximaAcaoDaRevisao("QT-2026-1300"));
    assert.match(nota, /^⚡ Action Required: Human Review Required: B2B request registered as QT-2026-1300/);
    assert.doesNotMatch(nota, /—/);
  });
  it("a varredura da cotação automática não pega o ticket", () => {
    assert.equal(foraDaCotacaoAutomatica([TAG_REVISAO_HUMANA]), true);
    assert.equal(foraDaCotacaoAutomatica([TAG_B2B_COTAR]), true);
    assert.equal(foraDaCotacaoAutomatica([TAG_B2B_COTADO]), true);
    assert.equal(foraDaCotacaoAutomatica([], b2bV2()), true, "sem a tag, a conta da quote segura");
    assert.equal(foraDaCotacaoAutomatica([], b2bSemV2()), false);
    assert.equal(foraDaCotacaoAutomatica(["b2b"], null), false);
  });
});

/* ─────────────────────────── B: macro b2b_cotar, uma vez só ─────────────────────────── */

function mundoDaMacro(opcoes: { regras?: RegrasDoProcesso | null; cotarFalha?: boolean } = {}) {
  const tags = new Map<number, Set<string>>([[501, new Set(["b2b", TAG_REVISAO_HUMANA, TAG_B2B_COTAR])]]);
  const reservas = new Map<string, string>();
  const chamadas = { cotar: [] as number[], acao: [] as string[], carimbos: [] as string[] };
  const deps: DependenciasDoB2bCotar = {
    // A busca do Zendesk: tag b2b_cotar e sem b2b_cotado.
    buscar: async () =>
      [...tags.entries()]
        .filter(([, t]) => t.has(TAG_B2B_COTAR) && !t.has(TAG_B2B_COTADO))
        .map(([id, t]): TicketDaMacro => ({ id, tags: [...t], requesterEmail: "ops@agency.co.uk", subject: "Leak" })),
    regrasDoTicket: async () => ({ contaId: "acc", regras: opcoes.regras === undefined ? b2bV2() : opcoes.regras }),
    reservar: async (chave) => {
      const s = reservas.get(chave);
      if (s === "sent" || s === "reserved") return { reservado: false, motivo: s === "sent" ? "already sent" : "another run is sending" };
      reservas.set(chave, "reserved");
      return { reservado: true };
    },
    confirmar: async (chave) => { reservas.set(chave, "sent"); },
    falhou: async (chave) => { reservas.set(chave, "failed"); },
    carimbar: async (id, tag) => { chamadas.carimbos.push(`${id}:${tag}`); tags.get(id)!.add(tag); },
    cotar: async (id) => {
      // A trava já está no ticket quando os convites saem.
      assert.equal(tags.get(id)!.has(TAG_B2B_COTADO), true);
      chamadas.cotar.push(id);
      if (opcoes.cotarFalha) throw new Error("price check down");
      return { enviados: 4, quoteRef: "QT-2026-1301" };
    },
    precisaDeAcao: async (_id, proxima) => { chamadas.acao.push(proxima); },
  };
  return { deps, tags, reservas, chamadas };
}

describe("macro Get partner quotes (b2b_cotar)", () => {
  it("roda uma vez: a segunda passada não faz nada", async () => {
    const m = mundoDaMacro();
    const r1 = await varrerB2bCotar(m.deps);
    assert.equal(r1.cotados.length, 1);
    assert.deepEqual(m.chamadas.cotar, [501]);
    assert.equal(m.reservas.get(chaveDoB2bCotar(501)), "sent");
    assert.deepEqual(m.chamadas.carimbos, [`501:${TAG_B2B_COTADO}`]);
    const r2 = await varrerB2bCotar(m.deps);
    assert.equal(r2.olhados, 0);
    assert.deepEqual(m.chamadas.cotar, [501], "nenhum convite novo");
  });
  it("a reserva segura mesmo se a busca ainda devolver o ticket (tag atrasada)", async () => {
    const m = mundoDaMacro();
    await varrerB2bCotar(m.deps);
    m.tags.get(501)!.delete(TAG_B2B_COTADO); // índice de busca do Zendesk atrasado
    const r = await varrerB2bCotar(m.deps);
    assert.deepEqual(m.chamadas.cotar, [501]);
    assert.match(r.pulados[0]!, /already sent/);
  });
  it("conta fora do v2: tag ignorada, nada escrito", async () => {
    const m = mundoDaMacro({ regras: b2bSemV2() });
    const r = await varrerB2bCotar(m.deps);
    assert.equal(m.chamadas.cotar.length, 0);
    assert.equal(m.chamadas.carimbos.length, 0);
    assert.equal(m.reservas.size, 0);
    assert.match(r.pulados[0]!, /not on the v2/);
  });
  it("falha depois da trava: Action Required, e não tenta de novo sozinho", async () => {
    const m = mundoDaMacro({ cotarFalha: true });
    await varrerB2bCotar(m.deps);
    assert.equal(m.reservas.get(chaveDoB2bCotar(501)), "failed");
    assert.match(m.chamadas.acao[0]!, /Get partner quotes failed/);
    await varrerB2bCotar(m.deps);
    assert.equal(m.chamadas.cotar.length, 1);
  });
  it("pedeCotacaoPelaMacro respeita harvey_off e b2b_cotado", () => {
    assert.equal(pedeCotacaoPelaMacro([TAG_B2B_COTAR]), true);
    assert.equal(pedeCotacaoPelaMacro([TAG_B2B_COTAR, TAG_B2B_COTADO]), false);
    assert.equal(pedeCotacaoPelaMacro([TAG_B2B_COTAR, "harvey_off"]), false);
    assert.equal(chaveDoB2bCotar(77), "b2b-cotar:77");
  });
});

/* ─────────────────────────── C: boas-vindas ao lead ─────────────────────────── */

const LEAD: LeadParaBoasVindas = { ticketId: 900, clienteId: "c1", telefone: "+447700900123", leadExterno: "CT-123", servico: "Plumbing", nome: "Sarah" };

function mundoDasBoasVindas(o: { janela?: boolean; regras?: RegrasDoProcesso | null; bloqueado?: boolean; jaComprou?: boolean } = {}) {
  const reservas = new Map<string, string>();
  const enviados: Array<{ para: string; html: string; assunto: string }> = [];
  let leituras = 0;
  const deps: DependenciasDasBoasVindas = {
    regras: async () => (o.regras === undefined ? directV2() : o.regras),
    janelaAberta: async () => o.janela ?? true,
    emailDoCliente: async () => { leituras++; return "Sarah@Example.com"; },
    bloqueado: async () => o.bloqueado ?? false,
    jaComprou: async () => o.jaComprou ?? false,
    reservar: async (chave) => {
      if (reservas.get(chave) === "sent") return { reservado: false, motivo: "already sent" };
      reservas.set(chave, "reserved");
      return { reservado: true };
    },
    confirmar: async (chave) => { reservas.set(chave, "sent"); },
    falhou: async (chave) => { reservas.set(chave, "failed"); },
    linkDeSaida: () => "https://app.getfixfy.com/api/email/unsubscribe?e=x",
    enviar: async (para, e) => { enviados.push({ para, html: e.html, assunto: e.assunto }); return "re_1"; },
  };
  return { deps, reservas, enviados, leituras: () => leituras };
}

describe("Welcome to Fixfy ao lead novo", () => {
  it("sai uma vez por pessoa, pelo e-mail", async () => {
    const m = mundoDasBoasVindas();
    assert.equal((await mandarBoasVindasDoLead(LEAD, m.deps)).enviado, true);
    assert.equal((await mandarBoasVindasDoLead({ ...LEAD, leadExterno: "OUTRO" }, m.deps)).enviado, false);
    assert.equal(m.enviados.length, 1);
    assert.equal(m.enviados[0]!.para, "sarah@example.com");
    assert.equal(m.reservas.get("welcome:sarah@example.com"), "sent");
    assert.equal(m.enviados[0]!.assunto, "Welcome to Fixfy: 10% off your first booking");
    assert.match(m.enviados[0]!.html, /Hi Sarah,/);
    assert.match(m.enviados[0]!.html, /WELCOME10/);
    assert.doesNotMatch(m.enviados[0]!.html, /\{\{|<!--/);
  });
  it("respeita a janela de envio", async () => {
    const m = mundoDasBoasVindas({ janela: false });
    assert.deepEqual(await mandarBoasVindasDoLead(LEAD, m.deps), { enviado: false, motivo: "outside sending hours" });
    assert.equal(m.reservas.size, 0, "fora do horário nem reserva");
  });
  it("conta fora do v2 direct: nada lido, nada enviado", async () => {
    const m = mundoDasBoasVindas({ regras: comV2(() => regrasDoProcesso("direct", {})) });
    assert.equal((await mandarBoasVindasDoLead(LEAD, m.deps)).enviado, false);
    assert.equal(m.leituras(), 0);
  });
  it("não manda para quem descadastrou nem para quem já comprou", async () => {
    assert.equal((await mandarBoasVindasDoLead(LEAD, mundoDasBoasVindas({ bloqueado: true }).deps)).motivo, "email is on the marketing block list");
    assert.equal((await mandarBoasVindasDoLead(LEAD, mundoDasBoasVindas({ jaComprou: true }).deps)).motivo, "returning customer: the offer is for a first booking");
  });
  it("falha no envio libera a chave para tentar de novo", async () => {
    const m = mundoDasBoasVindas();
    m.deps.enviar = async () => { throw new Error("Resend 500"); };
    assert.equal((await mandarBoasVindasDoLead(LEAD, m.deps)).enviado, false);
    assert.equal(m.reservas.get("welcome:sarah@example.com"), "failed");
  });
  it("chave e decisão", () => {
    assert.equal(chaveDasBoasVindas(" Sarah@Example.com "), "welcome:sarah@example.com");
    assert.equal(decidirBoasVindas({ regras: directV2(), janelaAberta: true, email: "team@getfixfy.com", bloqueado: false, jaComprou: false }).mandar, false);
  });
});

/* ─────────────────────────── D: chips de motivo ─────────────────────────── */

describe("chips de motivo na aba Action Required", () => {
  it("mapeia pelo rótulo, na ordem dos motivos, sem repetir, ignorando desconhecido", () => {
    const m = chipsPorJob([
      { job_id: "j1", reason: "partner_cost_missing" },
      { job_id: "j1", reason: "date_tbc" },
      { job_id: "j1", reason: "date_tbc" },
      { job_id: "j2", reason: "card_declined" },
      { job_id: "j2", reason: "something_else" },
      { job_id: "j3", reason: "nope" },
    ]);
    assert.deepEqual(m.get("j1"), [{ motivo: "date_tbc", rotulo: "Date TBC" }, { motivo: "partner_cost_missing", rotulo: "Partner Cost Missing" }]);
    assert.deepEqual(m.get("j2"), [{ motivo: "card_declined", rotulo: "Card Declined" }]);
    assert.equal(m.has("j3"), false);
    assert.equal(chipsPorJob([]).size, 0, "tabela vazia: nenhum chip");
  });
  it("ids do filtro: só UUID, sem repetir, com teto", () => {
    const u = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    assert.deepEqual(idsSegurosParaFiltro([u(1), u(1), "x),status.eq.completed", u(2)]), [u(1), u(2)]);
    assert.equal(idsSegurosParaFiltro(Array.from({ length: 400 }, (_, i) => u(i))).length, MAX_IDS_COM_MOTIVO);
  });
});

describe("aba Action Required: só sem parceiro ou em espera (dono, 24/10/2026)", () => {
  it("motivo aberto não puxa o job; ele fica na aba da etapa", async () => {
    const { jobRowMatchesJobsManagementTab } = await import("@/services/jobs");
    const agendado = { status: "scheduled", partner_id: "p1", partner_ids: ["p1"] } as never;
    const finalCheck = { status: "final_check", partner_id: "p1", partner_ids: ["p1"] } as never;
    assert.equal(jobRowMatchesJobsManagementTab(agendado, "action_required"), false, "Deposit Pending / Date TBC com parceiro: fica em Scheduled");
    assert.equal(jobRowMatchesJobsManagementTab(agendado, "scheduled"), true);
    assert.equal(jobRowMatchesJobsManagementTab(finalCheck, "action_required"), false, "Report Incomplete: fica em Final review");
    assert.equal(jobRowMatchesJobsManagementTab(finalCheck, "final_check"), true);
    assert.equal(jobRowMatchesJobsManagementTab({ status: "unassigned", partner_id: null, partner_ids: [] } as never, "action_required"), true);
    assert.equal(jobRowMatchesJobsManagementTab({ status: "scheduled", partner_id: null, partner_ids: [] } as never, "action_required"), true, "agendado sem parceiro");
    assert.equal(jobRowMatchesJobsManagementTab({ status: "on_hold", partner_id: "p1", partner_ids: [] } as never, "action_required"), true);
  });
});
