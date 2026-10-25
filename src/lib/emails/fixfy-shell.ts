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
  /** O número não aparece nos e-mails (dono, 25/10/2026): só "WhatsApp" com link. */
  whatsapp: "https://wa.me/442045384668",
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

/** Uma hora em Londres no relógio de 24h: `09:00`, `13:30`. */
export function hora24(iso: string | Date | null | undefined): string | null {
  if (!iso) return null;
  const d = iso instanceof Date ? iso : new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const partes = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London" }).formatToParts(d);
  const h = partes.find((x) => x.type === "hour")?.value ?? "00";
  const min = partes.find((x) => x.type === "minute")?.value ?? "00";
  return `${h.padStart(2, "0")}:${min}`;
}

/**
 * Janela de chegada no formato único dos e-mails (dono, 23/10/2026): 24h,
 * compacta, com hífen: `09:00-12:00`. Null sem as duas pontas.
 */
export function janelaTexto(inicio: string | Date | null | undefined, fim: string | Date | null | undefined): string | null {
  const a = hora24(inicio);
  const b = hora24(fim);
  return a && b ? `${a}-${b}` : null;
}

/** "9", "30", "pm" (ou "midday"/"noon"/"midnight") viram `21:30`. Null se não for hora. */
export function horaDeTextoPara24(h: string, mm?: string | null, ap?: string | null): string | null {
  const palavra = h.toLowerCase();
  if (palavra === "midday" || palavra === "noon") return "12:00";
  if (palavra === "midnight") return "00:00";
  let n = Number(h);
  if (!Number.isFinite(n) || n > 24) return null;
  const p = ap?.toLowerCase();
  if (p === "pm" && n < 12) n += 12;
  if (p === "am" && n === 12) n = 0;
  return `${String(n % 24).padStart(2, "0")}:${mm && /^\d{2}$/.test(mm) ? mm : "00"}`;
}

const HORA_RE = "(\\d{1,2}|midday|noon|midnight)(?:[:.](\\d{2}))?\\s*(am|pm)?";

/**
 * Janela que já chegou como texto (`9AM – 12PM`, `09:00-12:00`, `between 9am
 * and midday`) no mesmo formato: `09:00-12:00`.
 */
