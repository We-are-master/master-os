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
import { dataLonga, emailFixfy, esc, FIXFY_CONTACT, hora24, semFotosHtml, horaDeTextoPara24, janelaDeTexto, janelaTexto, type Aviso, type EmailFixfy, type Estado, type Metrica, type Passo } from "./fixfy-shell";
import { extractUkPostcode } from "@/lib/uk-postcode";
import { janelaCurta, passosAte } from "./faixas-do-email";

/**
 * A vida do job do lado de quem executa. "On the day" saiu da barra (dono,
 * 23/10/2026): o dia do job é o passo Accepted até o relatório.
 */
export const PASSOS_JOB_PARCEIRO = ["Offered", "Accepted", "Report", "Approved"] as const;
export const PASSO_OFERTA = 0;
export const PASSO_ACEITO = 1;
/** Véspera e remarcação: o job segue no passo Accepted. */
export const PASSO_NO_DIA = PASSO_ACEITO;
export const PASSO_RELATORIO = 2;
export const PASSO_PAGO = 3;

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

/** "9:00 AM" / "09:00" / "9AM" viram "09:00" (24h, formato único). */
export function horaDeTexto(texto: string | null | undefined): string {
  const t = String(texto ?? "").trim();
  const m = t.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm)?$/i);
  if (!m) return t;
  return horaDeTextoPara24(m[1]!, m[2], m[3]) ?? t;
}

/** Janela que chegou como texto ("9:00 AM – 12:00 PM") em "09:00-12:00". */
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
  const chegada = janela ? janelaCurta(janela) : hora24(a.scheduledStartAt);
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
  opts: {
    legenda: string;
    max: number;
    href?: string | null;
    maisLink?: { label: string; url: string } | null;
    /** "Save all photos": baixa todas num .zip (`lib/fotos-zip.ts`). */
    baixarTudo?: string | null;
  },
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
  // Link simples em destaque, na mesma fileira, depois das fotos (dono, 25/10/2026).
  const baixar = opts.baixarTudo
    ? `<a href="${esc(opts.baixarTudo)}" target="_blank" style="display:inline-block;vertical-align:top;margin:0 8px 8px 0;padding:12px 4px;color:#ED4B00;font-size:13px;line-height:18px;font-weight:700;text-decoration:underline;">Save all photos</a>`
    : "";
  return `<div style="margin:0 0 12px 0;"><p style="margin:0 0 8px 0;font-size:12px;line-height:18px;color:#6B6B85;">${esc(opts.legenda)}</p><div style="font-size:0;line-height:0;">${imgs}${mais}${baixar}</div></div>`;
}

/** Sem foto no job: a linha neutra no lugar das miniaturas (dono, 23/10/2026). */
export const SEM_FOTOS_PARCEIRO = "No site photos available";
export function semFotosDoParceiro(): { html: string; text: string } {
  return { html: semFotosHtml(SEM_FOTOS_PARCEIRO), text: SEM_FOTOS_PARCEIRO };
}

/** Troca a marca de fotos pelo bloco (html) e pela linha (texto). */
export function comFotos(r: { html: string; text: string }, html: string, text: string): { html: string; text: string } {
  const marca = MARCA_FOTOS.replace(/[[\]]/g, "\\$&");
  return {
    html: r.html.replace(new RegExp(`<p[^>]*>${marca}</p>`), html),
    text: r.text.replace(new RegExp(`${marca}\\n*`), text ? `${text}\n\n` : ""),
  };
}

// ─── O padrão dos e-mails ao parceiro (dono, 23/10/2026) ────────────────
//
// "O partner tem que bater o olho e já ver se é quote, job pra aceitar ou job
// booked, as infos, e button pra resolver." Cada e-mail: chip do tipo (sempre
// as mesmas palavras), título curto, bloco navy com 1 ou 2 números e a régua,
// quadro de detalhes, fotos, UM botão. Sem saudação, sem parágrafo (só quando o
// e-mail ficaria ambíguo sem ele), sem letra pequena, sem o quadro "Need a hand?".

/** O chip de cada tipo: as mesmas palavras e a mesma cor em todos os e-mails. */
export const CHIP_PARCEIRO = {
  quote: { texto: "Quote request", cor: "navy", chip: true },
  oferta: { texto: "Job to accept", cor: "orange", chip: true },
  booked: { texto: "Job booked", cor: "green", chip: true },
  remarcado: { texto: "Rescheduled", cor: "navy", chip: true },
  emEspera: { texto: "On hold", cor: "orange", chip: true },
  reclamacao: { texto: "Complaint", cor: "red", chip: true },
  cancelado: { texto: "Cancelled", cor: "red", chip: true },
  relatorio: { texto: "Report needed", cor: "orange", chip: true },
  atrasado: { texto: "Report overdue", cor: "orange", chip: true },
  concluido: { texto: "Job complete", cor: "green", chip: true },
  pagamento: { texto: "Self-bill", cor: "navy", chip: true },
  pago: { texto: "Paid", cor: "green", chip: true },
} as const satisfies Record<string, Estado>;

