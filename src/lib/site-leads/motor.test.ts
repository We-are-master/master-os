/* eslint-disable @typescript-eslint/no-explicit-any */
/**
 * O motor inteiro, de ponta a ponta, sem sair do processo: banco falso (o
 * pedaço do supabase-js que o motor usa), Zendesk e Meta falsos atrás do
 * `fetch`, e-mail capturado. Cada teste anda o relógio de 10 em 10 minutos,
 * como o n8n, e confere o que o cliente teria recebido.
 *
 * O que estes testes seguram é o que custaria caro errar em produção:
 * backlog virando rajada, toque depois de resposta, WhatsApp sem template
 * aprovado gritando erro, ensaio gravando coisa.
 */
import { strict as assert } from "node:assert";
import { before, beforeEach, describe, it } from "node:test";
import type { MensagemDeEmail, ResultadoDoMotor } from "./motor";

// Env ANTES de carregar o motor: zendesk.ts lê o dele na carga do módulo.
Object.assign(process.env, {
  RESERVA_ABANDONADA: "on",
  ZENDESK_SUBDOMAIN: "fixfy-teste",
  ZENDESK_EMAIL: "robo@example.com",
  ZENDESK_API_TOKEN: "token-teste",
  WHATSAPP_TOKEN: "wa-teste",
  WHATSAPP_PHONE_NUMBER_ID: "111",
  WHATSAPP_WABA_ID: "999",
  NEXT_PUBLIC_APP_URL: "https://app.teste",
});
for (const k of ["STRIPE_PROMO_SECRET_KEY", "RESEND_MARKETING_REPLY_TO", "RESERVA_ABANDONADA_REPLY_TO", "RESERVA_ABANDONADA_WHATSAPP", "RESEND_MARKETING_FROM"]) {
  delete process.env[k];
}

let rodarMotor: typeof import("./motor").rodarMotor;
before(async () => {
  ({ rodarMotor } = await import("./motor"));
});

// ------------------------------------------------------------ relógio

let relogio = new Date("2026-09-28T06:00:00Z");
const MIN = 60_000;

// ------------------------------------------------------------ banco falso

type Linha = Record<string, any>;

function comparar(a: unknown, b: unknown): number {
  const x = Date.parse(String(a));
  const y = Date.parse(String(b));
  if (!Number.isNaN(x) && !Number.isNaN(y)) return x - y;
  return String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0;
}

/** `and(a.is.null,b.lte.2026-…),and(…)` → grupos de condições. */
function condicoesDoOr(expr: string): Array<Array<(r: Linha) => boolean>> {
  const grupos: string[] = [];
  let nivel = 0;
  let atual = "";
  for (const ch of expr) {
    if (ch === "(") nivel++;
    if (ch === ")") nivel--;
    if (ch === "," && nivel === 0) {
      grupos.push(atual);
      atual = "";
    } else atual += ch;
  }
  if (atual) grupos.push(atual);
  return grupos.map((g) => {
    const dentro = g.replace(/^and\(/, "").replace(/\)$/, "");
    return dentro.split(",").map((cond) => {
      const [col, op, ...resto] = cond.split(".");
      const valor = resto.join(".");
      if (op === "is") return (r: Linha) => r[col] == null;
      if (op === "lte") return (r: Linha) => r[col] != null && comparar(r[col], valor) <= 0;
      if (op === "eq") return (r: Linha) => String(r[col]) === valor;
      throw new Error(`or() falso não conhece ${op}`);
    });
  });
}

class Consulta implements PromiseLike<{ data: any; error: any }> {
  private filtros: Array<(r: Linha) => boolean> = [];
  private op: "select" | "insert" | "update" | "delete" | "upsert" = "select";
  private valores: any = null;
  private opcoesUpsert: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  private ordem: { col: string; asc: boolean } | null = null;
  private lim: number | null = null;
  private retorno: "varios" | "um" | "talvez" = "varios";

  constructor(private banco: BancoFalso, private tabela: string) {}