export function janelaDeTexto(texto: string | null | undefined): string | null {
  const t = String(texto ?? "").trim();
  if (!t || /^to be confirmed$/i.test(t)) return null;
  const m = t.match(new RegExp(`${HORA_RE}\\s*(?:[–—-]|to|and)\\s*${HORA_RE}`, "i"));
  if (!m) return t;
  const a = horaDeTextoPara24(m[1]!, m[2], m[3] ?? (m[6] && !/^(midday|noon|midnight)$/i.test(m[1]!) && Number(m[1]) < Number(m[4]) && Number(m[4]) !== 12 ? m[6] : null));
  const b = horaDeTextoPara24(m[4]!, m[5], m[6]);
  return a && b ? `${a}-${b}` : t;
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

/**
 * `chip: true` desenha o estado como pílula na cor pedida (e-mails ao parceiro,
 * 23/10/2026). Vermelho é sempre pílula; sem `chip`, as outras cores seguem o
 * texto laranja/verde de sempre (e-mails ao cliente intocados).
 */
export type Estado = { texto: string; cor?: "navy" | "orange" | "green" | "muted" | "red"; chip?: boolean };

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
/** `aprovado`: régua verde (passo final alcançado nos e-mails ao parceiro); opt-in. */
export type Passo = { nome: string; estado: "feito" | "atual" | "futuro" | "aprovado" };

/**
 * Quadro colorido suave (dono, 23/10/2026, design system UNO): âmbar = informação
 * que pede atenção (o que o cliente relatou, o prazo), vermelho = alerta (dinheiro
 * parado, relatório atrasado), azul = ajuda ("Questions? Reply…"), neutro = lista.
 * `lugar`: "topo" logo depois do texto, "meio" (padrão) depois dos detalhes,
 * "fim" depois do botão.
 */
export type Aviso = {
  tom: "amber" | "red" | "blue" | "neutral";
  icone?: string | null;
  titulo?: string | null;
  texto?: string | null;
  itens?: string[] | null;
  /** Linha pequena depois da lista. */
  nota?: string | null;
  /** Link no fim do texto ("... message us on WhatsApp."). */
  link?: { label: string; url: string } | null;
  lugar?: "topo" | "meio" | "fim";
};

/**
 * Faixa de status no topo do cartão (dono, 24/10/2026: "as mesmas cores dos chips
 * do OS"). Azul = alguém precisa agir, vermelho = pagamento falhou ou venceu,
 * verde = pago, âmbar = aguardando pagamento (entrada, fatura, parcela).
 */
export type Faixa = { tipo: "acao" | "falhou" | "pago" | "aguardando"; texto?: string | null; nota?: string | null };

/** Cartão curto com ícone ("o que fazer", "o que mandar"), três lado a lado. */
export type Cartao = { icone: string; titulo: string; texto?: string | null };

export type EmailFixfy = {
  preheader: string;
  estado?: Estado | null;
  /** Faixa colorida no topo. Sem ela, deduzida do estado (ver faixaDoEstado). `null` desliga. */
  faixa?: Faixa | null;
  /** Até três cartões com ícone depois dos detalhes. */
  cartoes?: Cartao[] | null;
  titulo: string;
  /** Destaque grande: data e janela, ou valor e vencimento. */
  destaque?: { linha1: string; linha2?: string | null; riscado?: string | null } | null;
  /** Faixa de métricas (data, janela, valor, vencimento). Sem ela, o destaque vira uma métrica. */
  metricas?: Metrica[] | null;
  /** Faixa de progresso do job; o passo "atual" leva a régua coral. */
  passos?: Passo[] | null;
  /** Vazia (""), a linha some (e-mails ao parceiro não têm saudação). */
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
  fotos?: {
    lista: Array<{ url: string; alt?: string | null }>;
    link?: { label: string; url: string | null | undefined } | null;
    /** Sem foto nenhuma, esta linha neutra no lugar da grade ("No photos available"); opt-in. */
    vazio?: string | null;
  } | null;
  /** Bloco "What we did." com o texto do parceiro e linhas curtas. */
  resumo?: { titulo: string; texto?: string | null; linhas?: Array<[string, string | null | undefined]> } | null;
  /**
   * HTML pronto (já escapado por quem monta) logo antes do botão, depois dos
   * detalhes: as fotos do local nos e-mails ao parceiro. `text` entra antes do link.
   */
  antesDoBotao?: { html: string; text: string } | null;
  /** Esconde o quadro "Need a hand?" (e-mails ao parceiro: só as infos). */
  semAjuda?: boolean;
  /** Quadros coloridos (âmbar, vermelho, azul, neutro). */
  avisos?: Aviso[] | null;
  /**
   * Valores do quadro de detalhes em peso médio, cor de texto e quebra de linha
   * preservada (e-mails ao parceiro: "menos negrito"). Sem ele, o de sempre.
   */
  detalhesLeves?: boolean;
  /** Comentário público do Zendesk: sem tabela interna. */
  zendesk?: boolean;
};

// Fontes do site (dono, 24/10/2026): texto em Geist, título em Archivo largo, rótulo em Inter.
// O Gmail ignora fonte da web e cai na pilha (Inter/Arial): o layout não muda.
const SANS = "Geist, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const DISPLAY = "Archivo, Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
const LABEL = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

/** As cores dos chips do OS (globals.css: --info/--bad/--ok/--warn, -light e -ink). */
const FAIXA: Record<Faixa["tipo"], { bg: string; ink: string; cor: string; icone: string; rotulo: string }> = {
  acao: { bg: "#E7EEFF", ink: "#07379A", cor: "#0B5FFF", icone: "&#10148;", rotulo: "Action required" },
  falhou: { bg: "#FDE6EA", ink: "#7D0A1C", cor: "#C8102E", icone: "&#10005;", rotulo: "Payment failed" },
  pago: { bg: "#D9F3E8", ink: "#054A32", cor: "#0E8A5F", icone: "&#10003;", rotulo: "Payment successful" },
  aguardando: { bg: "#FFEFD6", ink: "#573600", cor: "#C47A00", icone: "&#9719;", rotulo: "Payment due" },
};

/**
 * A faixa que o estado pede, quando o e-mail não diz: pagamento falhou ou venceu =
 * vermelho, pago = verde, entrada/fatura/parcela = âmbar, ação do leitor = azul.
 * Cancelado e os demais ficam no chip de sempre.
 */
export function faixaDoEstado(estado: Estado | null | undefined): Faixa | null {
  const t = String(estado?.texto ?? "").trim();
  if (!t) return null;
  if (/fail|declin|didn.?t go through|overdue|final reminder|payment (reminder|outstanding|update)/i.test(t)) return { tipo: "falhou", texto: t };
  if (/payment (successful|received)|^paid$|^receipt/i.test(t)) return { tipo: "pago", texto: "Payment successful" };
  if (/refund/i.test(t)) return { tipo: "pago", texto: t };
  if (/deposit|payment due|instalment|awaiting payment/i.test(t)) return { tipo: "aguardando", texto: t };
  if (/action required|report (needed|overdue)|complaint|to accept|new job available|quote request|new opportunity/i.test(t)) return { tipo: "acao", texto: t };
  return null;
}

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

const TOM_DO_AVISO: Record<Aviso["tom"], { bg: string; borda: string; titulo: string; texto: string }> = {
  amber: { bg: "#FFF8EB", borda: "#F6E0B5", titulo: "#8A5300", texto: "#5B4A26" },
  red: { bg: "#FDF0F0", borda: "#F4CDCD", titulo: "#B42318", texto: "#6E2B2B" },
  blue: { bg: "#EFF4FF", borda: "#D9E3FB", titulo: "#1E3A8A", texto: "#36446E" },
  neutral: { bg: "#F7F7FA", borda: "#EEEEF2", titulo: "#020040", texto: "#505268" },
};

const corDoEstado = (c: Estado["cor"]) => (c === "green" ? FX.green : c === "muted" ? W.ink3 : FX.orange);

/** Fundo, texto e borda de cada pílula de estado. */
const CHIP: Record<NonNullable<Estado["cor"]>, { bg: string; fg: string; borda: string }> = {
  red: { bg: "#FDECEC", fg: "#C62828", borda: "#F5C2C2" },
  orange: { bg: "#FFF1EA", fg: "#C2410C", borda: "#FBD3BF" },
  green: { bg: "#E8F5EC", fg: "#15803D", borda: "#BFE3CB" },
  navy: { bg: "#EEEEF8", fg: "#020040", borda: "#D6D6EA" },
  muted: { bg: "#F1F1F4", fg: "#606078", borda: "#E0E0E6" },
};

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
/**
 * A linha neutra quando o job não tem foto (dono, 23/10/2026): texto pequeno e
 * cinza, como a legenda das fotos, num quadro tracejado claro.
 */
export function semFotosHtml(texto: string): string {
  return `<div style="border:1px dashed #D6D6E0;border-radius:10px;background:#FAFAFC;padding:12px 14px;"><p style="margin:0;font-family:${SANS};font-size:12px;line-height:18px;color:#6B6B85;">${esc(texto)}</p></div>`;
}

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
  const faixa = e.faixa === null ? null : e.faixa ?? faixaDoEstado(e.estado);
  const fx = faixa ? FAIXA[faixa.tipo] : null;

  // Cada bloco é um `div` com o recuo lateral; no e-mail completo ele vai dentro de uma linha da tabela.
  const bloco = (conteudo: string, topo = 0, lado = 32) =>
    z
      ? `<div style="padding:${topo}px ${lado - 4}px 0 ${lado - 4}px;">${conteudo}</div>`
      : `<tr><td class="fx-pad" style="padding:${topo}px ${lado}px 0 ${lado}px;">${conteudo}</td></tr>`;

  // ─── topo: logo navy no branco + divisória ───
  const faixaInner = faixa && fx
    ? `<span style="display:inline-block;width:22px;height:22px;line-height:22px;border-radius:11px;background:${fx.cor};color:#FFFFFF;text-align:center;font-family:${LABEL};font-size:11px;font-weight:700;vertical-align:middle;">${fx.icone}</span>&nbsp;&nbsp;<span style="font-family:${LABEL};font-size:14px;line-height:22px;font-weight:600;color:${fx.ink};vertical-align:middle;">${esc(faixa.texto?.trim() || fx.rotulo)}</span>`
    : "";
  const faixaNota = faixa?.nota?.trim() ? `<span style="font-family:${LABEL};font-size:13px;line-height:22px;font-weight:500;color:${fx!.ink};">${esc(faixa.nota.trim())}</span>` : "";
  const faixaHtml = !faixa || !fx
    ? ""
    : z
      ? `<div style="background:${fx.bg};padding:12px 24px;border-bottom:1px solid rgba(2,0,64,0.06);">${faixaNota ? `<span style="float:right;">${faixaNota}</span>` : ""}${faixaInner}</div>`
      : `<tr><td style="background:${fx.bg};padding:12px 24px;border-radius:16px 16px 0 0;border-bottom:1px solid rgba(2,0,64,0.06);"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td valign="middle">${faixaInner}</td>${faixaNota ? `<td valign="middle" align="right">${faixaNota}</td>` : ""}</tr></table></td></tr>`;
  const topo =
    faixaHtml +
    bloco(`<img src="${LOGO_NAVY}" alt="Fixfy" width="112" style="display:block;width:112px;height:auto;border:0;">`, 26) +
    bloco(`<div style="height:1px;line-height:1px;font-size:0;background:${W.line};margin-top:18px;">&nbsp;</div>`, 0);

  // ─── abertura: estado laranja, título grande, saudação e texto ───
  // Vermelho = dinheiro em aberto (dono, 22/10/2026): vira chip, para saltar aos olhos.
  const chip = e.estado && (e.estado.cor === "red" || e.estado.chip) ? CHIP[e.estado.cor ?? "navy"] : null;
  const estado = !e.estado || faixa
    ? ""
    : chip
      ? `<p style="margin:0 0 10px 0;"><span style="display:inline-block;background:${chip.bg};color:${chip.fg};border:1px solid ${chip.borda};font-family:${SANS};font-size:13px;line-height:18px;font-weight:700;padding:4px 12px;border-radius:999px;">${esc(e.estado.texto)}</span></p>`
      : `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:15px;line-height:20px;font-weight:700;letter-spacing:0.01em;color:${corDoEstado(e.estado.cor)};">${esc(e.estado.texto)}</p>`;
  const titulo = `<h1 class="fx-h1" style="margin:0 0 14px 0;font-family:${DISPLAY};font-stretch:118%;font-size:32px;line-height:36px;font-weight:800;letter-spacing:-0.02em;color:${FX.navy};">${esc(e.titulo)}</h1>`;
  const texto =
    (e.saudacao.trim() ? `<p style="margin:0 0 10px 0;font-family:${SANS};font-size:16px;line-height:25px;color:${W.ink};">${esc(e.saudacao)}</p>` : "") +
    e.paragrafos.map((p) => `<p style="margin:0 0 12px 0;font-family:${SANS};font-size:16px;line-height:25px;color:${W.ink2};">${esc(p)}</p>`).join("");
  const abertura = bloco(`${estado}${titulo}${texto}`, 26);

  // ─── destaque navy: métricas (data e janela, valor e vencimento) e progresso ───
  const tinto = Boolean(fx && faixa && faixa.tipo !== "aguardando");
  const heroBg = tinto ? fx!.bg : FX.navy;
  const corRotulo = tinto ? fx!.ink : W.onNavy;
  const corValor = !tinto ? "#FFFFFF" : faixa!.tipo === "acao" ? FX.navy : fx!.cor;
  const corSub = tinto ? fx!.ink : W.orangeSoft;
  const metricaHtml = (m: Metrica) =>
    `${m.rotulo ? `<p style="margin:0 0 4px 0;font-family:${LABEL};font-size:13px;line-height:16px;font-weight:600;color:${corRotulo};${tinto ? "opacity:0.8;" : ""}">${esc(m.rotulo)}</p>` : ""}<p class="fx-big" style="margin:0;font-family:${DISPLAY};font-stretch:112%;font-size:28px;line-height:34px;font-weight:800;letter-spacing:-0.02em;color:${corValor};${m.riscado ? "text-decoration:line-through;text-decoration-thickness:2px;opacity:0.7;" : ""}">${esc(m.valor)}</p>${m.sub ? `<p style="margin:4px 0 0 0;font-family:${LABEL};font-size:14px;line-height:20px;font-weight:600;color:${corSub};">${esc(m.sub)}</p>` : ""}`;
  // No Zendesk, uma métrica por linha (dono, 25/10/2026, "Job booked" do JOB-9793): lado a lado,
  // o Zendesk tira o box-sizing, as colunas de 33% não cabem, a data e a janela quebram em duas
  // linhas sobrepostas e a terceira métrica cai para baixo. Empilhado, cada valor cabe numa linha.
  const colunasMetricas = z
    ? metricas.map((m, i) => `<div style="padding:0 0 ${i < metricas.length - 1 ? 14 : 0}px 0;">${metricaHtml(m)}</div>`).join("")
    : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${metricas.map((m, i) => `<td class="fx-col" valign="top" style="padding:0 ${i < metricas.length - 1 ? 16 : 0}px 0 0;">${metricaHtml(m)}</td>`).join("")}</tr></table>`;
  // Régua horizontal dentro do quadro, em cima dos números (dono, 24/10/2026: "um do
  // lado do outro, igual era antes, dentro do box, em cima"). Feito = cheio, atual =
  // laranja, futuro = apagado, aprovado = verde. No quadro tingido, as cores da faixa.
  const corPasso = (p: Passo) =>
    p.estado === "aprovado" ? "#22C55E" : p.estado === "atual" ? FX.orange : p.estado === "feito" ? (tinto ? fx!.cor : "#FFFFFF") : tinto ? "rgba(2,0,64,0.12)" : "rgba(255,255,255,0.18)";
  const corNomePasso = (p: Passo) =>
    p.estado === "aprovado" ? (tinto ? "#0E8A5F" : "#4ADE80") : p.estado === "futuro" ? (tinto ? W.ink3 : W.onNavy) : tinto ? fx!.ink : "#FFFFFF";
  const passoHtml = (p: Passo) =>
    `<div style="height:4px;border-radius:2px;background:${corPasso(p)};font-size:0;line-height:0;">&nbsp;</div><p style="margin:7px 0 0 0;font-family:${LABEL};font-size:11px;line-height:14px;font-weight:${p.estado === "atual" || p.estado === "aprovado" ? 700 : 500};color:${corNomePasso(p)};">${esc(p.nome)}</p>`;
  const larguraPasso = passos.length ? Math.floor(100 / passos.length) : 0;
  const progresso = !passos.length
    ? ""
    : z
      ? `<div style="margin-bottom:${metricas.length ? 20 : 0}px;font-size:0;">${passos.map((p) => `<div style="display:inline-block;vertical-align:top;width:${larguraPasso}%;box-sizing:border-box;padding:0 3px;">${passoHtml(p)}</div>`).join("")}</div>`
      : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="margin-bottom:${metricas.length ? 20 : 0}px;"><tr>${passos.map((p) => `<td valign="top" width="${larguraPasso}%" style="padding:0 3px;">${passoHtml(p)}</td>`).join("")}</tr></table>`;
  const riscadoHtml = riscado
    ? `<p style="margin:12px 0 0 0;font-family:${SANS};font-size:13px;line-height:18px;color:${corRotulo};">Previously <span style="text-decoration:line-through;">${esc(riscado)}</span></p>`
    : "";
  const destaque = metricas.length || passos.length
    ? bloco(`<div style="background:${heroBg};border-radius:16px;padding:20px 22px;">${progresso}${metricas.length ? colunasMetricas : ""}${riscadoHtml}</div>`, 18, 24)
    : "";

  // ─── detalhes: quadro claro, uma linha por item ───
  const detalhes = linhas.length
    ? bloco(
        `<div style="border:1px solid ${W.line};border-radius:12px;">${linhas
          .map(
            ([r, v], i) =>
              e.detalhesLeves
                ? `<div style="padding:12px 16px;${i < linhas.length - 1 ? `border-bottom:1px solid ${W.line};` : ""}"><p style="margin:0;font-family:${SANS};font-size:13px;line-height:16px;color:${W.ink3};">${esc(r)}</p><p style="margin:3px 0 0 0;font-family:${SANS};font-size:15px;line-height:22px;font-weight:500;color:${W.ink};">${esc(v).replace(/\n/g, "<br>")}</p></div>`
                : `<div style="padding:12px 16px;${i < linhas.length - 1 ? `border-bottom:1px solid ${W.line};` : ""}"><p style="margin:0;font-family:${SANS};font-size:13px;line-height:16px;color:${W.ink3};">${esc(r)}</p><p style="margin:2px 0 0 0;font-family:${SANS};font-size:16px;line-height:22px;font-weight:700;color:${FX.navy};">${esc(v)}</p></div>`,
          )
          .join("")}</div>`,
        18,
        24,
      )
    : "";

  // ─── cartões com ícone ───
  const cartoes = (e.cartoes ?? []).filter((c) => c.titulo?.trim()).slice(0, 3);
  const cartaoHtml = (c: Cartao) =>
    `<div style="background:#F7F7FB;border:1px solid ${W.line};border-radius:14px;padding:14px 12px;"><p style="margin:0 0 6px 0;font-size:20px;line-height:24px;">${esc(c.icone)}</p><p style="margin:0;font-family:${LABEL};font-size:13px;line-height:18px;font-weight:600;color:#0A0A1F;">${esc(c.titulo)}</p>${c.texto?.trim() ? `<p style="margin:2px 0 0 0;font-family:${SANS};font-size:12.5px;line-height:17px;color:${W.ink3};">${esc(c.texto)}</p>` : ""}</div>`;
  const cartoesHtml = !cartoes.length
    ? ""
    : bloco(
        z
          ? `<div style="font-size:0;">${cartoes.map((c, i) => `<div style="display:inline-block;vertical-align:top;width:${Math.floor(100 / cartoes.length)}%;box-sizing:border-box;padding:0 ${i < cartoes.length - 1 ? 8 : 0}px 0 0;font-size:14px;">${cartaoHtml(c)}</div>`).join("")}</div>`
          : `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr>${cartoes.map((c, i) => `<td class="fx-col" valign="top" width="${Math.floor(100 / cartoes.length)}%" style="padding:0 ${i < cartoes.length - 1 ? 8 : 0}px 0 0;">${cartaoHtml(c)}</td>`).join("")}</tr></table>`,
        18,
        24,
      );

  // ─── botão laranja e links ───
  const botao = cta
    ? `<a href="${esc(cta.url)}" style="display:block;background:${FX.orange};color:#FFFFFF;text-decoration:none;font-family:${LABEL};font-size:16px;font-weight:700;line-height:22px;padding:16px 0;border-radius:12px;text-align:center;">${esc(cta.label)}</a>`
    : "";
  const links = secundarios.length
    ? `<p style="margin:12px 0 0 0;font-family:${SANS};font-size:14px;line-height:20px;text-align:center;color:${W.ink3};">${secundarios.map((l) => `<a href="${esc(urlSegura(l.url)!)}" style="color:${FX.navy};font-weight:700;">${esc(l.label)}</a>`).join(" &middot; ")}</p>`
    : "";
  const acao = botao || links ? bloco(`${botao}${links}`, 22, 24) : "";
  const antes = e.antesDoBotao?.html ? bloco(e.antesDoBotao.html, 18, 24) : "";

  // ─── quadros coloridos ───
  const avisos = (e.avisos ?? []).filter((a) => a.titulo?.trim() || a.texto?.trim() || a.nota?.trim() || (a.itens ?? []).some((x) => x.trim()));
  const avisoHtml = (a: Aviso) => {
    const t = TOM_DO_AVISO[a.tom];
    const titulo = a.titulo?.trim()
      ? `<p style="margin:0 0 4px 0;font-family:${SANS};font-size:14px;line-height:20px;font-weight:700;color:${t.titulo};">${a.icone ? `${esc(a.icone)}&nbsp; ` : ""}${esc(a.titulo)}</p>`
      : "";
    const texto = a.texto?.trim()
      ? `<p style="margin:0;font-family:${SANS};font-size:14px;line-height:21px;color:${t.texto};">${!a.titulo?.trim() && a.icone ? `${esc(a.icone)}&nbsp; ` : ""}${esc(a.texto)}${a.link && urlSegura(a.link.url) ? ` <a href="${esc(urlSegura(a.link.url))}" style="color:${t.texto};font-weight:600;text-decoration:underline;">${esc(a.link.label)}</a>.` : ""}</p>`
      : "";
    const itens = (a.itens ?? []).filter((x) => x.trim())
      .map((x) => `<p style="margin:4px 0 0 0;padding-left:14px;text-indent:-14px;font-family:${SANS};font-size:14px;line-height:21px;color:${t.texto};">&bull;&nbsp; ${esc(x)}</p>`)
      .join("");
    const nota = a.nota?.trim() ? `<p style="margin:8px 0 0 0;font-family:${SANS};font-size:13px;line-height:19px;color:${W.ink3};">${esc(a.nota)}</p>` : "";
    return `<div style="background:${t.bg};border:1px solid ${t.borda};border-radius:12px;padding:14px 16px;margin:0 0 10px 0;">${titulo}${texto}${itens}${nota}</div>`;
  };
  const avisosEm = (lugar: NonNullable<Aviso["lugar"]>) => {
    const lista = avisos.filter((a) => (a.lugar ?? "meio") === lugar);
    return lista.length ? bloco(lista.map(avisoHtml).join(""), lugar === "topo" ? 6 : 16, 24) : "";
  };
  const avisoTexto = (lugar: NonNullable<Aviso["lugar"]>) =>
    avisos
      .filter((a) => (a.lugar ?? "meio") === lugar)
      .map((a) => [a.titulo ? `${a.icone ? `${a.icone} ` : ""}${a.titulo}` : "", a.texto ? `${a.texto}${a.link ? ` ${a.link.label}: ${a.link.url}` : ""}` : "", ...(a.itens ?? []).map((x) => `- ${x}`), a.nota ?? ""].filter(Boolean).join("\n"))
      .join("\n\n");

  // ─── fotos do trabalho e o report completo ───
  const fotosLista = (e.fotos?.lista ?? []).filter((f) => urlSegura(f.url)).slice(0, 3);
  const linkDoReport = e.fotos?.link && urlSegura(e.fotos.link.url) ? { label: e.fotos.link.label, url: urlSegura(e.fotos.link.url)! } : null;
  const fotoHtml = (f: { url: string; alt?: string | null }, i: number) =>
    `<img src="${esc(urlSegura(f.url)!)}" width="176" alt="${esc(f.alt || `Photo ${i + 1} of the finished work`)}" style="display:block;width:100%;height:150px;object-fit:cover;border:0;border-radius:10px;">`;
  const gradeFotos = !fotosLista.length
    ? e.fotos?.vazio?.trim()
      ? semFotosHtml(e.fotos.vazio.trim())
      : ""
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
  const ajuda = e.semAjuda ? "" : bloco(
    `<div style="background:${W.canvas};border-radius:12px;padding:16px 18px;"><p style="margin:0;font-family:${SANS};font-size:16px;line-height:22px;font-weight:700;color:${FX.navy};">Need a hand?</p><p style="margin:3px 0 0 0;font-family:${SANS};font-size:15px;line-height:22px;color:${W.ink2};">Reply to this email or message us on <a href="${FIXFY_CONTACT.whatsapp}" style="color:${FX.navy};font-weight:600;text-decoration:underline;">WhatsApp</a>. We’re happy to help.</p></div>`,
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
    `<p style="margin:0 0 8px 0;font-family:${SANS};font-size:13px;line-height:18px;"><a href="https://www.getfixfy.com" style="color:${W.ink2};text-decoration:none;">getfixfy.com</a> <span style="color:#B5B6C4;">&middot;</span> <a href="mailto:${FIXFY_CONTACT.email}" style="color:${W.ink2};text-decoration:none;">${FIXFY_CONTACT.email}</a> <span style="color:#B5B6C4;">&middot;</span> <a href="${FIXFY_CONTACT.whatsapp}" style="color:${W.ink2};text-decoration:none;">WhatsApp</a></p>` +
    `<p style="margin:0;font-family:${SANS};font-size:12px;line-height:18px;color:${FX.faint};">${esc(FIXFY_CONTACT.legal)}</p>${marketing}`;
  const rodape = z
    ? `<div style="padding:28px 24px 28px 24px;text-align:center;">${rodapeInner}</div>`
    : `<tr><td align="center" style="padding:28px 24px 28px 24px;text-align:center;">${rodapeInner}</td></tr>`;

  // Com fotos (e-mail final): fotos e "What we did." vêm antes do resumo do pagamento.
  const miolo = topo + abertura + fotos + resumo + avisosEm("topo") + destaque + detalhes + cartoesHtml + avisosEm("meio") + antes + acao + avisosEm("fim") + transferencia + nota + assina + ajuda + finoHtml + rodape;

  const html = z
    ? `<div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${W.canvas};">${esc(e.preheader)}</div>` +
      `<div style="background:${W.canvas};padding:24px 12px;font-family:${SANS};"><div style="width:100%;max-width:600px;margin:0 auto;background:#FFFFFF;border-radius:16px;overflow:hidden;text-align:left;">${miolo}</div></div>`
    : `<!DOCTYPE html>
<html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="x-apple-disable-message-reformatting"><meta name="color-scheme" content="light only"><meta name="supported-color-schemes" content="light only"><title>&#8203;</title>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,500..900&family=Geist:wght@400;500;600;700&family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<style>:root{color-scheme:light only}@media screen and (max-width:620px){.fx-pad{padding-left:20px !important;padding-right:20px !important}.fx-h1{font-size:27px !important;line-height:31px !important}.fx-big{font-size:21px !important;line-height:27px !important}.fx-col{display:block !important;width:100% !important;padding:0 0 14px 0 !important}}</style></head>
<body style="margin:0;padding:0;background:${W.canvas};font-family:${SANS};">
<div style="display:none;max-height:0;overflow:hidden;font-size:1px;line-height:1px;color:${W.canvas};">${esc(e.preheader)}</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:${W.canvas};"><tr><td align="center" style="padding:24px 12px;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="max-width:600px;background:#FFFFFF;border-radius:16px;">
${miolo}
</table></td></tr></table></body></html>`;

  const text = [
    faixa ? (faixa.texto?.trim() || fx!.rotulo).toUpperCase() : e.estado ? e.estado.texto.toUpperCase() : "",
    e.titulo,
    (e.metricas ?? []).filter((m) => m.valor?.trim()).length
      ? (e.metricas ?? []).filter((m) => m.valor?.trim()).map((m) => `${m.rotulo ? `${m.rotulo}: ` : ""}${m.valor}${m.sub ? `, ${m.sub}` : ""}`).join("\n")
      : e.destaque
        ? [e.destaque.linha1, e.destaque.linha2].filter(Boolean).join(", ")
        : "",
    e.destaque?.riscado ? `Previously: ${e.destaque.riscado}` : "",
    "",
    e.saudacao.trim() ? e.saudacao : "",
    "",
    ...e.paragrafos.flatMap((p) => [p, ""]),
    avisoTexto("topo") ? `${avisoTexto("topo")}\n` : "",
    !fotosLista.length && e.fotos?.vazio?.trim() ? `${e.fotos.vazio.trim()}\n` : "",
    linkDoReport ? `${linkDoReport.label}: ${linkDoReport.url}\n` : "",
    e.resumo?.texto?.trim() ? `${e.resumo.titulo}\n${e.resumo.texto.trim()}\n` : "",
    ...linhas.map(([r, v]) => `${r}: ${v}`),
    ...cartoes.map((c) => `- ${c.titulo}${c.texto ? `: ${c.texto}` : ""}`),
    avisoTexto("meio") ? `\n${avisoTexto("meio")}` : "",
    e.antesDoBotao?.text ? `\n${e.antesDoBotao.text}` : "",
    cta ? `\n${cta.label}: ${cta.url}` : "",
    ...secundarios.map((l) => `${l.label}: ${urlSegura(l.url)}`),
    avisoTexto("fim") ? `\n${avisoTexto("fim")}` : "",
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
    `Need a hand? Reply to this email, contact ${FIXFY_CONTACT.email} or message us on WhatsApp: ${FIXFY_CONTACT.whatsapp}`,
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
  const rodape = `<p style="margin:0;font-size:12px;line-height:18px;color:${FX.faint};">Need a hand? Reply to this email, contact <a href="mailto:${FIXFY_CONTACT.email}" style="color:${FX.navy};font-weight:600;">${FIXFY_CONTACT.email}</a> or message us on <a href="${FIXFY_CONTACT.whatsapp}" style="color:${FX.navy};font-weight:600;">WhatsApp</a>.<br>${esc(FIXFY_CONTACT.legal)}</p>`;
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
    `Need a hand? Reply to this email, contact ${FIXFY_CONTACT.email} or message us on WhatsApp: ${FIXFY_CONTACT.whatsapp}`,
    FIXFY_CONTACT.legal,
  ]
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return { html, text };
}
