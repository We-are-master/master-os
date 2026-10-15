/**
 * "Where you need to step in": a seção do brief da manhã que diz ao dono onde
 * ele (ou a equipe) tem de pôr a mão. Funções puras: recebem o que já foi lido
 * (views do Zendesk, quotes, jobs, diário do Harvey) e devolvem HTML.
 *
 * A leitura mora em `brief-atencao-leitura.ts`.
 */

export type FonteDeAtencao = "action_required" | "quoting" | "needs_attention" | "quote_ready" | "complaint";

export type ItemDeAtencao = {
  fonte: FonteDeAtencao;
  ticketId: number | null;
  /** QT-… ou JOB-… quando vem do OS. */
  ref?: string | null;
  cliente: string | null;
  /** Uma linha, em inglês: o que falta. */
  oQuePrecisa: string;
  /** Desde quando está assim (ISO). */
  desde: string | null;
};

export type PendenteDoDiario = {
  criado_em: string;
  origem: string;
  ticket_id: number | null;
  quote_ref: string | null;
  job_ref: string | null;
  decisao: string;
  pendente: string | null;
  resolvido_em?: string | null;
};

export const TITULO_DA_FONTE: Record<FonteDeAtencao, string> = {
  action_required: "Action Required",
  quoting: "Quoting",
  needs_attention: "Needs Attention",
  quote_ready: "Quotes ready to send",
  complaint: "Jobs on hold with a complaint",
};

const ORDEM: FonteDeAtencao[] = ["action_required", "needs_attention", "complaint", "quote_ready", "quoting"];

/** O que falta, por view, com o assunto do ticket quando houver. */
export function oQuePrecisaDoTicket(fonte: FonteDeAtencao, assunto: string | null | undefined): string {
  const base: Record<FonteDeAtencao, string> = {
    action_required: "Customer is waiting for a reply",
    quoting: "Waiting on bids or a price",
    needs_attention: "On hold, needs a decision",
    quote_ready: "Price is ready, review and send",
    complaint: "Complaint open, needs a call",
  };
  const a = String(assunto ?? "").replace(/\s+/g, " ").trim();
  return a ? `${base[fonte]}: ${a.length > 90 ? `${a.slice(0, 89)}…` : a}` : base[fonte];
}