  select() { return this; }
  insert(v: any) { this.op = "insert"; this.valores = v; return this; }
  update(v: any) { this.op = "update"; this.valores = v; return this; }
  upsert(v: any, o: any = {}) { this.op = "upsert"; this.valores = v; this.opcoesUpsert = o; return this; }
  delete() { this.op = "delete"; return this; }
  eq(c: string, v: unknown) { this.filtros.push((r) => r[c] === v); return this; }
  neq(c: string, v: unknown) { this.filtros.push((r) => r[c] !== v); return this; }
  in(c: string, vs: unknown[]) { this.filtros.push((r) => vs.includes(r[c])); return this; }
  is(c: string, v: unknown) { this.filtros.push((r) => (v === null ? r[c] == null : r[c] === v)); return this; }
  not(c: string, op: string, v: unknown) {
    if (op !== "is" || v !== null) throw new Error("not() falso só conhece is.null");
    this.filtros.push((r) => r[c] != null);
    return this;
  }
  gte(c: string, v: unknown) { this.filtros.push((r) => r[c] != null && comparar(r[c], v) >= 0); return this; }
  lte(c: string, v: unknown) { this.filtros.push((r) => r[c] != null && comparar(r[c], v) <= 0); return this; }
  like(c: string, p: string) {
    const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`);
    this.filtros.push((r) => re.test(String(r[c] ?? "")));
    return this;
  }
  ilike(c: string, p: string) {
    const re = new RegExp(`^${p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/%/g, ".*")}$`, "i");
    this.filtros.push((r) => re.test(String(r[c] ?? "")));
    return this;
  }
  or(expr: string) {
    const grupos = condicoesDoOr(expr);
    this.filtros.push((r) => grupos.some((g) => g.every((cond) => cond(r))));
    return this;
  }
  order(col: string, o: { ascending?: boolean } = {}) { this.ordem = { col, asc: o.ascending !== false }; return this; }
  limit(n: number) { this.lim = n; return this; }
  maybeSingle() { this.retorno = "talvez"; return this; }
  single() { this.retorno = "um"; return this; }

  then<A, B>(ok?: ((v: { data: any; error: any }) => A | PromiseLike<A>) | null, falha?: ((e: unknown) => B | PromiseLike<B>) | null) {
    return Promise.resolve(this.executar()).then(ok, falha);
  }

  private linhas(): Linha[] {
    return (this.banco.tabelas[this.tabela] ??= []);
  }

  private entregar(rows: Linha[]) {
    const copia = rows.map((r) => structuredClone(r));
    if (this.retorno === "varios") return { data: copia, error: null };
    if (this.retorno === "um" && copia.length !== 1) return { data: null, error: { message: `esperava 1 linha, veio ${copia.length}` } };
    return { data: copia[0] ?? null, error: null };
  }

  private executar(): { data: any; error: any } {
    const todas = this.linhas();
    const casa = (r: Linha) => this.filtros.every((f) => f(r));
    if (this.op === "select") {
      let rows = todas.filter(casa);
      if (this.ordem) {
        const { col, asc } = this.ordem;
        rows = [...rows].sort((a, b) => (asc ? 1 : -1) * comparar(a[col], b[col]));
      }
      if (this.lim != null) rows = rows.slice(0, this.lim);
      return this.entregar(rows);
    }
    if (this.op === "update") {
      const rows = todas.filter(casa);
      for (const r of rows) Object.assign(r, structuredClone(this.valores));
      return this.entregar(rows);
    }
    if (this.op === "delete") {
      this.banco.tabelas[this.tabela] = todas.filter((r) => !casa(r));
      return { data: null, error: null };
    }
    const novas: Linha[] = (Array.isArray(this.valores) ? this.valores : [this.valores]).map((v: Linha) => structuredClone(v));
    if (this.op === "upsert") {
      const chave = this.opcoesUpsert.onConflict ?? "id";
      for (const n of novas) {
        const existente = todas.find((r) => r[chave] === n[chave]);
        if (existente && this.opcoesUpsert.ignoreDuplicates) continue;
        if (existente) Object.assign(existente, n);
        else todas.push({ id: `id-${++this.banco.seq}`, created_at: relogio.toISOString(), ...n });
      }
      return { data: null, error: null };
    }
    // insert, com o índice único da 291 (um WhatsApp por número por campanha)
    for (const n of novas) {
      if (this.tabela === "marketing_touches" && n.channel === "whatsapp" && todas.some((r) => r.channel === "whatsapp" && r.campaign === n.campaign && r.phone === n.phone)) {
        return { data: null, error: { code: "23505", message: "duplicate key value violates unique constraint \"marketing_touches_wa_once\"" } };
      }
    }
    const gravadas = novas.map((n) => ({ id: `id-${++this.banco.seq}`, created_at: relogio.toISOString(), ...n }));
    todas.push(...gravadas);
    return this.entregar(gravadas);
  }
}

class BancoFalso {
  tabelas: Record<string, Linha[]> = {};
  seq = 0;
  from(tabela: string) { return new Consulta(this, tabela); }
  t(tabela: string): Linha[] { return (this.tabelas[tabela] ??= []); }
}

// ------------------------------------------------------------ Zendesk falso

type ComentarioZ = { id: number; author_id: number; public: boolean; body: string; created_at: string };
type TicketZ = {
  id: number; encoded_id: string; subject: string; requester_id: number; tags: string[]; external_id: string | null;
  status: string; via: { channel: string }; created_at: string; updated_at: string; comentarios: ComentarioZ[]; custom_fields: unknown[];
};
type UsuarioZ = { id: number; role: string; email: string | null; name: string; phone: string | null; external_id: string | null };

/** O ticket como a API devolve (sem a lista interna de comentários). */
function publico(t: TicketZ): Omit<TicketZ, "comentarios"> {
  const copia: Partial<TicketZ> = { ...t };
  delete copia.comentarios;
  return copia as Omit<TicketZ, "comentarios">;
}

class ZendeskFalso {
  tickets = new Map<number, TicketZ>();
  usuarios = new Map<number, UsuarioZ>();
  private seqTicket = 50000;
  private seqUsuario = 900;
  private seqComentario = 1;
  fora = false;
  escritas = 0;

  constructor() {
    this.usuarios.set(1, { id: 1, role: "admin", email: "robo@example.com", name: "Robo", phone: null, external_id: null });
  }

  private usuarioPorEmail(email: string, nome?: string): UsuarioZ {
    const achado = [...this.usuarios.values()].find((u) => u.email === email.toLowerCase());
    if (achado) return achado;
    const u = { id: ++this.seqUsuario, role: "end-user", email: email.toLowerCase(), name: nome ?? email, phone: null, external_id: null };
    this.usuarios.set(u.id, u);
    return u;
  }

  private tocar(t: TicketZ) { t.updated_at = relogio.toISOString(); }

  /** O cliente responde por e-mail no ticket (o alias +id ou o encoded id no corpo levam até aqui). */
  clienteResponde(ticketId: number, texto: string) {
    const t = this.tickets.get(ticketId)!;
    t.comentarios.push({ id: this.seqComentario++, author_id: t.requester_id, public: true, body: texto, created_at: relogio.toISOString() });
    this.tocar(t);
  }

  /** Uma conversa nova de WhatsApp, como o app do Zendesk abre. */
  whatsappDoCliente(fone: string, texto: string): number {
    const u = { id: ++this.seqUsuario, role: "end-user", email: null, name: "WhatsApp user", phone: fone, external_id: null };
    this.usuarios.set(u.id, u);
    const id = ++this.seqTicket;
    this.tickets.set(id, {
      id, encoded_id: `WA${id}-ABCDE`, subject: "Conversation with WhatsApp user", requester_id: u.id, tags: ["whatsapp"], external_id: null,
      status: "new", via: { channel: "whatsapp" }, created_at: relogio.toISOString(), updated_at: relogio.toISOString(),
      comentarios: [{ id: this.seqComentario++, author_id: u.id, public: true, body: texto, created_at: relogio.toISOString() }], custom_fields: [],
    });
    return id;
  }

  dosLeads(): TicketZ[] {
    return [...this.tickets.values()].filter((t) => t.tags.includes("site-lead"));
  }

  responder(metodo: string, caminho: string, params: URLSearchParams, corpo: any): { status: number; body: any } {
    if (this.fora) return { status: 503, body: { error: "down" } };
    if (metodo !== "GET") this.escritas++;
    let m: RegExpExecArray | null;

    if (metodo === "GET" && caminho === "search.json") {
      const q = params.get("query") ?? "";
      const tipo = /type:(\w+)/.exec(q)?.[1];
      const fone = /phone:(\S+)/.exec(q)?.[1];
      if (tipo === "user") {
        return { status: 200, body: { results: [...this.usuarios.values()].filter((u) => fone && u.phone === fone).map((u) => ({ id: u.id })) } };
      }
      const tag = /tags:(\S+)/.exec(q)?.[1];
      const via = /via:(\S+)/.exec(q)?.[1];
      const solicitante = /requester:(\S+)/.exec(q)?.[1];
      const depois = /updated>(\S+)/.exec(q)?.[1];
      const results = [...this.tickets.values()].filter((t) => {
        if (tag && !t.tags.includes(tag)) return false;
        if (via && t.via.channel !== via) return false;
        if (depois && !(Date.parse(t.updated_at) > Date.parse(depois))) return false;
        if (solicitante) {
          const u = this.usuarios.get(t.requester_id);
          if (solicitante.startsWith("+") ? u?.phone !== solicitante : u?.email !== solicitante.toLowerCase()) return false;
        }
        return true;
      });
      return { status: 200, body: { results: results.map(publico) } };
    }
    if (metodo === "GET" && caminho === "tickets.json") {
      const ext = params.get("external_id");
      return { status: 200, body: { tickets: [...this.tickets.values()].filter((t) => t.external_id === ext).map(publico) } };
    }
    if (metodo === "POST" && caminho === "tickets.json") {
      const t = corpo.ticket;
      const req = this.usuarioPorEmail(t.requester.email, t.requester.name);
      const id = ++this.seqTicket;
      const novo: TicketZ = {
        id, encoded_id: `ZR${String(id).slice(-4)}K-JX${String(id).slice(-3)}`, subject: t.subject, requester_id: req.id, tags: t.tags ?? [],
        external_id: t.external_id ?? null, status: "new", via: { channel: "api" }, created_at: relogio.toISOString(), updated_at: relogio.toISOString(),
        comentarios: [{ id: this.seqComentario++, author_id: 1, public: t.comment.public, body: t.comment.body ?? t.comment.html_body, created_at: relogio.toISOString() }],
        custom_fields: t.custom_fields ?? [],
      };
      this.tickets.set(id, novo);
      return { status: 201, body: { ticket: { id, encoded_id: novo.encoded_id } } };
    }
    if ((m = /^tickets\/(\d+)\.json$/.exec(caminho))) {
      const t = this.tickets.get(Number(m[1]));
      if (!t) return { status: 404, body: { error: "RecordNotFound" } };
      if (metodo === "GET") return { status: 200, body: { ticket: publico(t) } };
      const u = corpo.ticket;
      if (u.comment) t.comentarios.push({ id: this.seqComentario++, author_id: u.comment.author_id ?? 1, public: u.comment.public ?? true, body: u.comment.body ?? u.comment.html_body, created_at: relogio.toISOString() });
      if (u.requester_id) t.requester_id = u.requester_id;
      if (u.tags) t.tags = u.tags;
      if (u.status) t.status = u.status;
      this.tocar(t);
      return { status: 200, body: { ticket: { id: t.id } } };
    }
    if (metodo === "GET" && (m = /^tickets\/(\d+)\/comments\.json$/.exec(caminho))) {
      const t = this.tickets.get(Number(m[1]));
      if (!t) return { status: 404, body: {} };
      const autores = [...new Set(t.comentarios.map((c) => c.author_id))].map((id) => this.usuarios.get(id)).filter(Boolean);
      return { status: 200, body: { comments: [...t.comentarios].reverse(), users: autores.map((u) => ({ id: u!.id, role: u!.role })) } };
    }
    if (metodo === "POST" && caminho === "users/create_or_update.json") {
      const b = corpo.user;
      const u = this.usuarioPorEmail(b.email, b.name);
      u.name = b.name;
      u.external_id = b.external_id;
      return { status: 200, body: { user: { id: u.id } } };
    }
    if (metodo === "GET" && caminho === "users/search.json") {
      const email = (params.get("query") ?? "").replace(/^email:/, "").toLowerCase();
      return { status: 200, body: { users: [...this.usuarios.values()].filter((u) => u.email === email).map((u) => ({ id: u.id, role: u.role, email: u.email })) } };
    }
    if (metodo === "GET" && (m = /^users\/(\d+)\.json$/.exec(caminho))) {
      const u = this.usuarios.get(Number(m[1]));
      return u ? { status: 200, body: { user: u } } : { status: 404, body: {} };
    }
    if (metodo === "POST" && (m = /^users\/(\d+)\/identities\.json$/.exec(caminho))) {
      const u = this.usuarios.get(Number(m[1]))!;
      const valor = corpo.identity.value;
      if ([...this.usuarios.values()].some((x) => x.id !== u.id && x.phone === valor)) return { status: 422, body: { error: "taken" } };
      u.phone = valor;
      return { status: 201, body: { identity: { type: "phone_number", value: valor } } };
    }
    throw new Error(`Zendesk falso não conhece ${metodo} ${caminho}`);
  }
}

// ------------------------------------------------------------ Meta falsa

class MetaFalsa {
  statusDoTemplate = "APPROVED";
  qualidade = "GREEN";
  enviadas: Array<{ to: string; template: any }> = [];
  tentativas = 0;
  private seq = 0;

  responder(metodo: string, caminho: string): { status: number; body: any } {
    if (metodo === "GET" && caminho === "v21.0/999/message_templates") {
      return {
        status: 200,
        body: {
          data: [{
            name: "fixfy_booking_recovery_v1", language: "en_GB", status: this.statusDoTemplate, category: "MARKETING",
            components: [
              { type: "BODY", text: "Hi {{1}}, your {{2}} price is still saved at Fixfy, and your 10% code {{3}} is ready to use." },
              { type: "BUTTONS", buttons: [{ type: "URL", text: "Finish my booking", url: "https://www.getfixfy.com/{{1}}" }, { type: "QUICK_REPLY", text: "Stop promotions" }] },
            ],
          }],
        },
      };
    }
    if (metodo === "GET" && caminho === "v21.0/111") return { status: 200, body: { quality_rating: this.qualidade } };
    if (metodo === "POST" && caminho === "v21.0/111/messages") {
      this.tentativas++;
      if (this.statusDoTemplate !== "APPROVED") {
        return { status: 400, body: { error: { code: 132001, message: "Template name does not exist in the translation" } } };
      }
      return { status: 200, body: { messages: [{ id: `wamid.${++this.seq}` }] } };
    }
    throw new Error(`Meta falsa não conhece ${metodo} ${caminho}`);
  }
}

// ------------------------------------------------------------ cenário

let banco: BancoFalso;
let zendesk: ZendeskFalso;
let meta: MetaFalsa;
let emails: Array<MensagemDeEmail & { quando: string }>;
let chamadasFetch = 0;

function instalarFetch() {
  chamadasFetch = 0;
  globalThis.fetch = (async (url: string | URL, init: RequestInit = {}) => {
    chamadasFetch++;
    const u = new URL(String(url));
    const metodo = (init.method ?? "GET").toUpperCase();
    const corpo = init.body ? JSON.parse(String(init.body)) : null;
    let r: { status: number; body: any };
    if (u.hostname === "fixfy-teste.zendesk.com") r = zendesk.responder(metodo, u.pathname.replace(/^\/api\/v2\//, ""), u.searchParams, corpo);
    else if (u.hostname === "graph.facebook.com") r = meta.responder(metodo, u.pathname.replace(/^\//, ""));
    else throw new Error(`fetch inesperado para ${u.hostname}`);
    if (metodo === "POST" && u.hostname === "graph.facebook.com" && r.status === 200) meta.enviadas.push({ to: corpo.to, template: corpo.template });
    const texto = JSON.stringify(r.body);
    const resposta = {
      ok: r.status >= 200 && r.status < 300,
      status: r.status,
      json: async () => JSON.parse(texto),
      text: async () => texto,
      clone: () => resposta,
    };
    return resposta;
  }) as unknown as typeof fetch;
}

let seqLead = 0;
const NOMES = ["alex", "bea", "caio", "dora", "enzo", "fabi", "gil", "hugo", "iris", "rafa", "zoe", "yan"];
function novoLead(extra: Linha = {}): Linha {
  const id = `00000000-0000-4000-8000-${String(++seqLead).padStart(12, "0")}`;
  const l: Linha = {
    id,
    created_at: "2026-09-25T18:00:00.000Z",
    updated_at: "2026-09-25T18:00:00.000Z",
    email: `lead${seqLead}@example.com`,
    full_name: `${NOMES[(seqLead - 1) % NOMES.length]} tester`,
    phone: null,
    postcode: "SE12 8AA",
    client_id: null,
    selection: { services: ["clean"], size: "2", clean: { kind: "deep", extras: {} }, details: ["2 bedrooms", "Oven included"] },
    service_label: "2 bed deep clean",
    price: 237,
    resume_url: "https://www.getfixfy.com/book?s=clean&kind=deep&size=2&pc=SE12%208AA",
    source: { utm_source: "meta", utm_campaign: "eot-london" },
    step_reached: 3,
    last_activity_at: "2026-09-25T18:00:00.000Z",
    status: "hot",
    marketing_opt_out: false,
    sequence_state: "scheduled",
    channel: "website",
    tags: [],
    email1_due_at: null, email2_due_at: null, email3_due_at: null, whatsapp_due_at: null,
    email1_sent_at: null, email2_sent_at: null, email3_sent_at: null, whatsapp_sent_at: null,
    promo_code: null, promo_id: null, promo_expires_at: null,
    zendesk_ticket_id: null, replied_at: null,
    ...extra,
  };
  banco.t("site_leads").push(l);
  return l;
}

const lead = (id: string) => banco.t("site_leads").find((l) => l.id === id)!;
const toquesDe = (l: Linha) => [
  ...emails.filter((e) => e.to[0] === l.email).map((e) => e.quando),
  ...banco.t("marketing_touches").filter((t) => t.channel === "whatsapp" && t.email === l.email && t.provider_id).map((t) => t.sent_at),
].sort();

async function umaVolta(dryRun = false): Promise<ResultadoDoMotor> {
  const [log, err, warn] = [console.log, console.error, console.warn];
  console.log = console.error = console.warn = () => undefined;
  try {
    return await rodarMotor({
      dryRun,
      agora: relogio,
      sb: banco as any,
      estaBloqueado: async () => false,
      enviarEmail: async (m) => {
        emails.push({ ...m, quando: relogio.toISOString() });
        return { id: `re_${emails.length}` };
      },
    });
  } finally {
    [console.log, console.error, console.warn] = [log, err, warn];
  }
}

/** Anda o relógio de 10 em 10 minutos até `ate`, rodando o motor a cada volta. */
async function rodarAte(ate: string, pular?: (d: Date) => boolean): Promise<ResultadoDoMotor[]> {
  const voltas: ResultadoDoMotor[] = [];
  while (relogio.getTime() <= Date.parse(ate)) {
    if (!pular?.(relogio)) voltas.push(await umaVolta());
    relogio = new Date(relogio.getTime() + 10 * MIN);
  }
  return voltas;
}

beforeEach(() => {
  seqLead = 0;
  banco = new BancoFalso();
  zendesk = new ZendeskFalso();
  meta = new MetaFalsa();
  emails = [];
  relogio = new Date("2026-09-28T06:00:00Z"); // segunda, 07:00 em Londres
  instalarFetch();
});

describe("reserva abandonada, de ponta a ponta", () => {
  it("o backlog de 25/09: três leads vencidos recebem UM toque por vez, e o resto recomeça do envio real", async () => {
    const legado = { email1_due_at: "2026-09-25T18:30:00.000Z", email2_due_at: "2026-09-25T22:30:00.000Z", email3_due_at: "2026-09-26T09:00:00.000Z" };
    const a = novoLead({ ...legado, phone: "07123456781" });
    const b = novoLead({ ...legado, phone: "+447123456782", selection: { services: ["clean"], size: "3", clean: { kind: "eot" } }, service_label: "3 bed end of tenancy clean" });
    const c = novoLead({ ...legado, phone: null, status: "new", step_reached: 2 });

    const voltas = await rodarAte("2026-10-01T21:00:00Z");
    assert.deepEqual(voltas.flatMap((v) => v.erros), []);

    // Às 07:00 UTC (08:00 em Londres) sai o E1 dos três, e nada antes disso.
    const e1 = emails.filter((e) => e.subject === "You're almost there!");
    assert.equal(e1.length, 3);
    assert.ok(e1.every((e) => e.quando === "2026-09-28T07:00:00.000Z"));
    assert.equal(emails.length, 9);

    for (const l of [a, b, c]) {
      const toques = toquesDe(l);
      const esperado = ["2026-09-28T07:00:00.000Z", "2026-09-29T08:30:00.000Z", "2026-09-30T08:30:00.000Z"];
      if (l.phone) esperado.push("2026-09-30T14:00:00.000Z"); // 15:00 em Londres
      assert.deepEqual(toques, esperado, `toques do lead ${l.email}`);
      assert.equal(lead(l.id).sequence_state, "done");
    }

    // WhatsApp: template certo, corpo e botão certos; o lead sem telefone fechou no E3.
    assert.equal(meta.enviadas.length, 2);
    const paraA = meta.enviadas.find((m) => m.to === "447123456781")!;
    assert.equal(paraA.template.name, "fixfy_booking_recovery_v1");
    assert.deepEqual(paraA.template.components[0].parameters.map((p: any) => p.text), ["Alex", "2 bed deep clean", "COMEBACK10"]);
    assert.deepEqual(paraA.template.components[1], {
      type: "button", sub_type: "url", index: "0",
      parameters: [{ type: "text", text: "?s=clean&kind=deep&size=2&promo=COMEBACK10&utm_source=whatsapp&utm_medium=recovery&utm_campaign=reserva_abandonada" }],
    });
    const paraB = meta.enviadas.find((m) => m.to === "447123456782")!;
    assert.equal(paraB.template.components[1].parameters[0].text, "?s=clean&size=3&promo=COMEBACK10&utm_source=whatsapp&utm_medium=recovery&utm_campaign=reserva_abandonada");

    const toquesWa = banco.t("marketing_touches").filter((t) => t.channel === "whatsapp");
    assert.equal(toquesWa.length, 2);
    assert.ok(toquesWa.every((t) => t.campaign === "reserva-abandonada:whatsapp4" && t.segment === "b2c" && /^wamid\./.test(t.provider_id)));
    assert.equal(banco.t("marketing_touches").filter((t) => t.channel === "email").length, 9);

    // Um ticket por lead, no molde do OS, e cada toque virou nota interna.
    const tickets = zendesk.dosLeads();
    assert.equal(tickets.length, 3);
    for (const l of [a, b, c]) {
      const t = tickets.find((x) => x.external_id === `site-lead:${l.id}`)!;
      assert.equal(lead(l.id).zendesk_ticket_id, t.id);
      assert.deepEqual(t.tags, ["os-created", "site-lead", "reserva-abandonada"]);
      assert.equal(t.subject, `Website booking not finished · ${l.service_label} · SE12`);
      assert.equal(zendesk.usuarios.get(t.requester_id)?.email, l.email);
      assert.ok(t.comentarios.every((x) => x.public === false), "nada público no ticket do lead");
      const notas = t.comentarios.map((x) => x.body).join("\n");
      assert.match(notas, /Email 1 sent: "You're almost there!"/);
      assert.match(notas, /Email 2 sent: "Anything we can help with\?"/);
      assert.match(notas, /Email 3 sent: "Get 10% OFF to finish your booking" with code COMEBACK10/);
      if (l.phone) assert.match(notas, /WhatsApp sent \(template fixfy_booking_recovery_v1, code COMEBACK10\)/);
      if (l.phone) assert.equal(zendesk.usuarios.get(t.requester_id)?.phone, `+${l.phone.replace(/\D/g, "").replace(/^0/, "44")}`);

      // A resposta volta para o ticket: reply-to é o alias dele, e o encoded id vai escondido no corpo.
      for (const e of emails.filter((x) => x.to[0] === l.email)) {
        assert.equal(e.replyTo, `support+id${t.encoded_id}@fixfy-teste.zendesk.com`);
        assert.ok(e.html.includes(`[${t.encoded_id}]`) && e.text.includes(`[${t.encoded_id}]`));
      }
    }
    // Antes das 8h de Londres, esperou sem mandar.
    assert.ok(voltas[0].esperando.some((x) => /outside 08:00 to 21:00/.test(x.motivo)));
  });

  it("o cliente respondeu o e-mail: para, vira 'em contato', e nada mais sai", async () => {
    const d = novoLead({ email1_due_at: "2026-09-28T06:30:00.000Z", last_activity_at: "2026-09-28T06:00:00.000Z" });
    await rodarAte("2026-09-28T07:00:00Z");
    assert.equal(emails.length, 1);
    const ticket = zendesk.dosLeads()[0];

    relogio = new Date("2026-09-28T11:55:00Z");
    zendesk.clienteResponde(ticket.id, "Hi, can you do Friday instead?");
    const notasAntes = ticket.comentarios.length;
    relogio = new Date("2026-09-28T12:00:00Z");
    await rodarAte("2026-10-01T20:00:00Z");

    assert.equal(emails.length, 1, "nenhum e-mail depois da resposta");
    const l = lead(d.id);
    assert.equal(l.status, "contacted");
    assert.equal(l.sequence_state, "stopped");
    assert.equal(l.replied_at, "2026-09-28T11:55:00.000Z");
    assert.equal(ticket.comentarios.length, notasAntes, "o motor não escreve por cima da resposta do cliente");
    assert.ok(banco.t("site_lead_activity").some((x) => x.lead_id === d.id && x.kind === "reply"));
    assert.equal(banco.t("marketing_touches").find((t) => t.email === d.email)?.replied_at, "2026-09-28T11:55:00.000Z");
  });

  it("chamou no WhatsApp com o n8n fora: a checagem antes do E2 acha a conversa e para", async () => {
    const e = novoLead({ phone: "07123456785", email1_due_at: "2026-09-28T06:30:00.000Z", last_activity_at: "2026-09-28T06:00:00.000Z" });
    await rodarAte("2026-09-28T07:00:00Z");
    assert.equal(emails.length, 1);

    // 20:00 UTC o cliente manda WhatsApp; o n8n fica parado a noite toda (a varredura de 1 hora não vê).
    relogio = new Date("2026-09-28T20:00:00Z");
    const conversa = zendesk.whatsappDoCliente("+447123456785", "Hi, is Saturday possible?");
    relogio = new Date("2026-09-29T08:00:00Z");
    await rodarAte("2026-09-30T20:00:00Z");

    assert.equal(emails.length, 1, "o E2 não sai");
    assert.equal(meta.enviadas.length, 0);
    const l = lead(e.id);
    assert.equal(l.status, "contacted");
    assert.equal(l.replied_at, "2026-09-28T20:00:00.000Z");
    const doLead = zendesk.dosLeads()[0];
    assert.match(doLead.comentarios.at(-1)!.body, new RegExp(`The customer wrote in ticket #${conversa}`));
  });

  it("template ainda não aprovado: espera sem erro e sem tocar a Meta; aprovado, sai", async () => {
    const f = novoLead({ phone: "07123456786", email1_due_at: "2026-09-28T06:30:00.000Z", last_activity_at: "2026-09-28T06:00:00.000Z" });
    meta.statusDoTemplate = "PENDING";
    const voltas = await rodarAte("2026-09-30T16:00:00Z");
    assert.equal(emails.length, 3);
    assert.equal(meta.tentativas, 0, "com a WABA legível o motor nem tenta mandar");
    assert.deepEqual(voltas.flatMap((v) => v.erros), []);
    const comAviso = voltas.filter((v) => v.avisos.some((a) => /template fixfy_booking_recovery_v1 is PENDING/.test(a)));
    assert.ok(comAviso.length > 0 && comAviso.every((v) => v.avisos.length === 1), "um aviso por volta, não um por lead");
    assert.equal(banco.t("marketing_touches").filter((t) => t.channel === "whatsapp").length, 0);
    assert.equal(lead(f.id).whatsapp_sent_at, null);
    assert.equal(lead(f.id).sequence_state, "scheduled");

    meta.statusDoTemplate = "APPROVED";
    await rodarAte("2026-09-30T16:20:00Z");
    assert.equal(meta.enviadas.length, 1);
    assert.equal(lead(f.id).sequence_state, "done");
  });

  it("sem WABA para conferir, a recusa 132001 da Meta devolve a reserva e tenta de novo depois", async () => {
    const waba = process.env.WHATSAPP_WABA_ID;
    delete process.env.WHATSAPP_WABA_ID;
    try {
      const g = novoLead({
        phone: "07123456787", email1_sent_at: "2026-09-28T07:00:00.000Z", email2_sent_at: "2026-09-29T08:30:00.000Z", email3_sent_at: "2026-09-30T08:30:00.000Z",
        whatsapp_due_at: "2026-09-30T14:00:00.000Z", promo_code: "COMEBACK10", email1_due_at: "2026-09-28T07:00:00.000Z",
        email2_due_at: "2026-09-29T08:30:00.000Z", email3_due_at: "2026-09-30T08:30:00.000Z",
      });
      meta.statusDoTemplate = "PENDING";
      relogio = new Date("2026-09-30T14:00:00Z");
      const voltas = await rodarAte("2026-09-30T14:30:00Z");
      assert.equal(meta.tentativas, 4);
      assert.deepEqual(voltas.flatMap((v) => v.erros), []);
      assert.ok(voltas.every((v) => v.avisos.length === 1 && /132001/.test(v.avisos[0])));
      assert.equal(banco.t("marketing_touches").length, 0, "o lugar foi devolvido");
      assert.equal(lead(g.id).whatsapp_sent_at, null);

      meta.statusDoTemplate = "APPROVED";
      await rodarAte("2026-09-30T14:40:00Z");
      assert.equal(meta.enviadas.length, 1);
    } finally {
      process.env.WHATSAPP_WABA_ID = waba;
    }
  });

  it("número que já recebeu a retomada não recebe de novo (índice único): fecha sem WhatsApp", async () => {
    banco.t("marketing_touches").push({ id: "velho", channel: "whatsapp", campaign: "reserva-abandonada:whatsapp4", phone: "447123456788", sent_at: "2026-08-01T14:00:00.000Z" });
    const h = novoLead({
      phone: "07123456788", email1_sent_at: "2026-09-28T07:00:00.000Z", email2_sent_at: "2026-09-29T08:30:00.000Z", email3_sent_at: "2026-09-30T08:30:00.000Z",
      whatsapp_due_at: "2026-09-30T14:00:00.000Z", promo_code: "COMEBACK10",
    });
    relogio = new Date("2026-09-30T14:00:00Z");
    const [volta] = await rodarAte("2026-09-30T14:00:00Z");
    assert.equal(meta.enviadas.length, 0);
    assert.equal(volta.pulados[0]?.motivo, "number already got the recovery WhatsApp");
    assert.equal(lead(h.id).sequence_state, "done");
  });

  it("resposta ao WhatsApp depois do último toque: a varredura põe o lead 'em contato'", async () => {
    const w = novoLead({
      phone: "07123456784", sequence_state: "done", email1_sent_at: "2026-09-28T07:00:00.000Z", email2_sent_at: "2026-09-29T08:30:00.000Z",
      email3_sent_at: "2026-09-30T08:30:00.000Z", whatsapp_sent_at: "2026-09-30T14:00:00.000Z", promo_code: "COMEBACK10",
    });
    relogio = new Date("2026-09-30T14:25:00Z");
    zendesk.whatsappDoCliente("+447123456784", "Yes please, can I book for Saturday?");
    relogio = new Date("2026-09-30T14:30:00Z");
    const [volta] = await rodarAte("2026-09-30T14:30:00Z");
    assert.deepEqual(volta.respostas.map((r) => r.tipo), ["cliente"]);
    assert.equal(lead(w.id).status, "contacted");
    assert.equal(lead(w.id).replied_at, "2026-09-30T14:25:00.000Z");
  });

  it("ensaio: calcula tudo e não grava nem manda nada", async () => {
    novoLead({ email1_due_at: "2026-09-28T06:30:00.000Z", last_activity_at: "2026-09-28T06:00:00.000Z" });
    relogio = new Date("2026-09-28T09:00:00Z");
    const antes = JSON.stringify(banco.tabelas);
    const r = await umaVolta(true);
    assert.equal(r.ensaio, true);
    assert.equal(r.enviados.length, 1);
    assert.equal(JSON.stringify(banco.tabelas), antes);
    assert.equal(emails.length, 0);
    assert.equal(zendesk.escritas, 0);
  });

  it("motor desligado: o n8n chama, nada sai e ninguém de fora é consultado", async () => {
    novoLead({ phone: "07123456780", email1_due_at: "2026-09-28T06:30:00.000Z", last_activity_at: "2026-09-28T06:00:00.000Z" });
    process.env.RESERVA_ABANDONADA = "off";
    try {
      relogio = new Date("2026-09-28T09:00:00Z");
      const antes = JSON.stringify(banco.tabelas);
      const r = await rodarMotor({ dryRun: false, agora: relogio, sb: banco as any, estaBloqueado: async () => false, enviarEmail: async () => ({ id: null }) });
      assert.equal(r.ensaio, true);
      assert.deepEqual(r.enviados, [{ lead: banco.t("site_leads")[0].id, passo: 1 }]);
      assert.equal(chamadasFetch, 0);
      assert.equal(JSON.stringify(banco.tabelas), antes);
    } finally {
      process.env.RESERVA_ABANDONADA = "on";
    }
  });

  it("a trava de 12 horas vence o horário gravado errado, e reagenda", async () => {
    const i = novoLead({ email1_sent_at: "2026-09-28T07:00:00.000Z", email1_due_at: "2026-09-28T07:00:00.000Z", email2_due_at: "2026-09-28T09:00:00.000Z" });
    relogio = new Date("2026-09-28T09:00:00Z");
    const [volta] = await rodarAte("2026-09-28T09:00:00Z");
    assert.equal(emails.length, 0);
    assert.match(volta.esperando[0].motivo, /too soon after the previous touch/);
    assert.equal(lead(i.id).email2_due_at, "2026-09-29T08:30:00.000Z");
  });

  it("Zendesk fora: não manda sem saber se o cliente respondeu", async () => {
    novoLead({ email1_due_at: "2026-09-28T06:30:00.000Z", last_activity_at: "2026-09-28T06:00:00.000Z" });
    zendesk.fora = true;
    relogio = new Date("2026-09-28T09:00:00Z");
    const [volta] = await rodarAte("2026-09-28T09:00:00Z");
    assert.equal(emails.length, 0);
    assert.match(volta.esperando[0].motivo, /Zendesk check failed/);
    assert.ok(volta.avisos.some((a) => /Zendesk sweep failed/.test(a)));
  });

  it("modo rápido do teste do dono: a sequência inteira em quatro voltas, mesmo de noite", async () => {
    const agora = "2026-09-28T22:00:00.000Z"; // 23:00 em Londres
    const r = novoLead({
      tags: ["teste-rapido"], phone: "07123456789", last_activity_at: agora,
      email1_due_at: agora, email2_due_at: agora, email3_due_at: agora, whatsapp_due_at: agora,
    });
    relogio = new Date(agora);
    await rodarAte("2026-09-28T22:30:00Z");
    assert.equal(emails.length, 3);
    assert.equal(meta.enviadas.length, 1);
    assert.deepEqual(toquesDe(r), ["2026-09-28T22:00:00.000Z", "2026-09-28T22:10:00.000Z", "2026-09-28T22:20:00.000Z", "2026-09-28T22:30:00.000Z"]);
    assert.equal(lead(r.id).sequence_state, "done");
  });
});
