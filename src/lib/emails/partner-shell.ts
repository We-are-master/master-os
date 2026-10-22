/**
 * O que os e-mails ao PARCEIRO compartilham em cima da moldura única
 * (`emailFixfy`, desenho "Painel de status").
 *
 * A moldura é a mesma do cliente; aqui ficam só as peças do lado do parceiro:
 * a jornada do job vista por quem executa (Offered · Accepted · On the day ·
 * Report · Paid), a do cadastro (Profile · Documents · Active), a agenda do job
 * em métricas, a limpeza de travessão e o bloco de fotos, que a moldura não
 * desenha e que o parceiro precisa ver antes de sair de casa.
 */
import { dataLonga, esc, horaCurta, janelaDeTexto, janelaTexto, type Metrica, type Passo } from "./fixfy-shell";
import { janelaCurta, passosAte } from "./faixas-do-email";

/** A vida do job do lado de quem executa. */
export const PASSOS_JOB_PARCEIRO = ["Offered", "Accepted", "On the day", "Report", "Paid"] as const;
export const PASSO_OFERTA = 0;
export const PASSO_ACEITO = 1;
export const PASSO_NO_DIA = 2;
export const PASSO_RELATORIO = 3;
export const PASSO_PAGO = 4;

/** O cadastro do parceiro. */
export const PASSOS_CADASTRO = ["Profile", "Documents", "Active"] as const;

export function passosDoJob(atual: number): Passo[] {
  return passosAte(PASSOS_JOB_PARCEIRO, atual);
}

export function passosDoCadastro(atual: number): Passo[] {
  return passosAte(PASSOS_CADASTRO, atual);
}

/** "Hi TM Handyman," (o nome já vem de `partnerEmailGreetingName`). */
export function saudacaoDoParceiro(nome: string | null | undefined): string {
  const n = String(nome ?? "").replace(/\s+/g, " ").trim();
  return `Hi ${n || "there"},`;
}

/** Nada de travessão no texto (dono): " — " e " – " viram " · ". */
export function semTravessao(s: string): string {
  return String(s ?? "")
    .replace(/\s+[—–]\s+/g, " · ")
    .replace(/[—–]/g, "-");
}

/**
 * Notas do catálogo ("⏱ Maximum 3 hours…", "✓ Fixed price…"): sem o ícone na
 * frente e sem travessão, porque a moldura não usa emoji.
 */
export function notaLimpa(s: string | null | undefined): string {
  return semTravessao(
    String(s ?? "")
      .split(/\n+/)
      .map((l) => l.replace(/^[\s\p{Extended_Pictographic}✓✔⏱️]+/u, "").trim())
      .filter(Boolean)
      .join(" "),
  );
}

/** O escopo em parágrafos (a moldura não guarda quebra de linha). */
export function paragrafosDoEscopo(escopo: string | null | undefined, rotulo = "Scope of work"): string[] {
  const linhas = String(escopo ?? "")
    .split(/\n+/)
    .map((l) => semTravessao(l.trim()))
    .filter(Boolean);
  if (!linhas.length) return [];
  return [`${rotulo}: ${linhas[0]}`, ...linhas.slice(1)];
}

/** "9:00 AM" / "09:00" / "9AM" viram "9am"; "12:00 PM" vira "midday". */
export function horaDeTexto(texto: string | null | undefined): string {
  const t = String(texto ?? "").trim();
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return t;
  const j = janelaDeTexto(`${t} to ${t}`);
  const h = j?.match(/^between (.+) and /)?.[1];
  return h ?? t;
}

/** Janela que chegou como texto ("9:00 AM – 12:00 PM") em "9am to midday". */
export function janelaCurtaDeTexto(texto: string | null | undefined): string {
  const t = String(texto ?? "").trim();
  return janelaCurta(janelaDeTexto(t)) ?? semTravessao(t);
}

export type AgendaDoJob = {
  scheduledDate?: string | null;
  scheduledStartAt?: string | null;
  scheduledEndAt?: string | null;
  scheduledFinishDate?: string | null;
};

