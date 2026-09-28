/**
 * A última conferência antes de cada mensagem da campanha sair (28/09/2026).
 *
 * A fila foi montada uma vez; de lá para cá a pessoa pode ter comprado,
 * respondido ou pedido para sair. A regra do dono cabe numa frase: se ela
 * comprou, não sai nada.
 *
 *   endereço bloqueado  o e-mail (ou o número) DESTA linha está na lista de
 *                       bloqueio, por qualquer motivo e desde quando for
 *   saiu da lista       recusa que apareceu desde o início da campanha em
 *                       qualquer contato dela (unsubscribe, spam, Stop no
 *                       WhatsApp), tag `no-marketing`, lead do site que pediu
 *                       para sair. Bloqueio ANTERIOR à campanha no outro canal
 *                       não conta: esse já tirou só aquele canal quando a fila
 *                       foi montada e a pessoa ficou no outro (decisão do dono)
 *   comprou             lead do site `won` ou job criado para ela desde o
 *                       início da campanha, pelo cliente, pelo e-mail ou pelo
 *                       telefone (a mesma pessoa às vezes tem dois cadastros)
 *   respondeu           só no follow-up de WhatsApp: toque da campanha com
 *                       `replied_at`, ou ticket no Zendesk aberto pelo e-mail
 *                       dela depois que o e-mail da campanha saiu
 *
 * Quem cai numa delas vira `pulado`, com o motivo em `erro`. A regra é a
 * função pura `motivoDoPulo`; o resto deste arquivo só junta os fatos.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { toWhatsAppNumber } from "@/lib/whatsapp/cloud";
import { bloqueiosComData, normalizarEmail } from "./suppressions";
import { ticketsDesde, zendeskPronto } from "./zendesk-busca";
import { WEEK10 } from "./week10-copy";

export const MOTIVOS = {
  bloqueado: "endereço bloqueado",
  saiu: "saiu da lista",
  comprou: "comprou desde o início da campanha",
  respondeu: "respondeu ao e-mail",
  respondeuNoZendesk: "respondeu ao e-mail (ticket no Zendesk)",
} as const;

/** Recusa de promoção. Endereço morto (bounced, invalid) não é recusa: só fecha aquele canal. */
const RECUSA_EMAIL = new Set(["unsubscribed", "complained", "manual"]);
const RECUSA_FONE = new Set(["stopped", "blocked", "manual"]);

export type Chaves = { clientes: Set<string>; emails: Set<string>; fones: Set<string> };
export const chavesVazias = (): Chaves => ({ clientes: new Set(), emails: new Set(), fones: new Set() });

export type Bloqueio = { motivo: string; desde: number };

export type FatosDaTriagem = {
  /** Início da campanha, em ms. */
  inicio: number;
  bloqueioEmail: Map<string, Bloqueio>;
  bloqueioFone: Map<string, Bloqueio>;
  /** Clientes com a tag `no-marketing`. */
  semMarketing: Set<string>;
  optOutSite: Chaves;
  comprou: Chaves;
  respondeu: Chaves;
  /** E-mail → criação do ticket mais novo aberto por ele no Zendesk, em ms. */
  ultimoTicketPorEmail: Map<string, number>;
};

export type Pessoa = {
  passo: string;
  canal: "email" | "whatsapp";
  clientId: string | null;
  /** O e-mail (linha de e-mail) ou o número (linha de WhatsApp) para onde ESTA mensagem vai. */
  endereco: string | null;
  /** Tudo que se sabe dela, o endereço incluído. */
  emails: string[];
  fones: string[];
  /** Quando o e-mail da campanha saiu para ela (o follow-up se mede por ele), em ms. */
  emailSaiuEm: number | null;
};

export type LinhaReservada = { id: string; client_id: string | null; grupo: string; passo: string; email: string | null; phone: string | null };

function unicos(xs: Array<string | null | undefined>): string[] {
  return [...new Set(xs.filter((x): x is string => !!x))];
}

const bate = (c: Chaves, p: Pessoa) =>
  (p.clientId != null && c.clientes.has(p.clientId)) || p.emails.some((e) => c.emails.has(e)) || p.fones.some((t) => c.fones.has(t));

/** A pessoa por trás de uma linha: o contato da linha mais o que o cadastro e o e-mail da campanha sabem dela. */
export function pessoaDaLinha(
  l: LinhaReservada,
  cliente?: { email: string | null; phone: string | null } | null,
  emailDaCampanha?: { email: string | null; enviado_em: string | null } | null,
): Pessoa {
  const canal = l.passo.startsWith("wa_") ? "whatsapp" : "email";
  return {
    passo: l.passo,
    canal,
    clientId: l.client_id,
    endereco: canal === "email" ? normalizarEmail(l.email) : toWhatsAppNumber(l.phone),
    emails: unicos([l.email, cliente?.email, emailDaCampanha?.email].map((e) => normalizarEmail(e))),
    fones: unicos([l.phone, cliente?.phone].map((t) => toWhatsAppNumber(t))),
    emailSaiuEm: emailDaCampanha?.enviado_em ? Date.parse(emailDaCampanha.enviado_em) : null,
  };
}

