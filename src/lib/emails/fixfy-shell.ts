/**
 * A moldura única dos e-mails ao cliente, e as regras de texto que todos eles
 * seguem.
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * Em 19/10/2026 o levantamento das 45 mensagens automáticas achou cinco
 * molduras diferentes, quatro jeitos de escrever a data, três assinaturas, dois
 * números de telefone e "support@" num lugar e "hello@" no outro. O dono
 * aprovou o desenho de app (20/10: "like Uber, não e-mail de contador") e a
 * copy nova (docs/copy/fixfy-client-copy.json + CLAUDE-HANDOFF.md). Cada
 * e-mail agora só escreve o miolo; cabeçalho, rodapé, saudação, data, janela,
 * botão e transferência saem daqui, iguais em todos.
 *
 * ─── O desenho ───────────────────────────────────────────────────────────
 *
 * Logo pequeno no topo, um estado curto (Confirmed, Rescheduled, Payment due…)
 * sem emoji, um título que é a frase do e-mail (nunca a saudação), a data e a
 * janela em destaque quando existem, a saudação e o texto, as linhas do job,
 * UM botão, a transferência bancária embaixo dele quando há pagamento, a letra
 * pequena e o rodapé. Branco, navy #020040, laranja #ED4B00, texto #303044,
 * secundário #606078, 600px no máximo.
 *
 * `zendesk: true` troca as tabelas internas por `div` e parágrafo: o
 * visualizador do Zendesk desenha borda em toda célula, e os avisos de job
 * vão como comentário público no ticket.
 */

export const FX = {
  navy: "#020040",
  orange: "#ED4B00",
  text: "#303044",
  muted: "#606078",
  faint: "#9A9CA8",
  line: "#EEEEF2",
  canvas: "#F5F5F7",
  soft: "#F7F7FA",
  green: "#15803D",
} as const;

export const FIXFY_CONTACT = {
  email: "hello@getfixfy.com",
  phone: "+44 20 4538 4668",
  legal: "Getfixfy Ltd, trading as Fixfy · 124 City Road, London EC1V 2NX · Company number 15406523",
} as const;

/**
 * Sem assinatura por padrão (dono, 20/10/2026: "don't need The Fixfy team").
 * Fica exportada vazia para quem ainda importa; assinatura só quando o e-mail
 * passar uma explicitamente.
 */
export const FIXFY_SIGNATURE = "";

const LOGO = "https://www.getfixfy.com/brand/fixfy-primary-white.png";

export function esc(s: unknown): string {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Só http(s): link de cliente que vier com outra coisa não vira href. */
export function urlSegura(url: string | null | undefined): string | null {
  const u = String(url ?? "").trim();
  return /^https?:\/\/[^\s"'<>]+$/i.test(u) ? u : null;
}

// ─── Saudação ───────────────────────────────────────────────────────────

/**
 * Quem é o destinatário. Sai da RELAÇÃO da conta com o cliente, nunca do nome
 * ou do domínio do e-mail (handoff: "never infer from a name or email domain").
 */
export type Publico =
  | { tipo: "b2c"; primeiroNome?: string | null }
  | { tipo: "b2b"; empresa?: string | null };

/**
 * B2C: "Hi Sarah," (sem nome: "Hi there,"). B2B: "Hi Acme Lettings team,"
 * (sem empresa: "Hi team,"). Em B2B nunca cai no nome da pessoa de contato. Se
 * a empresa já termina em "team", não repete.
 */
export function saudacao(p: Publico): string {
  if (p.tipo === "b2b") {
    const nome = String(p.empresa ?? "").replace(/\s+/g, " ").trim();
    if (!nome) return "Hi team,";
    return /\bteam$/i.test(nome) ? `Hi ${nome},` : `Hi ${nome} team,`;
  }
  const primeiro = String(p.primeiroNome ?? "").trim().split(/\s+/)[0] ?? "";
  return primeiro ? `Hi ${primeiro},` : "Hi there,";
}

/** Primeiro nome de um nome completo; "" se não houver. */
export function primeiroNome(nomeCompleto: string | null | undefined): string {
  return String(nomeCompleto ?? "").trim().split(/\s+/)[0] ?? "";
}

// ─── Data e janela (Europe/London) ──────────────────────────────────────

/**
 * `2026-10-21` ou um ISO vira `Wed 21 Oct 26`, no fuso de
 * Londres. Data só (YYYY-MM-DD) é lida como dia de calendário, sem fuso.
 */
export function dataLonga(valor: string | Date | null | undefined): string | null {
  if (!valor) return null;
  let d: Date;
  let tz = "Europe/London";
  if (typeof valor === "string" && /^\d{4}-\d{2}-\d{2}$/.test(valor.trim())) {
    const [y, m, dd] = valor.trim().split("-").map(Number);
    d = new Date(Date.UTC(y!, m! - 1, dd!));
    tz = "UTC";
  } else {
    d = valor instanceof Date ? valor : new Date(valor);
  }
  if (Number.isNaN(d.getTime())) return null;
  // Abreviada em tudo (dono, 20/10/2026): "Wed 21 Oct 26".
  const partes = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "2-digit", timeZone: tz }).formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  // en-GB escreve "Sept"; o resto do mês é de três letras.
  return `${v("weekday")} ${v("day")} ${v("month").replace(/^Sept$/, "Sep")} ${v("year")}`;
}

