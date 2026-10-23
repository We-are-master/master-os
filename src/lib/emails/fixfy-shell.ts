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

export type Estado = { texto: string; cor?: "navy" | "orange" | "green" | "muted" | "red" };

export type Transferencia = {
  /** Linhas da conta bancária verificada, da configuração (nunca de exemplo). */
  dadosBancarios: Array<[string, string]>;
  referencia: string;
  /** Só nos e-mails de booking: "We'll confirm your booking once payment has been received and checked." */
  booking?: boolean;
};

/** Uma métrica da faixa de métricas (como a do OS): rótulo pequeno, valor grande, linha embaixo. */
export type Metrica = {
  rotulo: string;
  valor: string;
  sub?: string | null;
  /** Valor riscado (data de visita cancelada, por exemplo). */
  riscado?: boolean;
};
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
  /**
   * Fotos do trabalho (e-mail final, dono 22/10/2026): até 3 lado a lado e, embaixo,
   * o link do report completo (o PDF). URLs públicas e duráveis (assinadas por semanas).
   */
  fotos?: { lista: Array<{ url: string; alt?: string | null }>; link?: { label: string; url: string | null | undefined } | null } | null;
  /** Bloco "What we did." com o texto do parceiro e linhas curtas. */
  resumo?: { titulo: string; texto?: string | null; linhas?: Array<[string, string | null | undefined]> } | null;
  /** Comentário público do Zendesk: sem tabela interna. */
  zendesk?: boolean;
};

const SANS = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/**
 * Layout do "Welcome to Fixfy" (dono, 22/10/2026: "deixa tudo no padrão novo, moderno"):
 * cartão branco sobre #F5F5F7, logo navy no topo, estado em laranja (Inter, sem
 * manuscrito: o Caveat fica só no marketing), título grande navy, destaque num bloco
 * navy, detalhes num quadro claro, botão laranja, caixa de ajuda cinza e rodapé claro.
 */
// Recortado (sem a margem do PNG do site), servido pelo próprio OS: public/logos.
const LOGO_NAVY = "https://app.getfixfy.com/logos/fixfy-primary-navy-trim.png";
const W = {
  ink: "#303044",
  ink2: "#505268",
  ink3: "#7A7C92",
  line: "#EEEEF2",
  canvas: "#F5F5F7",
  onNavy: "#B9BAD6",
  orangeSoft: "#FF7A3D",
} as const;

const corDoEstado = (c: Estado["cor"]) => (c === "green" ? FX.green : c === "muted" ? W.ink3 : FX.orange);

function blocoTransferenciaHtml(t: Transferencia): string {
  const linhas = t.dadosBancarios.filter(([, v]) => String(v ?? "").trim());
  if (!linhas.length) return "";
  const frase = `Prefer a bank transfer? Use the details below and quote ${esc(t.referencia)}. Once you’ve made the transfer, reply with the payment date and reference so we can check receipt.${t.booking ? " We’ll confirm your booking once payment has been received and checked." : ""}`;
  const corpo = [...linhas, ["Reference", t.referencia] as [string, string]]
    .map(([r, v]) => `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:14px;line-height:20px;color:${FX.navy};"><span style="color:${W.ink3};">${esc(r)}:</span> <strong style="font-weight:700;">${esc(v)}</strong></p>`)
    .join("");
  return `<div style="padding:18px 20px;background:${W.canvas};border-radius:12px;"><p style="margin:0 0 10px 0;font-family:${SANS};font-size:14px;line-height:21px;color:${W.ink2};">${frase}</p>${corpo}</div>`;
}

/**
 * HTML e texto do mesmo conteúdo (handoff: "Generate HTML and plain text from the same copy").
 * `zendesk: true` monta tudo em `div` (o visualizador do Zendesk desenha borda em toda célula).
 */
