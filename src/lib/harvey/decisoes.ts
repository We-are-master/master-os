/**
 * A MEDIDA de cada decisão do Harvey (o diário em harvey-wa/diario.ts é a frase
 * para o brief; aqui são campos para contar). O que ele decidiu em cada ticket, para medir (dono, 24/10/2026: "temos que
 * ver como o harvey age dentro de cada ticket, a classificação em termos de status
 * e o que ele faz de ação").
 *
 * Três tempos, numa linha de harvey_decisoes (migration 351):
 *   1. na hora: classe, ação, resultado, status antes e o status esperado;
 *   2. ~10 min depois: o status que de fato ficou (status_ok = bateu com o esperado);
 *   3. 24h depois: alguém da equipe trocou o status pelo painel? (humano_mudou)
 *
 * Registrar nunca derruba o fluxo: erro aqui vira console.error e segue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ZD_STATUS_AUTO_ASSIGNING,
  ZD_STATUS_AWAITING_APPROVAL,
  ZD_STATUS_BIDDING,
  ZD_STATUS_COMPLAINT,
  ZD_STATUS_FINANCE,
  ZD_STATUS_NEEDS_QUOTE,
  ZD_STATUS_ON_HOLD,
  ZD_STATUS_QUOTE_READY,
  ZD_STATUS_SCHEDULED,
  ZD_STATUS_TO_CALL,
  ZD_STATUS_UNASSIGNED,
} from "@/lib/zendesk-statuses";

/** O status "Solved" genérico (Completed, Cancelled e Lost apontam para ele). */
const ZD_SOLVED = 5679178036383;

export type AcaoDoHarvey =
  | "ignorado"
  | "nota_de_triagem"
  | "reclamacao_hold"
  | "reclamacao_nota"
  | "certificado"
  | "remarcacao"
  | "confirmacao_parceiro"
  | "job_criado"
  | "job_faltando"
  | "cotacao"
  | "falhou"
  | "passou_equipe"
  | "cotacao_pedida"
  | "preco_da_equipe";

export type Decisao = {
  canal: "email" | "whatsapp";
  ticketId: number | null;
  classe: string;
  acao: AcaoDoHarvey;
  resultado: "ok" | "nota" | "faltando" | "falhou";
  referencia?: string | null;
  detalhe?: string | null;
  statusAntes?: number | null;
  /** Sobrescreve o esperado da tabela (ex.: etapa do WhatsApp). */
  statusEsperado?: number[] | null;
};

/**
 * O status em que o ticket deve ficar depois de cada ação. Sem entrada = sem
 * expectativa (a ação não é sobre o status do ticket: certificado, remarcação).
 */
export const STATUS_ESPERADO: Partial<Record<AcaoDoHarvey, number[]>> = {
  reclamacao_hold: [ZD_STATUS_COMPLAINT],
  reclamacao_nota: [ZD_STATUS_COMPLAINT],
  confirmacao_parceiro: [ZD_SOLVED],
  job_criado: [ZD_STATUS_UNASSIGNED, ZD_STATUS_SCHEDULED, ZD_STATUS_AUTO_ASSIGNING],
  cotacao: [ZD_STATUS_BIDDING, ZD_STATUS_NEEDS_QUOTE, ZD_STATUS_ON_HOLD, ZD_STATUS_QUOTE_READY, ZD_STATUS_AWAITING_APPROVAL],
  cotacao_pedida: [ZD_STATUS_BIDDING],
  preco_da_equipe: [ZD_STATUS_AWAITING_APPROVAL],
};

/** A classe da triagem que também diz o status (nota de triagem). */
export const STATUS_DA_CLASSE: Record<string, number[]> = {
  financeiro: [ZD_STATUS_FINANCE],
  reclamacao: [ZD_STATUS_COMPLAINT],
};

/** A etapa da passagem do WhatsApp (etapa-da-passagem.ts) e o status dela. */
export const STATUS_DA_ETAPA: Record<string, number[]> = {
  call: [ZD_STATUS_TO_CALL],
  quote: [ZD_STATUS_NEEDS_QUOTE],
  complaint: [ZD_STATUS_COMPLAINT],
};

export function esperadoDa(d: Pick<Decisao, "acao" | "classe" | "statusEsperado">): number[] | null {
  if (d.statusEsperado !== undefined) return d.statusEsperado?.length ? d.statusEsperado : null;
  if (d.acao === "nota_de_triagem") return STATUS_DA_CLASSE[d.classe] ?? null;
  return STATUS_ESPERADO[d.acao] ?? null;
}