/** Uma hora em Londres: `9am`, `9:30am`, `midday`, `midnight`, `4pm`. */
export function horaCurta(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-GB", { hour: "numeric", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).formatToParts(d);
  const h = Number(partes.find((x) => x.type === "hour")?.value ?? "0");
  const min = partes.find((x) => x.type === "minute")?.value ?? "00";
  if (min === "00" && h === 12) return "midday";
  if (min === "00" && h === 0) return "midnight";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}${min === "00" ? "" : `:${min}`}${h < 12 ? "am" : "pm"}`;
}

/** `between 9am and midday`. Null sem as duas pontas. */
export function janelaTexto(inicio: string | Date | null | undefined, fim: string | Date | null | undefined): string | null {
  const a = horaCurta(inicio);
  const b = horaCurta(fim);
  return a && b ? `between ${a} and ${b}` : null;
}

/**
 * Janela que já chegou como texto (`9AM – 12PM`, `09:00-12:00`, `between 9am
 * and 12pm`) no mesmo formato: `between 9am and midday`.
 */
export function janelaDeTexto(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").trim();
  if (!t || /^to be confirmed$/i.test(t)) return null;
  const m = t.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:[–—-]|to|and)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!m) return t;
  const hora = (h: string, mm: string | undefined, ap: string | undefined) => {
    let n = Number(h);
    const p = ap?.toLowerCase();
    if (p === "pm" && n < 12) n += 12;
    if (p === "am" && n === 12) n = 0;
    const min = mm && mm !== "00" ? `:${mm}` : "";
    if (!min && n === 12) return "midday";
    if (!min && n === 0) return "midnight";
    const h12 = n % 12 === 0 ? 12 : n % 12;
    return `${h12}${min}${n < 12 ? "am" : "pm"}`;
  };
  return `between ${hora(m[1]!, m[2], m[3])} and ${hora(m[4]!, m[5], m[6])}`;
}

/** £1,234.50 */
export function gbp(n: number | null | undefined): string {
  return `£${(Number(n) || 0).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Placeholders da copy ───────────────────────────────────────────────

/**
 * Troca `{{chave}}` pelo valor. Chave sem valor some com a frase inteira? Não:
 * devolve `faltando` para o chamador decidir (omitir a linha, ou não mandar).
 * Mensagem entregue nunca leva placeholder cru (handoff).
 */
export function preencher(modelo: string, vars: Record<string, string | null | undefined>): { texto: string; faltando: string[] } {
  const faltando: string[] = [];
  const texto = modelo.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, k: string) => {
    const v = vars[k];
    if (v == null || String(v).trim() === "") {
      faltando.push(k);
      return "";
    }
    return String(v);
  });
  return { texto, faltando };
}

