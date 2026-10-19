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
 * `2026-10-21` ou um ISO vira `Wednesday 21 October 2026`, no fuso de
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
  const partes = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: tz }).formatToParts(d);
  const v = (t: string) => partes.find((x) => x.type === t)?.value ?? "";
  return `${v("weekday")} ${v("day")} ${v("month")} ${v("year")}`;
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

export type EmailFixfy = {
  preheader: string;
  estado?: Estado | null;
  titulo: string;
  /** Destaque grande: data e janela, ou valor e vencimento. */
  destaque?: { linha1: string; linha2?: string | null; riscado?: string | null } | null;
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

const corDoEstado = (c: Estado["cor"]) =>
  c === "orange" ? FX.orange : c === "green" ? FX.green : c === "muted" ? FX.muted : FX.navy;

function blocoTransferenciaHtml(t: Transferencia, zendesk: boolean): string {
  const linhas = t.dadosBancarios.filter(([, v]) => String(v ?? "").trim());
  if (!linhas.length) return "";
  const frase = `Prefer a bank transfer? Use the details below and quote ${esc(t.referencia)}. Once you’ve made the transfer, reply with the payment date and reference so we can check receipt.${t.booking ? " We’ll confirm your booking once payment has been received and checked." : ""}`;
  const corpo = linhas
    .map(([r, v]) => `<p style="margin:0 0 4px 0;font-size:14px;line-height:20px;color:${FX.text};"><span style="color:${FX.muted};">${esc(r)}:</span> <strong>${esc(v)}</strong></p>`)
    .join("");
  const caixa = `<p style="margin:0 0 10px 0;font-size:14px;line-height:21px;color:${FX.text};">${frase}</p>${corpo}<p style="margin:4px 0 0 0;font-size:14px;line-height:20px;color:${FX.text};"><span style="color:${FX.muted};">Reference:</span> <strong>${esc(t.referencia)}</strong></p>`;
  return zendesk
    ? `<div style="margin:16px 0 0 0;padding:16px;background:${FX.soft};border-radius:10px;">${caixa}</div>`
    : `<tr><td style="padding:8px 32px 0 32px;"><div style="padding:16px;background:${FX.soft};border-radius:10px;">${caixa}</div></td></tr>`;
}

function linhasHtml(linhas: Array<[string, string]>, zendesk: boolean): string {
  if (!linhas.length) return "";
  if (zendesk) {
    return `<div style="margin:20px 0 4px 0;">${linhas
      .map(
        ([r, v]) =>
          `<p style="margin:0;padding:12px 0;border-top:1px solid ${FX.line};font-size:15px;line-height:22px;color:${FX.navy};font-weight:600;"><span style="display:inline-block;min-width:92px;font-size:13px;font-weight:400;color:${FX.muted};">${esc(r)}</span>${esc(v)}</p>`,
      )
      .join("")}</div>`;
  }
  return `<tr><td style="padding:12px 32px 4px 32px;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">${linhas
    .map(
      ([r, v]) =>
        `<tr><td style="padding:12px 12px 12px 0;border-top:1px solid ${FX.line};font-size:13px;line-height:20px;color:${FX.muted};width:110px;vertical-align:top;">${esc(r)}</td><td style="padding:12px 0;border-top:1px solid ${FX.line};font-size:15px;line-height:22px;color:${FX.navy};font-weight:600;">${esc(v)}</td></tr>`,
    )
    .join("")}</table></td></tr>`;
}

/** HTML e texto do mesmo conteúdo (handoff: "Generate HTML and plain text from the same copy"). */
export function emailFixfy(e: EmailFixfy): { html: string; text: string } {
  const z = Boolean(e.zendesk);
  const linhas = (e.linhas ?? []).filter((l): l is [string, string] => Boolean(l[1] && String(l[1]).trim()));
  const cta = e.cta && urlSegura(e.cta.url) ? { label: e.cta.label, url: urlSegura(e.cta.url)! } : null;
  const secundarios = (e.linksSecundarios ?? []).filter((l) => urlSegura(l.url));
  const assinatura = e.assinatura?.trim() ? e.assinatura.trim() : null;
  const pad = z ? "" : "padding:0 32px;";

  const estado = e.estado
    ? `<p style="margin:0 0 6px 0;font-size:13px;font-weight:700;letter-spacing:1px;color:${corDoEstado(e.estado.cor)};text-transform:uppercase;">${esc(e.estado.texto)}</p>`
    : "";
  const destaque = e.destaque
    ? `<p style="margin:10px 0 0 0;font-size:17px;line-height:24px;color:${FX.text};">${esc(e.destaque.linha1)}${e.destaque.linha2 ? `<br><strong style="color:${FX.navy};">${esc(e.destaque.linha2)}</strong>` : ""}</p>${e.destaque.riscado ? `<p style="margin:6px 0 0 0;font-size:14px;line-height:20px;color:${FX.faint};">Previously <span style="text-decoration:line-through;">${esc(e.destaque.riscado)}</span></p>` : ""}`
    : "";
  const topo = `${estado}<h1 style="margin:0;font-size:26px;line-height:32px;font-weight:800;color:${FX.navy};">${esc(e.titulo)}</h1>${destaque}`;
  const corpo =
    `<p style="margin:22px 0 12px 0;font-size:16px;line-height:24px;color:${FX.text};">${esc(e.saudacao)}</p>` +
    e.paragrafos.map((p) => `<p style="margin:0 0 12px 0;font-size:16px;line-height:24px;color:${FX.text};">${esc(p)}</p>`).join("");
  const botao = cta
    ? `<a href="${esc(cta.url)}" style="display:block;background:${FX.orange};color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;line-height:20px;padding:14px 0;min-height:44px;box-sizing:border-box;border-radius:10px;text-align:center;">${esc(cta.label)}</a>`
    : "";
  const links = secundarios.length
    ? `<p style="margin:12px 0 0 0;font-size:14px;line-height:20px;text-align:center;color:${FX.muted};">${secundarios.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:600;">${esc(l.label)}</a>`).join(" &middot; ")}</p>`
    : "";
  const nota = e.nota
    ? `<p style="margin:0;padding:14px 16px;background:${FX.soft};border-radius:10px;font-size:14px;line-height:21px;color:${FX.text};">${esc(e.nota)}</p>`
    : "";
  const assina = assinatura ? `<p style="margin:16px 0 0 0;font-size:16px;line-height:24px;color:${FX.text};">${esc(assinatura)}</p>` : "";
  const fino = (e.letraPequena ?? []).filter(Boolean);
  const finoHtml = fino.length
    ? fino.map((t) => `<p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:${FX.muted};">${esc(t)}</p>`).join("")
    : "";
  const marketing = e.marketing && urlSegura(e.marketing.descadastroUrl)
    ? `<br>${esc(e.marketing.motivo)} <a href="${esc(urlSegura(e.marketing.descadastroUrl)!)}" style="color:#FFFFFF;">Unsubscribe</a>`
    : "";
  // Rodapé navy com letra branca em todos (dono, 20/10/2026).
  const rodape = `<p style="margin:0 0 8px 0;font-size:13px;line-height:19px;color:#FFFFFF;">Need a hand? Reply to this email, contact <a href="mailto:${FIXFY_CONTACT.email}" style="color:#FFFFFF;font-weight:600;">${FIXFY_CONTACT.email}</a> or call ${FIXFY_CONTACT.phone}.</p><p style="margin:0;font-size:12px;line-height:18px;color:#FFFFFF;">${esc(FIXFY_CONTACT.legal)}${marketing}</p>`;

  const html = z
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${FX.canvas};">${esc(e.preheader)}</div>` +
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border:0;background:${FX.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;"><tr><td align="center" style="border:0;padding:24px 12px;">` +
      `<div style="width:100%;max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;text-align:left;">` +
      `<div style="background:${FX.navy};padding:18px 28px;"><img src="${LOGO}" alt="Fixfy" width="72" height="31" style="display:block;width:72px;height:31px;border:0;"></div>` +
      `<div style="padding:28px 28px 8px 28px;">${topo}${corpo}${linhasHtml(linhas, true)}${botao ? `<div style="margin:16px 0 0 0;">${botao}</div>` : ""}${links}${e.transferencia ? blocoTransferenciaHtml(e.transferencia, true) : ""}${nota ? `<div style="margin:16px 0 0 0;">${nota}</div>` : ""}${assina}</div>` +
      (finoHtml ? `<div style="padding:16px 28px 8px 28px;background:#FAFAFB;border-top:1px solid ${FX.line};">${finoHtml}</div>` : "") +
      `<div style="background:${FX.navy};padding:20px 28px 24px 28px;text-align:center;">${rodape}</div>` +
      `</div></td></tr></table>`
    : `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><title>&#8203;</title>
<style>@media screen and (max-width:600px){.fx-card{width:100% !important;border-radius:0 !important}.fx-pad{padding-left:20px !important;padding-right:20px !important}}</style></head>
<body style="margin:0;padding:0;background:${FX.canvas};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${FX.canvas};">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${FX.canvas};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" class="fx-card" width="600" cellpadding="0" cellspacing="0" border="0" style="width:600px;max-width:600px;background:#FFFFFF;border-radius:16px;overflow:hidden;">
<tr><td class="fx-pad" bgcolor="${FX.navy}" style="background:${FX.navy};padding:18px 32px;"><img src="${LOGO}" alt="Fixfy" width="72" style="display:block;width:72px;height:auto;border:0;"></td></tr>
<tr><td class="fx-pad" style="padding:28px 32px 4px 32px;">${topo}${corpo}</td></tr>
${linhasHtml(linhas, false)}
${botao ? `<tr><td class="fx-pad" style="padding:16px 32px 0 32px;">${botao}${links}</td></tr>` : links ? `<tr><td class="fx-pad" style="padding:8px 32px 0 32px;">${links}</td></tr>` : ""}
${e.transferencia ? blocoTransferenciaHtml(e.transferencia, false) : ""}
${nota ? `<tr><td class="fx-pad" style="padding:16px 32px 0 32px;">${nota}</td></tr>` : ""}
${assina ? `<tr><td class="fx-pad" style="padding:4px 32px 24px 32px;">${assina}</td></tr>` : `<tr><td style="padding:12px 0 0 0;font-size:1px;line-height:1px;">&nbsp;</td></tr>`}
${finoHtml ? `<tr><td class="fx-pad" style="${pad}padding-top:18px;padding-bottom:10px;background:#FAFAFB;border-top:1px solid ${FX.line};">${finoHtml}</td></tr>` : ""}
<tr><td class="fx-pad" bgcolor="${FX.navy}" style="background:${FX.navy};padding:20px 32px 24px 32px;text-align:center;">${rodape}</td></tr>
</table></td></tr></table></body></html>`;

  const text = [
    e.estado ? e.estado.texto.toUpperCase() : "",
    e.titulo,
    e.destaque ? [e.destaque.linha1, e.destaque.linha2].filter(Boolean).join(", ") : "",
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
    ? `<p style="margin:6px 0 14px 0;"><a href="${esc(cta.url)}" style="display:inline-block;background:${FX.orange};color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:700;padding:12px 22px;border-radius:10px;">${esc(cta.label)}</a></p>`
    : "";
  const links = sec.length ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:20px;">${sec.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:600;">${esc(l.label)}</a>`).join(" &middot; ")}</p>` : "";
  const assina = assinatura ? `<p style="margin:0;font-size:16px;line-height:24px;color:${FX.text};">${esc(assinatura)}</p>` : "";
  const rodape = `<p style="margin:0;font-size:12px;line-height:18px;color:#FFFFFF;">Need a hand? Reply to this email, contact <a href="mailto:${FIXFY_CONTACT.email}" style="color:#FFFFFF;font-weight:600;">${FIXFY_CONTACT.email}</a> or call ${FIXFY_CONTACT.phone}.<br>${esc(FIXFY_CONTACT.legal)}</p>`;
  const miolo = `<div style="max-width:560px;margin:0 auto;padding:24px 20px;text-align:left;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;">${ps}${botao}${links}${assina}<div style="margin:24px 0 0 0;padding:16px 18px;background:${FX.navy};border-radius:10px;text-align:center;">${rodape}</div></div>`;
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