/** Por que esta mensagem não deve sair, ou null se pode sair. */
export function motivoDoPulo(p: Pessoa, f: FatosDaTriagem): string | null {
  const doCanal = p.canal === "email" ? f.bloqueioEmail : f.bloqueioFone;
  if (p.endereco && doCanal.has(p.endereco)) return MOTIVOS.bloqueado;

  const recusouAgora = (b: Bloqueio | undefined, recusa: Set<string>) => !!b && recusa.has(b.motivo) && b.desde >= f.inicio;
  if (
    p.emails.some((e) => recusouAgora(f.bloqueioEmail.get(e), RECUSA_EMAIL)) ||
    p.fones.some((t) => recusouAgora(f.bloqueioFone.get(t), RECUSA_FONE)) ||
    (p.clientId != null && f.semMarketing.has(p.clientId)) ||
    bate(f.optOutSite, p)
  ) {
    return MOTIVOS.saiu;
  }

  if (bate(f.comprou, p)) return MOTIVOS.comprou;

  if (p.passo === "wa_followup") {
    if (bate(f.respondeu, p)) return MOTIVOS.respondeu;
    const saiu = p.emailSaiuEm;
    if (saiu != null && p.emails.some((e) => (f.ultimoTicketPorEmail.get(e) ?? -Infinity) > saiu)) return MOTIVOS.respondeuNoZendesk;
  }
  return null;
}

/* ═══════════════════ Os fatos, do banco e do Zendesk ═══════════════════ */

type Resposta<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function paginar<T>(consulta: (de: number, ate: number) => Resposta<T>): Promise<T[]> {
  const todos: T[] = [];
  for (let de = 0; ; de += 1000) {
    const { data, error } = await consulta(de, de + 999);
    if (error) throw new Error(error.message);
    todos.push(...(data ?? []));
    if ((data ?? []).length < 1000) return todos;
  }
}

/** `in(...)` em lotes: a lista vai na URL do PostgREST, e URL longa demais volta "URI too long". */
async function porLotes<T>(valores: string[], tamanho: number, consulta: (lote: string[]) => Resposta<T>): Promise<T[]> {
  const todos: T[] = [];
  for (let i = 0; i < valores.length; i += tamanho) {
    const { data, error } = await consulta(valores.slice(i, i + tamanho));
    if (error) throw new Error(error.message);
    todos.push(...(data ?? []));
  }
  return todos;
}

function somar(c: Chaves, clientId: string | null | undefined, email: string | null | undefined, phone: string | null | undefined) {
  if (clientId) c.clientes.add(clientId);
  const e = normalizarEmail(email);
  if (e) c.emails.add(e);
  const t = toWhatsAppNumber(phone);
  if (t) c.fones.add(t);
}

/**
 * Junta o que a triagem precisa saber sobre estas pessoas. Só leitura. O
 * Zendesk só entra quando pedido e quando há follow-up com e-mail já saído:
 * uma busca por período (desde o e-mail mais velho da leva), não uma por pessoa.
 */