export function emailFixfy(e: EmailFixfy): { html: string; text: string } {
  const z = Boolean(e.zendesk);
  const linhas = (e.linhas ?? []).filter((l): l is [string, string] => Boolean(l[1] && String(l[1]).trim()));
  const cta = e.cta && urlSegura(e.cta.url) ? { label: e.cta.label, url: urlSegura(e.cta.url)! } : null;
  const secundarios = (e.linksSecundarios ?? []).filter((l) => urlSegura(l.url));
  const assinatura = e.assinatura?.trim() ? e.assinatura.trim() : null;

  const metricas: Metrica[] = (e.metricas ?? []).filter((m) => m.valor?.trim()).length
    ? (e.metricas ?? []).filter((m) => m.valor?.trim())
    : e.destaque?.linha1
      ? [{ rotulo: "", valor: e.destaque.linha1, sub: e.destaque.linha2 ?? null }]
      : [];
  const riscado = e.destaque?.riscado?.trim() || null;
  const passos = (e.passos ?? []).filter((p) => p.nome.trim());

  // Cada bloco é um `div` com o recuo lateral; no e-mail completo ele vai dentro de uma linha da tabela.
  const bloco = (conteudo: string, topo = 0, lado = 32) =>
    z
      ? `<div style="padding:${topo}px ${lado - 4}px 0 ${lado - 4}px;">${conteudo}</div>`
      : `<tr><td class="fx-pad" style="padding:${topo}px ${lado}px 0 ${lado}px;">${conteudo}</td></tr>`;

  // ─── topo: logo navy no branco + divisória ───
  const topo =
    bloco(`<img src="${LOGO_NAVY}" alt="Fixfy" width="112" style="display:block;width:112px;height:auto;border:0;">`, 26) +
    bloco(`<div style="height:1px;line-height:1px;font-size:0;background:${W.line};margin-top:18px;">&nbsp;</div>`, 0);

  // ─── abertura: estado laranja, título grande, saudação e texto ───
  // Vermelho = dinheiro em aberto (dono, 22/10/2026): vira chip, para saltar aos olhos.
  const estado = !e.estado
    ? ""
    : e.estado.cor === "red"
      ? `<p style="margin:0 0 10px 0;"><span style="display:inline-block;background:#FDECEC;color:#C62828;border:1px solid #F5C2C2;font-family:${SANS};font-size:13px;line-height:18px;font-weight:700;padding:4px 12px;border-radius:999px;">${esc(e.estado.texto)}</span></p>`
      : `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;letter-spacing:0.01em;color:${corDoEstado(e.estado.cor)};">${esc(e.estado.texto)}</p>`;
  const titulo = `<h1 class="fx-h1" style="margin:0 0 18px 0;font-family:${SANS};font-size:36px;line-height:40px;font-weight:800;letter-spacing:-0.02em;color:${FX.navy};">${esc(e.titulo)}</h1>`;
  const texto =
    `<p style="margin:0 0 10px 0;font-family:${SANS};font-size:17px;line-height:26px;color:${W.ink};">${esc(e.saudacao)}</p>` +
    e.paragrafos.map((p) => `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:17px;line-height:26px;color:${W.ink};">${esc(p)}</p>`).join("");
  const abertura = bloco(`${estado}${titulo}${texto}`, 26);

  // ─── destaque navy: métricas (data e janela, valor e vencimento) e progresso ───
  const metricaHtml = (m: Metrica) =>
    `${m.rotulo ? `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:13px;line-height:16px;color:${W.onNavy};">${esc(m.rotulo)}</p>` : ""}<p class="fx-big" style="margin:0;font-family:${SANS};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.01em;color:#FFFFFF;${m.riscado ? "text-decoration:line-through;text-decoration-thickness:2px;opacity:0.7;" : ""}">${esc(m.valor)}</p>${m.sub ? `<p style="margin:4px 0 0 0;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;color:${W.orangeSoft};">${esc(m.sub)}</p>` : ""}`;
  const colunasMetricas = z
    ? metricas.map((m, i) => `<div style="display:inline-block;vertical-align:top;width:${Math.floor(100 / metricas.length)}%;box-sizing:border-box;padding:0 ${i < metricas.length - 1 ? 14 : 0}px 0 0;">${metricaHtml(m)}</div>`).join("")
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${metricas.map((m, i) => `<td class="fx-col" valign="top" style="padding:0 ${i < metricas.length - 1 ? 16 : 0}px 0 0;">${metricaHtml(m)}</td>`).join("")}</tr></table>`;
  const corPasso = (p: Passo) => (p.estado === "atual" ? FX.orange : p.estado === "feito" ? "#FFFFFF" : "rgba(255,255,255,0.18)");
  const passoHtml = (p: Passo) =>
    `<div style="height:4px;border-radius:2px;background:${corPasso(p)};font-size:0;line-height:0;">&nbsp;</div><p style="margin:7px 0 0 0;font-family:${SANS};font-size:11px;line-height:14px;font-weight:${p.estado === "atual" ? 700 : 500};color:${p.estado === "futuro" ? W.onNavy : "#FFFFFF"};">${esc(p.nome)}</p>`;
  const largura = passos.length ? Math.floor(100 / passos.length) : 0;
  const progresso = !passos.length
    ? ""
    : z
      ? `<div style="margin-top:${metricas.length ? 20 : 0}px;font-size:0;">${passos.map((p) => `<div style="display:inline-block;vertical-align:top;width:${largura}%;box-sizing:border-box;padding:0 3px;">${passoHtml(p)}</div>`).join("")}</div>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-top:${metricas.length ? 20 : 0}px;"><tr>${passos.map((p) => `<td valign="top" width="${largura}%" style="padding:0 3px;">${passoHtml(p)}</td>`).join("")}</tr></table>`;
  const riscadoHtml = riscado
    ? `<p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:18px;color:${W.onNavy};">Previously <span style="text-decoration:line-through;">${esc(riscado)}</span></p>`
    : "";
  const destaque =
    metricas.length || passos.length
      ? bloco(`<div style="background:${FX.navy};border-radius:12px;padding:22px 22px 22px 22px;">${metricas.length ? colunasMetricas : ""}${riscadoHtml}${progresso}</div>`, 18, 24)
      : "";

  // ─── detalhes: quadro claro, uma linha por item ───
  const detalhes = linhas.length
    ? bloco(
        `<div style="border:1px solid ${W.line};border-radius:12px;">${linhas
          .map(
            ([r, v], i) =>
              `<div style="padding:12px 16px;${i < linhas.length - 1 ? `border-bottom:1px solid ${W.line};` : ""}"><p style="margin:0;font-family:${SANS};font-size:13px;line-height:16px;color:${W.ink3};">${esc(r)}</p><p style="margin:2px 0 0 0;font-family:${SANS};font-size:16px;line-height:22px;font-weight:700;color:${FX.navy};">${esc(v)}</p></div>`,
          )
          .join("")}</div>`,
        18,
        24,
      )
    : "";

  // ─── botão laranja e links ───
  const botao = cta
    ? `<a href="${esc(cta.url)}" style="display:block;background:${FX.orange};color:#FFFFFF;text-decoration:none;font-family:${SANS};font-size:17px;font-weight:700;line-height:22px;padding:15px 0;border-radius:10px;text-align:center;">${esc(cta.label)}</a>`
    : "";
  const links = secundarios.length
    ? `<p style="margin:12px 0 0 0;font-family:${SANS};font-size:14px;line-height:20px;text-align:center;color:${W.ink3};">${secundarios.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:700;">${esc(l.label)}</a>`).join(" &middot; ")}</p>`
    : "";
  const acao = botao || links ? bloco(`${botao}${links}`, 22, 24) : "";

  // ─── fotos do trabalho e o report completo ───
  const fotosLista = (e.fotos?.lista ?? []).filter((f) => urlSegura(f.url)).slice(0, 3);
  const linkDoReport = e.fotos?.link && urlSegura(e.fotos.link.url) ? { label: e.fotos.link.label, url: urlSegura(e.fotos.link.url)! } : null;
  const fotoHtml = (f: { url: string; alt?: string | null }, i: number) =>
    `<img src="${esc(urlSegura(f.url)!)}" width="176" alt="${esc(f.alt || `Photo ${i + 1} of the finished work`)}" style="display:block;width:100%;height:150px;object-fit:cover;border:0;border-radius:10px;">`;
  const gradeFotos = !fotosLista.length
    ? ""
    : z
      ? `<div style="font-size:0;">${fotosLista.map((f, i) => `<div style="display:inline-block;vertical-align:top;width:${Math.floor(100 / fotosLista.length)}%;box-sizing:border-box;padding:0 ${i < fotosLista.length - 1 ? 6 : 0}px 0 0;">${fotoHtml(f, i)}</div>`).join("")}</div>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${fotosLista.map((f, i) => `<td width="${Math.floor(100 / fotosLista.length)}%" valign="top" style="padding:0 ${i < fotosLista.length - 1 ? 6 : 0}px 0 0;">${fotoHtml(f, i)}</td>`).join("")}</tr></table>`;
  const botaoReport = linkDoReport
    ? `<div style="text-align:center;margin-top:${gradeFotos ? 14 : 0}px;"><a href="${esc(linkDoReport.url)}" style="display:inline-block;border:1.5px solid ${FX.navy};border-radius:10px;padding:11px 26px;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;color:${FX.navy};text-decoration:none;">${esc(linkDoReport.label)}</a></div>`
    : "";
  const fotos = gradeFotos || botaoReport ? bloco(`${gradeFotos}${botaoReport}`, 18, 24) : "";

  // ─── o que foi feito ───
  const linhasResumo = (e.resumo?.linhas ?? []).filter((l): l is [string, string] => Boolean(l[1] && String(l[1]).trim()));
  const resumo = e.resumo && (e.resumo.texto?.trim() || linhasResumo.length)
    ? bloco(
        `<p style="margin:0 0 10px 0;font-family:${SANS};font-size:24px;line-height:30px;font-weight:800;letter-spacing:-0.01em;color:${FX.navy};">${esc(e.resumo.titulo)}</p>` +
          (e.resumo.texto?.trim() ? `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:16px;line-height:25px;color:${W.ink};">${esc(e.resumo.texto.trim())}</p>` : "") +
          linhasResumo
            .map(([r, v], i) => `<div style="padding:10px 0;border-top:1px solid ${W.line};${i === linhasResumo.length - 1 ? `border-bottom:1px solid ${W.line};` : ""}font-family:${SANS};font-size:15px;line-height:20px;"><span style="color:${W.ink3};">${esc(r)}</span><span style="float:right;color:${FX.navy};font-weight:700;">${esc(v)}</span></div>`)
            .join(""),
        26,
        28,
      )
    : "";
  const transferencia = e.transferencia ? bloco(blocoTransferenciaHtml(e.transferencia), 14, 24) : "";
  const nota = e.nota
    ? bloco(`<div style="border-left:3px solid ${FX.orange};background:${W.canvas};border-radius:10px;padding:14px 16px;font-family:${SANS};font-size:15px;line-height:22px;color:${W.ink2};">${esc(e.nota)}</div>`, 16, 24)
    : "";
  const assina = assinatura ? bloco(`<p style="margin:0;font-family:${SANS};font-size:17px;line-height:26px;color:${W.ink};">${esc(assinatura)}</p>`, 16) : "";

  // ─── ajuda, letra pequena e rodapé claro ───
  const ajuda = bloco(
    `<div style="background:${W.canvas};border-radius:12px;padding:16px 18px;"><p style="margin:0;font-family:${SANS};font-size:16px;line-height:22px;font-weight:700;color:${FX.navy};">Need a hand?</p><p style="margin:3px 0 0 0;font-family:${SANS};font-size:15px;line-height:22px;color:${W.ink2};">Reply to this email or message us on WhatsApp at ${FIXFY_CONTACT.phone}. We’re happy to help.</p></div>`,
    22,
    24,
  );
  const fino = (e.letraPequena ?? []).filter(Boolean);
  const finoHtml = fino.length
    ? bloco(fino.map((t) => `<p style="margin:0 0 6px 0;font-family:${SANS};font-size:12px;line-height:18px;color:${W.ink3};">${esc(t)}</p>`).join(""), 18)
    : "";
  const marketing = e.marketing && urlSegura(e.marketing.descadastroUrl)
    ? `<p style="margin:6px 0 0 0;font-family:${SANS};font-size:12px;line-height:18px;color:${FX.faint};">${esc(e.marketing.motivo)} <a href="${esc(urlSegura(e.marketing.descadastroUrl)!)}" style="color:${W.ink3};text-decoration:underline;">Unsubscribe</a></p>`
    : "";
  const rodapeInner =
    `<img src="${LOGO_NAVY}" alt="Fixfy" width="84" style="display:block;margin:0 auto 10px auto;width:84px;height:auto;border:0;">` +
    `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:13px;line-height:18px;color:${W.ink3};">Home repairs and maintenance across London</p>` +
    `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:13px;line-height:18px;"><a href="https://www.getfixfy.com" style="color:${W.ink2};text-decoration:none;">getfixfy.com</a> <span style="color:#B5B6C4;">&middot;</span> <a href="mailto:${FIXFY_CONTACT.email}" style="color:${W.ink2};text-decoration:none;">${FIXFY_CONTACT.email}</a> <span style="color:#B5B6C4;">&middot;</span> <span style="color:${W.ink2};">${FIXFY_CONTACT.phone}</span></p>` +
    `<p style="margin:0;font-family:${SANS};font-size:12px;line-height:18px;color:${FX.faint};">${esc(FIXFY_CONTACT.legal)}</p>${marketing}`;
  const rodape = z
    ? `<div style="padding:28px 24px 28px 24px;text-align:center;">${rodapeInner}</div>`
    : `<tr><td align="center" style="padding:28px 24px 28px 24px;text-align:center;">${rodapeInner}</td></tr>`;

  // Com fotos (e-mail final): fotos e "What we did." vêm antes do resumo do pagamento.
  const miolo = topo + abertura + fotos + resumo + destaque + detalhes + acao + transferencia + nota + assina + ajuda + finoHtml + rodape;

  const html = z
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${W.canvas};">${esc(e.preheader)}</div>` +
      `<div style="background:${W.canvas};padding:24px 12px;font-family:${SANS};"><div style="width:100%;max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;text-align:left;">${miolo}</div></div>`
    : `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>&#8203;</title>
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>:root{color-scheme:light only}@media screen and (max-width:620px){.fx-pad{padding-left:20px !important;padding-right:20px !important}.fx-h1{font-size:30px !important;line-height:34px !important}.fx-big{font-size:21px !important;line-height:27px !important}.fx-col{display:block !important;width:100% !important;padding:0 0 14px 0 !important}}</style></head>
<body style="margin:0;padding:0;background:${W.canvas};font-family:${SANS};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${W.canvas};">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${W.canvas};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;">
${miolo}
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
    linkDoReport ? `${linkDoReport.label}: ${linkDoReport.url}\n` : "",
    e.resumo?.texto?.trim() ? `${e.resumo.titulo}\n${e.resumo.texto.trim()}\n` : "",
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
    ? `<p style="margin:6px 0 14px 0;"><a href="${esc(cta.url)}" style="display:inline-block;background:${FX.orange};color:#FFFFFF;text-decoration:none;font-size:16px;font-weight:700;padding:13px 24px;border-radius:10px;">${esc(cta.label)}</a></p>`
    : "";
  const links = sec.length ? `<p style="margin:0 0 14px 0;font-size:14px;line-height:20px;">${sec.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:600;">${esc(l.label)}</a>`).join(" &middot; ")}</p>` : "";
  const assina = assinatura ? `<p style="margin:0;font-size:16px;line-height:24px;color:${FX.text};">${esc(assinatura)}</p>` : "";
  const rodape = `<p style="margin:0;font-size:12px;line-height:18px;color:${FX.faint};">Need a hand? Reply to this email, contact <a href="mailto:${FIXFY_CONTACT.email}" style="color:${FX.navy};font-weight:600;">${FIXFY_CONTACT.email}</a> or call ${FIXFY_CONTACT.phone}.<br>${esc(FIXFY_CONTACT.legal)}</p>`;
  // Mesma família do Welcome, mas leve (parece e-mail escrito): logo navy, texto corrido, rodapé claro.
  const miolo = `<div style="max-width:560px;margin:0 auto;padding:24px 20px;text-align:left;font-family:${SANS};"><img src="${LOGO_NAVY}" alt="Fixfy" width="92" style="display:block;width:92px;height:auto;border:0;margin:0 0 18px 0;">${ps}${botao}${links}${assina}<div style="margin:24px 0 0 0;padding:16px 0 0 0;border-top:1px solid ${W.line};text-align:left;">${rodape}</div></div>`;
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