/** Preenche e devolve só se nada faltou; senão null (para linha opcional sumir). */
export function preencherOuNada(modelo: string, vars: Record<string, string | null | undefined>): string | null {
  const r = preencher(modelo, vars);
  return r.faltando.length ? null : r.texto;
}

// ─── Moldura ────────────────────────────────────────────────────────────

export type Estado = { texto: string; cor?: "navy" | "orange" | "green" | "muted" };

export type Transferencia = {
  /** Linhas da conta bancária verificada, da configuração (nunca de exemplo). */
  dadosBancarios: Array<[string, string]>;
  referencia: string;
  /** Só nos e-mails de booking: "We'll confirm your booking once payment has been received and checked." */
  booking?: boolean;
};

/** Uma métrica da faixa de métricas (como a do OS): rótulo pequeno, valor grande, linha embaixo. */
export type Metrica = { rotulo: string; valor: string; sub?: string | null };
/** Um passo da faixa de progresso do job. */
export type Passo = { nome: string; estado: "feito" | "atual" | "futuro" };

export type EmailFixfy = {
  preheader: string;
  estado?: Estado | null;
  titulo: string;
  /** Destaque grande: data e janela, ou valor e vencimento. */
  destaque?: { linha1: string; linha2?: string | null; riscado?: string | null } | null;
  /** Faixa de métricas (data, janela, valor, vencimento). Sem ela, o destaque vira uma métrica. */
  metricas?: Metrica[] | null;
  /** Faixa de progresso do job; o passo "atual" leva a régua coral. */
  passos?: Passo[] | null;
  saudacao: string;
  /** Parágrafos em texto puro (escapados aqui). */
  paragrafos: string[];
  /** Linhas rótulo/valor; valor vazio some. */
  linhas?: Array<[string, string | null | undefined]>;
  cta?: { label: string; url: string | null | undefined } | null;
  /** Links de texto embaixo do botão (recusar cotação, WhatsApp, indicação). */
  linksSecundarios?: Array<{ label: string; url: string | null | undefined }>;
  transferencia?: Transferencia | null;
  /** Quadro de destaque suave (garantia, aviso). */
  nota?: string | null;
  /** Letra pequena no fim (texto legal, detalhes do valor). */
  letraPequena?: string[];
  assinatura?: string | null;
  /** E-mail de marketing: link de descadastro e a frase de por que recebe. */
  marketing?: { descadastroUrl: string; motivo: string } | null;
  /** Comentário público do Zendesk: sem tabela interna. */
  zendesk?: boolean;
};

const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** Cores de estado do DS Fixfy OS UNO (fundo e texto do chip). */
const UNO = {
  nav: "#0A0A28",
  ink: "#0A0A1F",
  ink2: "#3A3A55",
  ink3: "#6B6B85",
  panel2: "#F7F7FB",
  line: "#E4E4EC",
  accent: "#ED4B00",
} as const;

const iconeDoEstado = (c: Estado["cor"]) =>
  c === "green" ? "&#10003;" : c === "orange" ? "&#8635;" : c === "muted" ? "&#8226;" : "&#8599;";