/** Idade curta: "just now", "45m", "5h", "3d". */
export function idade(desde: string | null | undefined, agora: Date): string {
  if (!desde) return "?";
  const t = new Date(desde).getTime();
  if (!Number.isFinite(t)) return "?";
  const min = Math.max(0, Math.floor((agora.getTime() - t) / 60_000));
  if (min < 5) return "just now";
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

/** O mesmo ticket em duas listas aparece uma vez só (vale a primeira, na ORDEM). */
export function semRepetidos(itens: ItemDeAtencao[]): ItemDeAtencao[] {
  const ordenados = [...itens].sort((a, b) => ORDEM.indexOf(a.fonte) - ORDEM.indexOf(b.fonte));
  const vistos = new Set<string>();
  const out: ItemDeAtencao[] = [];
  for (const i of ordenados) {
    const chave = i.ticketId ? `t${i.ticketId}` : i.ref ? `r${i.ref}` : null;
    if (chave && vistos.has(chave)) continue;
    if (chave) vistos.add(chave);
    out.push(i);
  }
  return out;
}

/** Dia (YYYY-MM-DD) de um instante em Londres. */
export function diaEmLondres(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** As linhas do diário de ONTEM (Londres) com pendência aberta. */
export function pendentesDeOntem(linhas: PendenteDoDiario[], agora: Date): PendenteDoDiario[] {
  const ontem = diaEmLondres(new Date(agora.getTime() - 24 * 3_600_000));
  return linhas
    .filter((l) => l.pendente?.trim() && !l.resolvido_em && diaEmLondres(new Date(l.criado_em)) === ontem)
    .sort((a, b) => a.criado_em.localeCompare(b.criado_em));
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

const FONTE = "font-family:system-ui,sans-serif";

/** Uma linha do item: "#123 · Jane Doe · Customer is waiting for a reply · 2d". */
export function linhaDoItem(i: ItemDeAtencao, agora: Date): string {
  const id = i.ticketId ? `#${i.ticketId}` : (i.ref ?? "");
  const partes = [id, i.ticketId && i.ref ? i.ref : null, i.cliente?.trim() || "Unknown customer", i.oQuePrecisa, idade(i.desde, agora)];
  return partes.filter((p): p is string => Boolean(p)).join(" · ");
}

export function linhaDoPendente(p: PendenteDoDiario): string {
  const onde = [p.ticket_id ? `#${p.ticket_id}` : null, p.quote_ref, p.job_ref].filter(Boolean).join(" ");
  return [onde || p.origem, p.decisao, `Open: ${p.pendente ?? ""}`].filter(Boolean).join(" · ");
}

/**
 * O HTML da seção. `falhas` são as fontes que não deu para ler (aparecem no
 * pé, para ninguém achar que "vazio" quer dizer "nada a fazer").
 */
export function montarSecaoAtencaoHtml(p: {
  itens: ItemDeAtencao[];
  pendentes: PendenteDoDiario[];
  agora: Date;
  falhas?: string[];
  limitePorGrupo?: number;
}): string {
  const limite = p.limitePorGrupo ?? 15;
  const itens = semRepetidos(p.itens);
  const grupos = ORDEM.map((f) => ({ fonte: f, lista: itens.filter((i) => i.fonte === f) })).filter((g) => g.lista.length);

  const blocos = grupos.map((g) => {
    const visiveis = g.lista.slice(0, limite);
    const resto = g.lista.length - visiveis.length;
    return `<p style="${FONTE};font-size:13px;font-weight:700;color:#0f172a;margin:14px 0 4px">${esc(TITULO_DA_FONTE[g.fonte])} (${g.lista.length})</p>
      <ul style="${FONTE};font-size:13px;color:#1e293b;margin:0;padding-left:18px">${visiveis.map((i) => `<li style="margin:3px 0">${esc(linhaDoItem(i, p.agora))}</li>`).join("")}${resto > 0 ? `<li style="margin:3px 0;color:#64748b">and ${resto} more</li>` : ""}</ul>`;
  });

  const pend = p.pendentes.length
    ? `<p style="${FONTE};font-size:13px;font-weight:700;color:#0f172a;margin:14px 0 4px">Left open by Harvey yesterday (${p.pendentes.length})</p>
      <ul style="${FONTE};font-size:13px;color:#1e293b;margin:0;padding-left:18px">${p.pendentes.slice(0, limite).map((x) => `<li style="margin:3px 0">${esc(linhaDoPendente(x))}</li>`).join("")}${p.pendentes.length > limite ? `<li style="margin:3px 0;color:#64748b">and ${p.pendentes.length - limite} more</li>` : ""}</ul>`
    : "";

  const vazio = !blocos.length && !pend && !p.falhas?.length ? `<p style="${FONTE};font-size:13px;color:#334155;margin:8px 0 0">Nothing needs you this morning.</p>` : "";
  const falhas = p.falhas?.length
    ? `<p style="${FONTE};font-size:11px;color:#b45309;margin:10px 0 0">Could not read: ${esc(p.falhas.join(", "))}. Check those lists by hand.</p>`
    : "";

  return `<div style="margin:0 0 20px;padding:16px;background:#fff7ed;border-radius:12px;border:1px solid #fed7aa">
      <p style="margin:0 0 4px;${FONTE};font-size:12px;font-weight:700;color:#9a3412;text-transform:uppercase">Where you need to step in</p>
      ${blocos.join("")}${pend}${vazio}${falhas}
    </div>`;
}
