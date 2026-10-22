/**
 * A macro "Get partner quotes" (plano do dono, 22/10/2026, etapa D).
 *
 * Num ticket B2B só com gente, a equipe aplica a macro: ela põe a tag
 * `b2b_cotar` e uma nota interna. O ciclo do Harvey (scripts/harvey/poll.ts)
 * acha os tickets abertos com `b2b_cotar` e sem `b2b_cotado` e, em cada um, roda
 * o preparo de sempre e os convites aos parceiros (quoter.ts
 * `cotarComParceirosB2B`). Só neste ticket: nada mais na conta acorda.
 *
 * Uma vez só, com duas travas, nesta ordem:
 *   1. reservarEnvio `b2b-cotar:<ticketId>` (unique no banco; duas rodadas ao
 *      mesmo tempo, só uma passa);
 *   2. tag `b2b_cotado` ANTES de convidar (é ela que tira o ticket da busca).
 * Falhou depois de carimbar: a reserva vai a failed, o ticket vai para Action
 * Required, e ninguém tenta de novo sozinho (convites podem ter saído pela
 * metade; gente decide).
 *
 * Só conta v2 (regras.v2 === true). Fora disso a tag é ignorada e nada é escrito.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { TAG_B2B_COTADO, TAG_B2B_COTAR } from "./b2b-humano";
import type { RegrasDoProcesso } from "./conta";

export const BUSCA_B2B_COTAR = `type:ticket status<solved tags:${TAG_B2B_COTAR} -tags:${TAG_B2B_COTADO}`;
export const MAX_B2B_COTAR_POR_CICLO = 3;

export const chaveDoB2bCotar = (ticketId: number) => `b2b-cotar:${ticketId}`;

export type TicketDaMacro = { id: number; tags: string[]; requesterEmail: string | null; subject: string };

/** O ticket pede a macro e ainda não foi atendido? */
export function pedeCotacaoPelaMacro(tags: readonly string[]): boolean {
  return tags.includes(TAG_B2B_COTAR) && !tags.includes(TAG_B2B_COTADO) && !tags.includes("harvey_off");
}

export type DependenciasDoB2bCotar = {
  buscar: () => Promise<TicketDaMacro[]>;
  /** As regras da conta do ticket (pelo domínio de quem escreveu). null = não reconhecida. */
  regrasDoTicket: (t: TicketDaMacro) => Promise<{ contaId: string; regras: RegrasDoProcesso | null } | null>;
  reservar: (chave: string, ticketId: number) => Promise<{ reservado: boolean; motivo?: string }>;
  confirmar: (chave: string) => Promise<void>;
  falhou: (chave: string, erro: unknown) => Promise<void>;
  carimbar: (ticketId: number, tag: string) => Promise<void>;
  cotar: (ticketId: number) => Promise<{ enviados: number; quoteRef: string | null }>;
  precisaDeAcao: (ticketId: number, proximaAcao: string) => Promise<unknown>;
};

export type ResultadoDoB2bCotar = { olhados: number; cotados: string[]; pulados: string[] };

export async function varrerB2bCotar(d: DependenciasDoB2bCotar, opcoes: { max?: number } = {}): Promise<ResultadoDoB2bCotar> {
  const max = opcoes.max ?? MAX_B2B_COTAR_POR_CICLO;
  const out: ResultadoDoB2bCotar = { olhados: 0, cotados: [], pulados: [] };
  for (const t of await d.buscar()) {
    if (out.cotados.length >= max) { out.pulados.push(`#${t.id}: cycle limit, next cycle`); continue; }
    if (!pedeCotacaoPelaMacro(t.tags)) continue;
    out.olhados++;
    const conta = await d.regrasDoTicket(t).catch(() => null);
    if (!conta) { out.pulados.push(`#${t.id}: organization not recognised`); continue; }
    if (conta.regras?.v2 !== true) { out.pulados.push(`#${t.id}: account not on the v2 process, macro ignored`); continue; }

    const chave = chaveDoB2bCotar(t.id);
    const r = await d.reservar(chave, t.id);
    if (!r.reservado) { out.pulados.push(`#${t.id}: ${r.motivo ?? "already handled"}`); continue; }
    try {
      await d.carimbar(t.id, TAG_B2B_COTADO);
    } catch (e) {
      // Sem a trava no ticket não convida: libera a reserva e tenta no próximo ciclo.
      await d.falhou(chave, e).catch(() => undefined);
      out.pulados.push(`#${t.id}: could not tag ${TAG_B2B_COTADO}, next cycle`);
      continue;
    }
    try {
      const c = await d.cotar(t.id);
      await d.confirmar(chave);
      out.cotados.push(`#${t.id}: ${c.quoteRef ?? "no quote"}, ${c.enviados} partner(s) invited`);
    } catch (e) {
      await d.falhou(chave, e).catch(() => undefined);
      await d.precisaDeAcao(t.id, `Get partner quotes failed: ${e instanceof Error ? e.message.slice(0, 120) : "error"}. Invite partners from the Quotes screen`).catch(() => undefined);
      out.pulados.push(`#${t.id}: failed (${e instanceof Error ? e.message.slice(0, 120) : "error"}), sent to Action Required`);
    }
  }
  return out;
}

/** As dependências de verdade (Zendesk + Supabase). Import dinâmico: o poll.ts carrega o env antes. */
export async function dependenciasReais(sb: SupabaseClient): Promise<DependenciasDoB2bCotar> {
  const { zendeskApi, addTicketTags } = await import("@/lib/zendesk");
  const { organizacaoDoTicket } = await import("@/lib/organizacoes/do-ticket");
  const { processoDaConta } = await import("./conta");
  const { reservarEnvio, confirmarEnvio, falhouEnvio } = await import("@/lib/idempotencia/envio");
  const { cotarComParceirosB2B } = await import("@/lib/zendesk-quoter/quoter");
  const { precisaDeAcao } = await import("@/lib/fila-de-acao");
  type Achado = { id: number; subject?: string; tags?: string[]; requester_id?: number };
  return {
    buscar: async () => {
      const r = await zendeskApi<{ results?: Achado[] }>(`search.json?query=${encodeURIComponent(BUSCA_B2B_COTAR)}&per_page=25`);
      const out: TicketDaMacro[] = [];
      for (const t of r.results ?? []) {
        const u = t.requester_id ? await zendeskApi<{ user?: { email?: string | null } }>(`users/${t.requester_id}.json`).catch(() => ({ user: undefined })) : { user: undefined };
        out.push({ id: t.id, tags: t.tags ?? [], subject: t.subject ?? `#${t.id}`, requesterEmail: u.user?.email?.trim() || null });
      }
      return out;
    },
    regrasDoTicket: async (t) => {
      const org = await organizacaoDoTicket({ id: t.id, requesterEmail: t.requesterEmail, subject: t.subject }, sb);
      if (!org.ok) return null;
      return { contaId: org.id, regras: await processoDaConta(sb, org.id) };
    },
    reservar: (chave, ticketId) => reservarEnvio(sb, { chave, finalidade: "b2b-cotar", canal: "zendesk_note", ticketId, motivo: "Get partner quotes macro" }),
    confirmar: (chave) => confirmarEnvio(sb, chave),
    falhou: (chave, erro) => falhouEnvio(sb, chave, erro),
    carimbar: (ticketId, tag) => addTicketTags(ticketId, [tag]),
    cotar: (ticketId) => cotarComParceirosB2B(ticketId, true),
    precisaDeAcao: (ticketId, proxima) => precisaDeAcao(ticketId, proxima),
  };
}