export async function juntarFatos(
  pessoas: Pessoa[],
  opcoes: { semMarketing?: Set<string>; zendesk?: boolean; campanha?: string; agora?: Date } = {},
): Promise<FatosDaTriagem> {
  const sb = createServiceClient();
  const campanha = opcoes.campanha ?? WEEK10.campanha;
  const inicioIso = WEEK10.inicio;
  const emails = unicos(pessoas.flatMap((p) => p.emails));
  const fones = unicos(pessoas.flatMap((p) => p.fones));

  type Lead = { email: string | null; phone: string | null; client_id: string | null; status: string; won_at: string | null; marketing_opt_out: boolean | null };
  type Toque = { client_id: string | null; email: string | null; phone: string | null };

  const [bloqEmail, bloqFone, leads, jobs, respostas] = await Promise.all([
    bloqueiosComData(emails),
    porLotes<{ phone: string; reason: string; created_at: string }>(fones, 100, (lote) =>
      sb.from("whatsapp_suppressions").select("phone, reason, created_at").in("phone", lote),
    ),
    // Todo lead do site mexido desde o início: quem pagou e quem pediu para sair.
    paginar<Lead>((de, ate) =>
      sb
        .from("site_leads")
        .select("email, phone, client_id, status, won_at, marketing_opt_out")
        .gte("updated_at", inicioIso)
        .order("updated_at", { ascending: true })
        .range(de, ate),
    ),
    // Todo job criado desde o início (o contato do cliente vem logo abaixo, para pegar o cadastro duplicado).
    paginar<{ client_id: string | null }>((de, ate) =>
      sb
        .from("jobs")
        .select("client_id")
        .gte("created_at", inicioIso)
        .is("deleted_at", null)
        .order("created_at", { ascending: true })
        .range(de, ate),
    ),
    paginar<Toque>((de, ate) =>
      sb
        .from("marketing_touches")
        .select("client_id, email, phone")
        .like("campaign", `${campanha}:%`)
        .not("replied_at", "is", null)
        .order("sent_at", { ascending: true })
        .range(de, ate),
    ),
  ]);

  const inicio = Date.parse(inicioIso);
  const bloqueioEmail = new Map<string, Bloqueio>();
  for (const [e, b] of bloqEmail) bloqueioEmail.set(e, { motivo: b.motivo, desde: Date.parse(b.desde) });
  const bloqueioFone = new Map<string, Bloqueio>();
  for (const b of bloqFone) bloqueioFone.set(b.phone, { motivo: b.reason, desde: Date.parse(b.created_at) });

  const optOutSite = chavesVazias();
  const comprou = chavesVazias();
  const respondeu = chavesVazias();
  for (const l of leads) {
    if (l.status === "won" && l.won_at && Date.parse(l.won_at) >= inicio) somar(comprou, l.client_id, l.email, l.phone);
    if (l.marketing_opt_out || l.status === "unsubscribed") somar(optOutSite, l.client_id, l.email, l.phone);
  }
  const quemReservou = unicos(jobs.map((j) => j.client_id));
  for (const id of quemReservou) comprou.clientes.add(id);
  const contatos = await porLotes<{ id: string; email: string | null; phone: string | null }>(quemReservou, 100, (lote) =>
    sb.from("clients").select("id, email, phone").in("id", lote),
  );
  for (const c of contatos) somar(comprou, c.id, c.email, c.phone);
  for (const t of respostas) somar(respondeu, t.client_id, t.email, t.phone);

  const ultimoTicketPorEmail = new Map<string, number>();
  const saidas = pessoas.filter((p) => p.passo === "wa_followup" && p.emailSaiuEm != null).map((p) => p.emailSaiuEm as number);
  if (opcoes.zendesk && saidas.length && zendeskPronto()) {
    for (const t of await ticketsDesde(new Date(Math.min(...saidas)), { agora: opcoes.agora })) {
      if (!t.email) continue;
      const criado = Date.parse(t.criadoEm);
      if (criado > (ultimoTicketPorEmail.get(t.email) ?? -Infinity)) ultimoTicketPorEmail.set(t.email, criado);
    }
  }

  return { inicio, bloqueioEmail, bloqueioFone, semMarketing: opcoes.semMarketing ?? new Set(), optOutSite, comprou, respondeu, ultimoTicketPorEmail };
}

/**
 * As linhas reservadas que NÃO devem sair, com o motivo (id → motivo).
 * Lança se não conseguir ler: quem chama devolve a leva para a fila em vez
 * de mandar sem conferir.
 */
export async function triar(linhas: LinhaReservada[], opcoes: { zendesk: boolean; campanha?: string }): Promise<Map<string, string>> {
  const pular = new Map<string, string>();
  if (!linhas.length) return pular;
  const sb = createServiceClient();
  const campanha = opcoes.campanha ?? WEEK10.campanha;

  const ids = unicos(linhas.map((l) => l.client_id));
  const clientes = await porLotes<{ id: string; email: string | null; phone: string | null; tags: string[] | null }>(ids, 100, (lote) =>
    sb.from("clients").select("id, email, phone, tags").in("id", lote),
  );
  const doCliente = new Map(clientes.map((c) => [c.id, c]));

  // O follow-up não carrega o e-mail: ele está na linha do e-mail da mesma pessoa, com a hora em que saiu.
  const idsDoFollowup = unicos(linhas.filter((l) => l.passo === "wa_followup").map((l) => l.client_id));
  const emailsDaCampanha = await porLotes<{ client_id: string; email: string | null; enviado_em: string | null }>(idsDoFollowup, 100, (lote) =>
    sb.from("marketing_queue").select("client_id, email, enviado_em").eq("campanha", campanha).eq("passo", "email_quente").in("client_id", lote),
  );
  const doEmail = new Map(emailsDaCampanha.map((q) => [q.client_id, q]));

  const pessoas = linhas.map((l) =>
    pessoaDaLinha(l, l.client_id ? doCliente.get(l.client_id) : null, l.passo === "wa_followup" && l.client_id ? doEmail.get(l.client_id) : null),
  );
  const semMarketing = new Set(clientes.filter((c) => Array.isArray(c.tags) && c.tags.includes("no-marketing")).map((c) => c.id));
  const fatos = await juntarFatos(pessoas, { semMarketing, zendesk: opcoes.zendesk, campanha });

  linhas.forEach((l, i) => {
    const motivo = motivoDoPulo(pessoas[i], fatos);
    if (motivo) pular.set(l.id, motivo);
  });
  return pular;
}