function blocoTransferenciaHtml(t: Transferencia, zendesk: boolean): string {
  const linhas = t.dadosBancarios.filter(([, v]) => String(v ?? "").trim());
  if (!linhas.length) return "";
  const frase = `Prefer a bank transfer? Use the details below and quote ${esc(t.referencia)}. Once you’ve made the transfer, reply with the payment date and reference so we can check receipt.${t.booking ? " We’ll confirm your booking once payment has been received and checked." : ""}`;
  const corpo = linhas
    .map(([r, v]) => `<p style="margin:0 0 4px 0;font-size:14px;line-height:20px;color:${UNO.ink};"><span style="color:${UNO.ink3};">${esc(r)}:</span> <strong style="font-weight:600;">${esc(v)}</strong></p>`)
    .join("");
  const caixa = `<p style="margin:0 0 10px 0;font-size:14px;line-height:21px;color:${UNO.ink2};">${frase}</p>${corpo}<p style="margin:4px 0 0 0;font-size:14px;line-height:20px;color:${UNO.ink};"><span style="color:${UNO.ink3};">Reference:</span> <strong style="font-weight:600;">${esc(t.referencia)}</strong></p>`;
  return zendesk
    ? `<div style="margin:16px 0 0 0;padding:16px;background:${UNO.panel2};border-radius:12px;">${caixa}</div>`
    : `<tr><td class="fx-pad" style="padding:16px 32px 0 32px;"><div style="padding:16px;background:${UNO.panel2};border-radius:12px;">${caixa}</div></td></tr>`;
}

/**
 * HTML e texto do mesmo conteúdo (handoff: "Generate HTML and plain text from the same copy").
 *
 * Desenho "Painel de status" (dono escolheu a Ideia B em 20/10/2026), no DS Fixfy
 * OS UNO: topo navy com o wordmark branco, o estado num chip e o título em
 * branco; a faixa de progresso do job (o passo atual na régua coral, o único
 * coral do e-mail, como o DS manda); a linha de métricas igual à do OS; o
 * texto; os detalhes em duas colunas; UM botão navy (o DS não tem botão
 * laranja); transferência, nota, letra pequena e o rodapé navy.
 */