/** Grava a medida da decisão. Nunca lança. */
export async function registrarMedida(sb: SupabaseClient, d: Decisao): Promise<void> {
  try {
    const { error } = await sb.from("harvey_decisoes").insert({
      canal: d.canal,
      ticket_id: d.ticketId,
      classe: d.classe,
      acao: d.acao,
      resultado: d.resultado,
      referencia: d.referencia ?? null,
      detalhe: d.detalhe ? d.detalhe.slice(0, 500) : null,
      status_antes: d.statusAntes ?? null,
      status_esperado: esperadoDa(d),
    });
    if (error) console.error("[harvey] decisão não gravada", d.ticketId, error.message);
  } catch (e) {
    console.error("[harvey] decisão não gravada", d.ticketId, e);
  }
}

/* ============================ conferência ============================ */

type LinhaAConferir = { id: string; ticket_id: number | null; criado_em: string; status_esperado: number[] | null; conferido_em: string | null; conferido_24h_em: string | null };
type TicketZd = { id: number; status: string; custom_status_id: number | null };
type EventoDeAuditoria = { type: string; field_name?: string; value?: unknown };
type Auditoria = { created_at: string; via?: { channel?: string }; events: EventoDeAuditoria[] };

export type ApiDoZendesk = <T>(caminho: string) => Promise<T>;

/** O status bate com o esperado? Solved conta para qualquer status da categoria solved. */
export function statusBate(esperado: number[] | null, t: Pick<TicketZd, "status" | "custom_status_id">): boolean | null {
  if (!esperado?.length) return null;
  if (t.custom_status_id != null && esperado.includes(t.custom_status_id)) return true;
  return esperado.includes(ZD_SOLVED) && ["solved", "closed"].includes(t.status);
}

/**
 * A última troca de status feita por gente (pelo painel: via "web") depois da decisão.
 * Mudança pela API é do OS ou do próprio Harvey, não conta.
 */
export function trocaHumanaDeStatus(auditorias: readonly Auditoria[], desde: string): number | null {
  const t0 = Date.parse(desde);
  let ultimo: number | null = null;
  for (const a of auditorias) {
    if (Date.parse(a.created_at) <= t0 || a.via?.channel !== "web") continue;
    for (const e of a.events) if (e.type === "Change" && e.field_name === "custom_status_id" && e.value != null) ultimo = Number(e.value);
  }
  return ultimo;
}

/**
 * A varredura das decisões: status_depois depois de 10 min, e a correção humana
 * depois de 24h. Até 100 linhas por rodada. Roda no ciclo do Harvey de hora em hora.
 */
export async function conferirDecisoes(sb: SupabaseClient, zd: ApiDoZendesk, agora = new Date()): Promise<{ conferidas: number; em24h: number }> {
  const dezMin = new Date(agora.getTime() - 10 * 60_000).toISOString();
  const umDia = new Date(agora.getTime() - 24 * 3_600_000).toISOString();
  const { data: primeiras } = await sb
    .from("harvey_decisoes")
    .select("id, ticket_id, criado_em, status_esperado, conferido_em, conferido_24h_em")
    .is("conferido_em", null)
    .not("ticket_id", "is", null)
    .lt("criado_em", dezMin)
    .order("criado_em")
    .limit(100);
  const linhas = (primeiras ?? []) as LinhaAConferir[];
  let conferidas = 0;
  if (linhas.length) {
    const ids = [...new Set(linhas.map((l) => l.ticket_id!))];
    const { tickets } = await zd<{ tickets: TicketZd[] }>(`tickets/show_many.json?ids=${ids.join(",")}`);
    const porId = new Map((tickets ?? []).map((t) => [t.id, t]));
    for (const l of linhas) {
      const t = porId.get(l.ticket_id!);
      await sb
        .from("harvey_decisoes")
        .update({ conferido_em: agora.toISOString(), status_depois: t?.custom_status_id ?? null, status_ok: t ? statusBate(l.status_esperado, t) : null })
        .eq("id", l.id);
      conferidas++;
    }
  }

  const { data: segundas } = await sb
    .from("harvey_decisoes")
    .select("id, ticket_id, criado_em, status_esperado, conferido_em, conferido_24h_em")
    .is("conferido_24h_em", null)
    .not("ticket_id", "is", null)
    .lt("criado_em", umDia)
    .order("criado_em")
    .limit(30);
  let em24h = 0;
  for (const l of (segundas ?? []) as LinhaAConferir[]) {
    let troca: number | null = null;
    try {
      const { audits } = await zd<{ audits: Auditoria[] }>(`tickets/${l.ticket_id}/audits.json?sort_order=desc&per_page=100`);
      troca = trocaHumanaDeStatus(audits ?? [], l.criado_em);
    } catch {
      /* ticket apagado ou fechado sem acesso: fica sem a marca */
    }
    await sb.from("harvey_decisoes").update({ conferido_24h_em: agora.toISOString(), humano_mudou: troca != null, humano_status: troca }).eq("id", l.id);
    em24h++;
  }
  return { conferidas, em24h };
}

/* ============================== números ============================== */

export type LinhaDaMedida = { classe: string; acao: string; resultado: string; canal: string; status_ok: boolean | null; humano_mudou: boolean | null };

