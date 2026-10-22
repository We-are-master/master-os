import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { regrasDoProcesso, type RegrasDoProcesso } from "./conta";
import {
  ehB2bSoHumano, foraDaCotacaoAutomatica, planoDoPedido, proximaAcaoDaRevisao,
  TAG_B2B_COTADO, TAG_B2B_COTAR, TAG_REVISAO_HUMANA,
} from "./b2b-humano";
import { chaveDoB2bCotar, pedeCotacaoPelaMacro, varrerB2bCotar, type DependenciasDoB2bCotar, type TicketDaMacro } from "./b2b-cotar";
import { chaveDasBoasVindas, decidirBoasVindas, mandarBoasVindasDoLead, type DependenciasDasBoasVindas, type LeadParaBoasVindas } from "./boas-vindas-lead";
import { emailDeBoasVindasDoLead, paragrafosDeBoasVindas } from "./textos-lead";
import { decidirAviso, TAG_AVISO_COTANDO } from "@/lib/zendesk-quoter/aviso-de-cotacao";
import { notaDaAcao } from "@/lib/fila-de-acao";
import { chipsPorJob, idsSegurosParaFiltro, motivoPoeNaFila, MAX_IDS_COM_MOTIVO } from "@/lib/pendencias/chips";

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

function mundoDasBoasVindas(o: { janela?: boolean; regras?: RegrasDoProcesso | null; requester?: string | null } = {}) {
  const reservas = new Map<string, string>();
  const enviados: Array<{ ticket: number; html: string }> = [];
  let leituras = 0;
  const deps: DependenciasDasBoasVindas = {
    regras: async () => (o.regras === undefined ? directV2() : o.regras),
    janelaAberta: async () => o.janela ?? true,
    emailDoCliente: async () => { leituras++; return "sarah@example.com"; },
    requesterDoTicket: async () => { leituras++; return o.requester === undefined ? "Sarah@Example.com" : o.requester; },
    reservar: async (chave) => {
      if (reservas.get(chave) === "sent") return { reservado: false, motivo: "already sent" };
      reservas.set(chave, "reserved");
      return { reservado: true };
    },
    confirmar: async (chave) => { reservas.set(chave, "sent"); },
    falhou: async (chave) => { reservas.set(chave, "failed"); },
    comentar: async (ticket, html) => { enviados.push({ ticket, html }); },
  };
  return { deps, reservas, enviados, leituras: () => leituras };
}

describe("e-mail de boas-vindas ao lead", () => {
  it("sai uma vez por lead", async () => {
    const m = mundoDasBoasVindas();
    const r1 = await mandarBoasVindasDoLead(LEAD, m.deps);
    assert.equal(r1.enviado, true);
    const r2 = await mandarBoasVindasDoLead(LEAD, m.deps);
    assert.equal(r2.enviado, false);
    assert.equal(m.enviados.length, 1);
    assert.equal(m.reservas.get("lead-welcome-email:CT-123"), "sent");
    assert.match(m.enviados[0]!.html, /plumbing/);
  });
  it("respeita a janela de envio", async () => {
    const m = mundoDasBoasVindas({ janela: false });
    const r = await mandarBoasVindasDoLead(LEAD, m.deps);
    assert.deepEqual(r, { enviado: false, motivo: "outside sending hours" });
    assert.equal(m.enviados.length, 0);
    assert.equal(m.reservas.size, 0, "fora do horário nem reserva");
  });
  it("conta fora do v2 direct: nada lido, nada enviado", async () => {
    const m = mundoDasBoasVindas({ regras: comV2(() => regrasDoProcesso("direct", {})) });
    const r = await mandarBoasVindasDoLead(LEAD, m.deps);
    assert.equal(r.enviado, false);
    assert.equal(m.leituras(), 0);
  });
  it("ticket com requester da casa (lead sem e-mail no ticket) não recebe comentário público", async () => {
    const m = mundoDasBoasVindas({ requester: "team@getfixfy.com" });
    assert.equal((await mandarBoasVindasDoLead(LEAD, m.deps)).motivo, "ticket requester is not the customer");
  });
  it("falha no envio libera a chave para tentar de novo", async () => {
    const m = mundoDasBoasVindas();
    m.deps.comentar = async () => { throw new Error("Zendesk 500"); };
    const r = await mandarBoasVindasDoLead(LEAD, m.deps);
    assert.equal(r.enviado, false);
    assert.equal(m.reservas.get("lead-welcome-email:CT-123"), "failed");
  });
  it("chave pelo lead externo, senão pelo telefone", () => {
    assert.equal(chaveDasBoasVindas({ leadExterno: "CT-9", telefone: "+44 7700" }), "lead-welcome-email:CT-9");
    assert.equal(chaveDasBoasVindas({ leadExterno: null, telefone: "+44 7700 900123" }), "lead-welcome-email:447700900123");
    assert.equal(decidirBoasVindas({ lead: { ...LEAD, ticketId: null }, regras: directV2(), janelaAberta: true, email: "a@b.co", requesterDoTicket: "a@b.co" }).mandar, false);
  });
  it("texto: inglês, formal, sem travessão, sem falar em IA ou bot", () => {
    const ps = paragrafosDeBoasVindas({ nome: "Sarah", servico: "End Of Tenancy Cleaning", checkatrade: true });
    const tudo = ps.join(" ");
    assert.match(tudo, /through Checkatrade about end of tenancy cleaning/);
    assert.doesNotMatch(tudo, /[—–]/);
    assert.doesNotMatch(tudo, /\b(AI|bot|assistant|automated)\b/i);
    const { text } = emailDeBoasVindasDoLead({ nome: "there", servico: null, checkatrade: false });
    assert.match(text, /^Hi there,/);
    assert.doesNotMatch(text, /[—]/);
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
  it("motivo aberto põe na fila, menos job encerrado", () => {
    assert.equal(motivoPoeNaFila({ status: "scheduled" }, true), true, "Date TBC com parceiro");
    assert.equal(motivoPoeNaFila({ status: "scheduled" }, false), false);
    assert.equal(motivoPoeNaFila({ status: "completed" }, true), false);
    assert.equal(motivoPoeNaFila({ status: "cancelled" }, true), false);
  });
  it("ids do filtro: só UUID, sem repetir, com teto", () => {
    const u = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
    assert.deepEqual(idsSegurosParaFiltro([u(1), u(1), "x),status.eq.completed", u(2)]), [u(1), u(2)]);
    assert.equal(idsSegurosParaFiltro(Array.from({ length: 400 }, (_, i) => u(i))).length, MAX_IDS_COM_MOTIVO);
  });
});

describe("aba Action Required com motivo aberto", () => {
  it("job agendado com parceiro e motivo aberto entra; sem motivo, como antes", async () => {
    const { jobRowMatchesJobsManagementTab } = await import("@/services/jobs");
    const agendado = { status: "scheduled", partner_id: "p1", partner_ids: ["p1"] } as never;
    assert.equal(jobRowMatchesJobsManagementTab(agendado, "action_required"), false);
    assert.equal(jobRowMatchesJobsManagementTab(agendado, "action_required", { temMotivoAberto: true }), true);
    assert.equal(jobRowMatchesJobsManagementTab(agendado, "scheduled", { temMotivoAberto: true }), true, "continua na aba dele");
    assert.equal(jobRowMatchesJobsManagementTab({ status: "completed", partner_id: "p1", partner_ids: [] } as never, "action_required", { temMotivoAberto: true }), false);
    assert.equal(jobRowMatchesJobsManagementTab({ status: "on_hold", partner_id: "p1", partner_ids: [] } as never, "action_required"), true);
  });
});