export function emailFixfy(e: EmailFixfy): { html: string; text: string } {
  const z = Boolean(e.zendesk);
  const linhas = (e.linhas ?? []).filter((l): l is [string, string] => Boolean(l[1] && String(l[1]).trim()));
  const cta = e.cta && urlSegura(e.cta.url) ? { label: e.cta.label, url: urlSegura(e.cta.url)! } : null;
  const secundarios = (e.linksSecundarios ?? []).filter((l) => urlSegura(l.url));
  const assinatura = e.assinatura?.trim() ? e.assinatura.trim() : null;

  // Métricas: as do e-mail; sem elas, o destaque vira uma métrica só.
  const metricas: Metrica[] = (e.metricas ?? []).filter((m) => m.valor?.trim()).length
    ? (e.metricas ?? []).filter((m) => m.valor?.trim())
    : e.destaque?.linha1
      ? [{ rotulo: "", valor: e.destaque.linha1, sub: e.destaque.linha2 ?? null }]
      : [];
  const riscado = e.destaque?.riscado?.trim() || null;
  const passos = (e.passos ?? []).filter((p) => p.nome.trim());

  // ─── topo navy ───
  const chipEstado = e.estado
    ? `<span style="display:inline-block;background:rgba(255,255,255,0.12);color:#FFFFFF;font-size:12px;font-weight:600;line-height:16px;padding:4px 10px;border-radius:6px;">${iconeDoEstado(e.estado.cor)}&nbsp; ${esc(e.estado.texto)}</span>`
    : "";
  const titulo = `<h1 style="margin:${chipEstado ? "12px" : "0"} 0 0 0;font-family:${SANS};font-size:26px;line-height:32px;font-weight:600;letter-spacing:-0.03em;color:#FFFFFF;">${esc(e.titulo)}</h1>`;
  const logo = `<img src="${LOGO}" alt="Fixfy" width="68" style="display:block;width:68px;height:auto;border:0;margin:0 0 22px 0;">`;
  const topoInner = `${logo}${chipEstado}${titulo}`;

  // ─── progresso ───
  const corPasso = (p: Passo) => (p.estado === "atual" ? UNO.accent : p.estado === "feito" ? FX.navy : UNO.line);
  const corTextoPasso = (p: Passo) => (p.estado === "atual" ? UNO.ink : p.estado === "feito" ? UNO.ink2 : UNO.ink3);
  const passoHtml = (p: Passo) =>
    `<div style="height:4px;border-radius:2px;background:${corPasso(p)};font-size:0;line-height:0;">&nbsp;</div><p style="margin:8px 0 0 0;font-family:${SANS};font-size:11px;line-height:14px;font-weight:${p.estado === "atual" ? 600 : 500};color:${corTextoPasso(p)};">${esc(p.nome)}</p>`;
  const largura = passos.length ? Math.floor(100 / passos.length) : 0;
  const progresso = !passos.length
    ? ""
    : z
      ? `<div style="padding:18px 28px 4px 28px;font-size:0;">${passos.map((p) => `<div style="display:inline-block;vertical-align:top;width:${largura}%;box-sizing:border-box;padding:0 3px;">${passoHtml(p)}</div>`).join("")}</div>`
      : `<tr><td class="fx-pad" style="padding:18px 29px 4px 29px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${passos.map((p) => `<td valign="top" width="${largura}%" style="padding:0 3px;">${passoHtml(p)}</td>`).join("")}</tr></table></td></tr>`;

  // ─── métricas ───
  const metricaHtml = (m: Metrica) =>
    `${m.rotulo ? `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:11px;line-height:14px;font-weight:500;color:${UNO.ink3};">${esc(m.rotulo)}</p>` : ""}<p style="margin:0;font-family:${SANS};font-size:20px;line-height:26px;font-weight:600;letter-spacing:-0.02em;color:${UNO.ink};">${esc(m.valor)}</p>${m.sub ? `<p style="margin:2px 0 0 0;font-family:${SANS};font-size:13px;line-height:18px;color:${UNO.ink2};">${esc(m.sub)}</p>` : ""}`;
  const riscadoHtml = riscado
    ? `<p style="margin:10px 0 0 0;font-family:${SANS};font-size:13px;line-height:18px;color:${UNO.ink3};">Previously <span style="text-decoration:line-through;">${esc(riscado)}</span></p>`
    : "";
  const faixa = !metricas.length
    ? ""
    : z
      ? `<div style="margin:16px 28px 0 28px;background:${UNO.panel2};border-radius:12px;font-size:0;">${metricas.map((m, i) => `<div style="display:inline-block;vertical-align:top;width:${Math.floor(100 / metricas.length)}%;box-sizing:border-box;padding:14px 18px;${i ? `border-left:1px solid ${UNO.line};` : ""}">${metricaHtml(m)}</div>`).join("")}</div>${riscado ? `<div style="padding:0 28px;">${riscadoHtml}</div>` : ""}`
      : `<tr><td class="fx-pad" style="padding:16px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${UNO.panel2};border-radius:12px;"><tr>${metricas.map((m, i) => `<td class="fx-col" valign="top" style="padding:14px 18px;${i ? `border-left:1px solid ${UNO.line};` : ""}">${metricaHtml(m)}</td>`).join("")}</tr></table>${riscadoHtml}</td></tr>`;

  // ─── texto ───
  const corpoTexto =
    `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${UNO.ink};">${esc(e.saudacao)}</p>` +
    e.paragrafos.map((p) => `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:15px;line-height:24px;color:${UNO.ink2};">${esc(p)}</p>`).join("");

  // ─── detalhes em duas colunas ───
  const par = ([r, v]: [string, string]) =>
    `<p style="margin:0 0 2px 0;font-family:${SANS};font-size:12px;line-height:16px;color:${UNO.ink3};">${esc(r)}</p><p style="margin:0;font-family:${SANS};font-size:14px;line-height:20px;font-weight:500;color:${UNO.ink};">${esc(v)}</p>`;
  let detalhes = "";
  if (linhas.length) {
    if (z) {
      detalhes = `<div style="margin:8px 28px 0 28px;border-top:1px solid ${UNO.line};border-bottom:1px solid ${UNO.line};font-size:0;">${linhas.map((l) => `<div style="display:inline-block;vertical-align:top;width:50%;box-sizing:border-box;padding:10px 8px 10px 0;">${par(l)}</div>`).join("")}</div>`;
    } else {
      const linhasGrade: string[] = [];
      for (let i = 0; i < linhas.length; i += 2) {
        linhasGrade.push(`<tr><td class="fx-col" width="50%" valign="top" style="padding:10px 12px 10px 0;">${par(linhas[i]!)}</td><td class="fx-col" width="50%" valign="top" style="padding:10px 0;">${linhas[i + 1] ? par(linhas[i + 1]!) : "&nbsp;"}</td></tr>`);
      }
      detalhes = `<tr><td class="fx-pad" style="padding:4px 32px 0 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-top:1px solid ${UNO.line};border-bottom:1px solid ${UNO.line};">${linhasGrade.join("")}</table></td></tr>`;
    }
  }

  // ─── botão, links, nota, assinatura ───
  const botao = cta
    ? `<a href="${esc(cta.url)}" style="display:block;background:${FX.navy};color:#FFFFFF;text-decoration:none;font-family:${SANS};font-size:15px;font-weight:600;line-height:20px;padding:12px 0;min-height:44px;box-sizing:border-box;border-radius:8px;text-align:center;">${esc(cta.label)}</a>`
    : "";
  const links = secundarios.length
    ? `<p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:20px;text-align:center;color:${UNO.ink3};">${secundarios.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:600;">${esc(l.label)}</a>`).join(" &middot; ")}</p>`
    : "";
  const nota = e.nota
    ? `<p style="margin:0;padding:14px 16px;background:${UNO.panel2};border-radius:12px;font-family:${SANS};font-size:14px;line-height:21px;color:${UNO.ink2};">${esc(e.nota)}</p>`
    : "";
  const assina = assinatura ? `<p style="margin:16px 0 0 0;font-family:${SANS};font-size:15px;line-height:24px;color:${UNO.ink};">${esc(assinatura)}</p>` : "";
  const fino = (e.letraPequena ?? []).filter(Boolean);
  const finoHtml = fino.length
    ? fino.map((t) => `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${UNO.ink3};">${esc(t)}</p>`).join("")
    : "";
  const marketing = e.marketing && urlSegura(e.marketing.descadastroUrl)
    ? `<br>${esc(e.marketing.motivo)} <a href="${esc(urlSegura(e.marketing.descadastroUrl)!)}" style="color:#FFFFFF;">Unsubscribe</a>`
    : "";
  // Rodapé navy com letra branca em todos (dono, 20/10/2026).
  const rodape = `<img src="${LOGO}" alt="Fixfy" width="60" style="display:block;margin:0 auto 12px auto;width:60px;height:auto;border:0;"><p style="margin:0 0 6px 0;font-family:${SANS};font-size:13px;line-height:19px;color:#FFFFFF;">Need a hand? Reply to this email, contact <a href="mailto:${FIXFY_CONTACT.email}" style="color:#FFFFFF;font-weight:600;">${FIXFY_CONTACT.email}</a> or call ${FIXFY_CONTACT.phone}.</p><p style="margin:0;font-family:${SANS};font-size:12px;line-height:18px;color:#FFFFFF;">${esc(FIXFY_CONTACT.legal)}${marketing}</p>`;

  const html = z
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FX.canvas};">${esc(e.preheader)}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:0;background:#EEF0F5;font-family:${SANS};"><tr><td align="center" style="border:0;padding:24px 12px;">` +
      `<div style="width:100%;max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:14px;overflow:hidden;text-align:left;">` +
      `<div style="background:${UNO.nav};padding:22px 28px 26px 28px;">${topoInner}</div>` +
      progresso +
      faixa +
      `<div style="padding:22px 28px 0 28px;">${corpoTexto}</div>` +
      detalhes +
      `<div style="padding:22px 28px 0 28px;">${botao}${links}</div>` +
      (e.transferencia ? `<div style="padding:0 28px;">${blocoTransferenciaHtml(e.transferencia, true)}</div>` : "") +
      (nota ? `<div style="padding:16px 28px 0 28px;">${nota}</div>` : "") +
      (assina ? `<div style="padding:0 28px;">${assina}</div>` : "") +
      `<div style="height:28px;font-size:0;line-height:0;">&nbsp;</div>` +
      (finoHtml ? `<div style="padding:16px 28px 8px 28px;background:#FAFAFB;border-top:1px solid ${UNO.line};">${finoHtml}</div>` : "") +
      `<div style="background:${FX.navy};padding:24px 28px 26px 28px;text-align:center;">${rodape}</div>` +
      `</div></td></tr></table>`
    : `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><title>&#8203;</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">