/**
 * A moldura no padrão do parceiro: comentário do Zendesk por padrão, sem
 * saudação, sem parágrafos, sem o quadro de ajuda.
 */
export function emailParceiro(
  e: Omit<EmailFixfy, "saudacao" | "paragrafos"> & { saudacao?: string; paragrafos?: string[] },
): { html: string; text: string } {
  return emailFixfy({ zendesk: true, semAjuda: true, detalhesLeves: true, ...e, saudacao: e.saudacao ?? "", paragrafos: (e.paragrafos ?? []).map(semTravessao) });
}

/** O quadro azul de ajuda, depois do botão. */
export function ajudaDoParceiro(texto = "Reply to this email or message us on", titulo = "Questions?"): Aviso {
  return { tom: "blue", icone: "💬", titulo, texto, link: { label: "WhatsApp", url: FIXFY_CONTACT.whatsapp }, lugar: "fim" };
}

/**
 * O que o parceiro ganha, a partir do texto de sempre ("Hourly · £35.00/hr",
 * "Fixed · £70.00", "Half day · £180.00", "£249.00 inc VAT"). Nunca "inc VAT"
 * (é o dinheiro dele) e nunca "Hourly" duas vezes: por hora vira "£35.00/h".
 */
export function pagaDoParceiro(priceDisplay: string | null | undefined): { valor: string; tipo: string | null; linha: string } | null {
  const t = semTravessao(String(priceDisplay ?? "")).replace(/\s*inc(?:l\.?|luding)?\s*vat\b/i, "").trim();
  if (!t) return null;
  const partes = t.split(/\s+·\s+/);
  const rotulo = partes.length > 1 ? partes[0]!.trim() : null;
  const bruto = (partes.length > 1 ? partes.slice(1).join(" ") : t).trim();
  const porHora = /\/\s*(?:hr|hour|h)\b/i.test(bruto) || /^hourly$/i.test(rotulo ?? "");
  const valor = porHora ? bruto.replace(/\s*\/\s*(?:hr|hour|h)\b.*$/i, "") + "/h" : bruto;
  const tipo = porHora ? null : rotulo && !/^fixed$/i.test(rotulo) ? rotulo : "Fixed price";
  const linha = porHora ? valor : tipo === "Fixed price" ? `${valor} fixed` : `${tipo} · ${valor}`;
  return { valor, tipo, linha };
}

/** "12 Example Road, London E1 6AN" vira "E1 6AN · London" (o job ainda não é dele). */
export function areaDoEndereco(endereco: string | null | undefined): string | null {
  const t = String(endereco ?? "").trim();
  const postcode = extractUkPostcode(t);
  const partes = t.split(",").map((p) => p.trim()).filter(Boolean);
  const ultima = partes[partes.length - 1] ?? "";
  const cidade = (postcode ? ultima.replace(postcode, "") : ultima).replace(/\s+/g, " ").trim();
  // Só é área se não parece rua ("12 Example Road") nem é o endereço inteiro.
  const area = partes.length > 1 && cidade && !/^\d/.test(cidade) ? cidade : null;
  return [postcode, area].filter(Boolean).join(" · ") || null;
}

/** O serviço e o começo do escopo, em duas linhas no máximo (~120 caracteres). */
export function trabalhoCurto(tipo: string | null | undefined, escopo: string | null | undefined, max = 120): string {
  const t = semTravessao(String(tipo ?? "").trim());
  const e = semTravessao(
    String(escopo ?? "")
      .split(/\n+/)
      .map((l) => l.trim().replace(/^[-*·•]\s*/, ""))
      .filter((l) => l && !/^\(no scope provided\)$/i.test(l))
      .map((l) => (/[.!?:]$/.test(l) ? l : `${l}.`))
      .join(" "),
  );
  const junto = [t, e].filter(Boolean).join(": ");
  if (junto.length <= max) return junto;
  const corte = junto.slice(0, max);
  return `${corte.slice(0, corte.lastIndexOf(" ") > max * 0.6 ? corte.lastIndexOf(" ") : max).replace(/[\s,.;:]+$/, "")}…`;
}

/** Self-bill: a barra inteira cheia, "Approved" em verde. */
export function passosDoPagamento(_pago?: boolean): Passo[] {
  // Self-bill emitido = job aprovado (dono, 23/10/2026): os quatro passos
  // cheios e "Approved" em verde.
  return PASSOS_JOB_PARCEIRO.map((nome, i) => ({ nome, estado: i === PASSO_PAGO ? "aprovado" : "feito" }));
}