/** Dia, chegada e fim esperado do job, já no formato dos e-mails. */
export function agendaDoJob(a: AgendaDoJob): { data: string | null; chegada: string | null; fim: string | null } {
  const data = dataLonga(a.scheduledStartAt || a.scheduledDate || null);
  const janela = janelaTexto(a.scheduledStartAt, a.scheduledEndAt);
  const chegada = janela ? janelaCurta(janela) : horaCurta(a.scheduledStartAt);
  const fimRaw = a.scheduledFinishDate?.trim() || null;
  const fim = fimRaw ? dataLonga(fimRaw.slice(0, 10)) : null;
  return { data, chegada, fim: fim && fim !== data ? fim : null };
}

/** Métricas Date + Arrival do job ("TBC" sem data). */
export function metricasDaAgenda(a: AgendaDoJob): Metrica[] {
  const ag = agendaDoJob(a);
  return [
    { rotulo: "Date", valor: ag.data ?? "TBC", sub: ag.fim ? `Expected finish ${ag.fim}` : null },
    { rotulo: "Arrival", valor: ag.chegada ?? (ag.data ? "To be confirmed" : "") },
  ];
}

/**
 * Uma linha de agenda já formatada ("Wed 21 Oct 26 · Arrival time 9AM – 12PM
 * · Expected finish Fri 23 Oct 26") separada em dia e janela curta.
 */
export function agendaDaLinha(linha: string | null | undefined, hora?: string | null): { data: string; chegada: string | null } {
  const partes = String(linha ?? "").split(/\s+·\s+/).map((p) => p.trim()).filter(Boolean);
  const data = semTravessao(partes[0] ?? "");
  const chegadaParte = partes.find((p) => /^arrival time\s+/i.test(p));
  const chegadaRaw = chegadaParte ? chegadaParte.replace(/^arrival time\s+/i, "") : (hora?.trim() || "");
  const chegada = chegadaRaw ? (/\d/.test(chegadaRaw) && !/[–—-]|\bto\b|\band\b/i.test(chegadaRaw) ? horaDeTexto(chegadaRaw) : janelaCurtaDeTexto(chegadaRaw)) : null;
  return { data, chegada };
}

/** Marca que vira o bloco de fotos depois da moldura montada. */
export const MARCA_FOTOS = "[[fixfy-fotos]]";

/**
 * Miniaturas das fotos do job, sem tabela (o Zendesk desenha borda em toda
 * célula). `href` faz cada foto abrir a galeria; `maisLink` fecha a fileira.
 */
export function blocoDeFotosHtml(
  urls: readonly string[],
  opts: { legenda: string; max: number; href?: string | null; maisLink?: { label: string; url: string } | null },
): string {
  if (!urls.length) return "";
  const imgs = urls
    .slice(0, opts.max)
    .map((u, i) => {
      const img = `<img src="${esc(u)}" alt="Site photo ${i + 1} of ${urls.length}" width="120" style="display:inline-block;width:120px;max-width:120px;height:auto;border-radius:8px;border:1px solid #E4E4EC;margin:0 8px 8px 0;vertical-align:top;">`;
      return opts.href ? `<a href="${esc(opts.href)}" target="_blank" style="text-decoration:none;">${img}</a>` : img;
    })
    .join("");
  const mais = opts.maisLink
    ? `<a href="${esc(opts.maisLink.url)}" target="_blank" style="display:inline-block;vertical-align:top;margin:0 8px 8px 0;padding:12px 14px;border:1px solid #E4E4EC;border-radius:8px;background:#F7F7FB;color:#020040;font-size:13px;font-weight:600;text-decoration:none;">${esc(opts.maisLink.label)}</a>`
    : "";
  return `<div style="margin:0 0 12px 0;"><p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:#6B6B85;">${esc(opts.legenda)}</p><div style="font-size:0;line-height:0;">${imgs}${mais}</div></div>`;
}

/** Troca a marca de fotos pelo bloco (html) e pela linha (texto). */
export function comFotos(r: { html: string; text: string }, html: string, text: string): { html: string; text: string } {
  const marca = MARCA_FOTOS.replace(/[[\]]/g, "\\$&");
  return {
    html: r.html.replace(new RegExp(`<p[^>]*>${marca}</p>`), html),
    text: r.text.replace(new RegExp(`${marca}\\n*`), text ? `${text}\n\n` : ""),
  };
}