<style>@media screen and (max-width:600px){.fx-card{width:100% !important;border-radius:0 !important}.fx-pad{padding-left:20px !important;padding-right:20px !important}.fx-col{display:block !important;width:100% !important;border-left:0 !important}}</style></head>
<body style="margin:0;padding:0;background:#EEF0F5;font-family:${SANS};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:#EEF0F5;">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF0F5;"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="fx-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:14px;overflow:hidden;">
<tr><td class="fx-pad" bgcolor="${UNO.nav}" style="background:${UNO.nav};padding:22px 32px 26px 32px;">${topoInner}</td></tr>
${progresso}
${faixa}
<tr><td class="fx-pad" style="padding:22px 32px 0 32px;">${corpoTexto}</td></tr>
${detalhes}
${botao || links ? `<tr><td class="fx-pad" style="padding:22px 32px 0 32px;">${botao}${links}</td></tr>` : ""}
${e.transferencia ? blocoTransferenciaHtml(e.transferencia, false) : ""}
${nota ? `<tr><td class="fx-pad" style="padding:16px 32px 0 32px;">${nota}</td></tr>` : ""}
${assina ? `<tr><td class="fx-pad" style="padding:0 32px;">${assina}</td></tr>` : ""}
<tr><td style="padding:28px 0 0 0;font-size:0;line-height:0;">&nbsp;</td></tr>
${finoHtml ? `<tr><td class="fx-pad" style="padding:18px 32px 10px 32px;background:#FAFAFB;border-top:1px solid ${UNO.line};">${finoHtml}</td></tr>` : ""}
<tr><td class="fx-pad" bgcolor="${FX.navy}" style="background:${FX.navy};padding:24px 32px 26px 32px;text-align:center;">${rodape}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    e.estado ? e.estado.texto.toUpperCase() : "",
    e.titulo,
    (e.metricas ?? []).filter((m) => m.valor?.trim()).length
      ? (e.metricas ?? []).filter((m) => m.valor?.trim()).map((m) => `${m.rotulo ? `${m.rotulo}: ` : ""}${m.valor}${m.sub ? `, ${m.sub}` : ""}`).join("\n")
      : e.destaque
        ? [e.destaque.linha1, e.destaque.linha2].filter(Boolean).join(", ")
        : "",
    e.destaque?.riscado ? `Previously: ${e.destaque.riscado}` : "",
    "",
    e.saudacao,
    "",
    ...e.paragrafos.flatMap((p) => [p, ""]),
    ...linhas.map(([r, v]) => `${r}: ${v}`),
    cta ? `\n${cta.label}: ${cta.url}` : "",
    ...secundarios.map((l) => `${l.label}: ${urlSegura(l.url)}`),
    e.transferencia && e.transferencia.dadosBancarios.length
      ? [
          "",
          `Prefer a bank transfer? Use the details below and quote ${e.transferencia.referencia}. Once you’ve made the transfer, reply with the payment date and reference so we can check receipt.${e.transferencia.booking ? " We’ll confirm your booking once payment has been received and checked." : ""}`,
          ...e.transferencia.dadosBancarios.map(([r, v]) => `${r}: ${v}`),
          `Reference: ${e.transferencia.referencia}`,
        ].join("\n")
      : "",
    e.nota ? `\n${e.nota}` : "",
    assinatura ? `\n${assinatura}` : "",
    fino.length ? `\n${fino.join("\n")}` : "",
    "",
    `Need a hand? Reply to this email, contact ${FIXFY_CONTACT.email} or call ${FIXFY_CONTACT.phone}.`,
    FIXFY_CONTACT.legal,
    e.marketing ? `${e.marketing.motivo} Unsubscribe: ${e.marketing.descadastroUrl}` : "",
  ]
    .filter((l, i, arr) => !(l === "" && arr[i - 1] === ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { html, text };
}

/**
 * Moldura leve, de pessoa para pessoa: os follow-ups de cotação e de lead. Sem
 * estado, sem título, sem linhas: parece um e-mail escrito, com o logo pequeno
 * e o rodapé de contato.
 */
export function emailPessoal(e: { preheader: string; saudacao: string; paragrafos: string[]; cta?: { label: string; url: string | null | undefined } | null; linksSecundarios?: Array<{ label: string; url: string | null | undefined }>; assinatura?: string | null; zendesk?: boolean }): { html: string; text: string } {
  const z = Boolean(e.zendesk);
  const cta = e.cta && urlSegura(e.cta.url) ? { label: e.cta.label, url: urlSegura(e.cta.url)! } : null;
  const sec = (e.linksSecundarios ?? []).filter((l) => urlSegura(l.url));
  const assinatura = e.assinatura?.trim() ? e.assinatura.trim() : null;
  const ps = [e.saudacao, ...e.paragrafos].map((p) => `<p style="margin:0 0 14px 0;font-size:16px;line-height:24px;color:${FX.text};">${esc(p)}</p>`).join("");
  const botao = cta
    ? `<p style="margin:6px 0 14px 0;"><a href="${esc(cta.url)}" style="display:inline-block;background:${FX.navy};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:600;padding:12px 22px;border-radius:8px;">${esc(cta.label)}</a></p>`
    : "";
  const links = sec.length ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:20px;">${sec.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:600;">${esc(l.label)}</a>`).join(" &middot; ")}</p>` : "";
  const assina = assinatura ? `<p style="margin:0;font-size:16px;line-height:24px;color:${FX.text};">${esc(assinatura)}</p>` : "";
  const rodape = `<p style="margin:0;font-size:12px;line-height:18px;color:#FFFFFF;">Need a hand? Reply to this email, contact <a href="mailto:${FIXFY_CONTACT.email}" style="color:#FFFFFF;font-weight:600;">${FIXFY_CONTACT.email}</a> or call ${FIXFY_CONTACT.phone}.<br>${esc(FIXFY_CONTACT.legal)}</p>`;
  // Mesma família da Ideia B, mas leve: faixa navy fina com o logo, texto corrido, rodapé navy.
  const miolo = `<div style="max-width:560px;margin:0 auto;padding:24px 20px;text-align:left;font-family:${SANS};"><div style="background:#0A0A28;border-radius:10px;padding:14px 18px;margin:0 0 20px 0;"><img src="${LOGO}" alt="Fixfy" width="60" style="display:block;width:60px;height:auto;border:0;"></div>${ps}${botao}${links}${assina}<div style="margin:24px 0 0 0;padding:16px 18px;background:${FX.navy};border-radius:10px;text-align:center;">${rodape}</div></div>`;
  const html = z
    ? `<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;">${esc(e.preheader)}</div>${miolo}`
    : `<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light only"><title>&#8203;</title></head><body style="margin:0;padding:0;background:#FFFFFF;"><div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;">${esc(e.preheader)}</div>${miolo}</body></html>`;
  const text = [
    e.saudacao,
    "",
    ...e.paragrafos.flatMap((p) => [p, ""]),
    cta ? `${cta.label}: ${cta.url}` : "",
    ...sec.map((l) => `${l.label}: ${urlSegura(l.url)}`),
    assinatura ?? "",
    "",
    `Need a hand? Reply to this email, contact ${FIXFY_CONTACT.email} or call ${FIXFY_CONTACT.phone}.`,
    FIXFY_CONTACT.legal,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { html, text };
}