export type MedidaDaClasse = {
  classe: string;
  total: number;
  acoes: Record<string, number>;
  falhas: number;
  /** Com status esperado e já conferido. */
  conferidos: number;
  statusCerto: number;
  /** Já passaram as 24h. */
  conferidos24h: number;
  equipeCorrigiu: number;
};

/** Agrupa por classe: ação, falha, status certo e correção da equipe. */
export function medirDecisoes(linhas: readonly LinhaDaMedida[]): MedidaDaClasse[] {
  const m = new Map<string, MedidaDaClasse>();
  for (const l of linhas) {
    const c = m.get(l.classe) ?? { classe: l.classe, total: 0, acoes: {}, falhas: 0, conferidos: 0, statusCerto: 0, conferidos24h: 0, equipeCorrigiu: 0 };
    c.total++;
    c.acoes[l.acao] = (c.acoes[l.acao] ?? 0) + 1;
    if (l.resultado === "falhou") c.falhas++;
    if (l.status_ok != null) { c.conferidos++; if (l.status_ok) c.statusCerto++; }
    if (l.humano_mudou != null) { c.conferidos24h++; if (l.humano_mudou) c.equipeCorrigiu++; }
    m.set(l.classe, c);
  }
  return [...m.values()].sort((a, b) => b.total - a.total);
}

/** O nome em inglês de cada classe e ação, para a tela e o brief. */
export const ROTULO: Record<string, string> = {
  job_de_plataforma: "Platform booking",
  pedido_de_quote: "Quote request",
  pedido_de_cobertura: "Platform coverage request",
  confirmacao_de_parceiro: "Partner confirmation",
  cancelamento: "Cancellation",
  remarcacao: "Reschedule",
  indefinido: "Unclear",
  oferta_de_lead: "Lead offer",
  disponibilidade: "Availability",
  financeiro: "Finance",
  reclamacao: "Complaint",
  ticket_do_os: "OS ticket",
  lembrete_de_plataforma: "Platform reminder",
  codigo_de_acesso: "Access code",
  ruido: "Noise",
  call: "WhatsApp: call",
  quote: "WhatsApp: needs quote",
  complaint: "WhatsApp: complaint",
  booking: "WhatsApp: booking",
  quote_requested: "WhatsApp: quote requested",
  handoff: "WhatsApp: hand-off",
  request_quote: "WhatsApp: partners asked",
  preco_da_equipe: "WhatsApp: team price",
  ignorado: "skipped",
  nota_de_triagem: "note",
  reclamacao_hold: "job on hold",
  reclamacao_nota: "note",
  certificado: "certificate",
  confirmacao_parceiro: "confirmed",
  job_criado: "job created",
  job_faltando: "data missing",
  cotacao: "quote",
  falhou: "failed",
  passou_equipe: "handed off",
  cotacao_pedida: "partners invited",
};
export const rotulo = (x: string) => ROTULO[x] ?? x;

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "n/a");

/** O bloco de texto para o brief diário. */
export function textoDaMedida(medidas: readonly MedidaDaClasse[], dias: number): string {
  if (!medidas.length) return `Harvey decisions (${dias}d): none recorded yet.`;
  const total = medidas.reduce((s, c) => s + c.total, 0);
  const conf = medidas.reduce((s, c) => s + c.conferidos, 0);
  const certo = medidas.reduce((s, c) => s + c.statusCerto, 0);
  const c24 = medidas.reduce((s, c) => s + c.conferidos24h, 0);
  const corr = medidas.reduce((s, c) => s + c.equipeCorrigiu, 0);
  const linhas = medidas.map((c) => {
    const acoes = Object.entries(c.acoes).sort((a, b) => b[1] - a[1]).map(([a, n]) => `${rotulo(a)} ${n}`).join(", ");
    return `- ${rotulo(c.classe)}: ${c.total} (${acoes}) · right status ${pct(c.statusCerto, c.conferidos)} · team changed status ${pct(c.equipeCorrigiu, c.conferidos24h)}${c.falhas ? ` · ${c.falhas} failed` : ""}`;
  });
  return [`Harvey decisions (${dias}d): ${total} · right status ${pct(certo, conf)} · team changed status ${pct(corr, c24)}`, ...linhas].join("\n");
}

/** As linhas dos últimos N dias, prontas para medir. */
export async function medidaDosUltimosDias(sb: SupabaseClient, dias = 7): Promise<MedidaDaClasse[]> {
  const desde = new Date(Date.now() - dias * 864e5).toISOString();
  const { data, error } = await sb.from("harvey_decisoes").select("classe, acao, resultado, canal, status_ok, humano_mudou").gte("criado_em", desde).limit(5000);
  if (error) throw new Error(error.message);
  return medirDecisoes((data ?? []) as LinhaDaMedida[]);
}
