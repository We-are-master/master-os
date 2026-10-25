/**
 * O scope no padrão Fixfy (dono, 25/10/2026): o mesmo formato para todo job,
 * venha de onde vier (site, Harvey, Housekeep, Fantastic, Express, B2B).
 *
 *   WORK        uma tarefa por linha, começando pelo verbo
 *   PROPERTY    tipo, andar e cômodos numa linha só ("Flat · 1 bed · 1 bath")
 *   ACCESS      entrada, quem abre, estacionamento
 *   MATERIALS   o que levar, o que o cliente tem, a regra do extra
 *   NOTES       condições, avisos e o texto do cliente, sempre guardado
 *
 * Bloco vazio não aparece. Nunca entram: preço, nome da plataforma, data ou
 * horário (têm campo próprio), ticket e nota interna. Quem garante isso no fim
 * é o `limparScope`, que roda depois daqui.
 *
 * As fontes com estrutura (formulário da Housekeep, blocos da Fantastic,
 * linhas do site) são lidas por regra. Texto solto (Express, B2B, pedido
 * escrito à mão) passa pelo modelo, que só organiza: o original fica em NOTES.
 */
import { isOpenAIConfigured, openaiChat } from "@/lib/openai-client";

export type ScopeFixfy = {
  trabalho: string[];
  imovel: string[];
  acesso: string[];
  materiais: string[];
  notas: string[];
  /** O texto do cliente, como veio. Vai no fim de NOTES. */
  palavrasDoCliente: string | null;
};

const vazio = (): ScopeFixfy => ({ trabalho: [], imovel: [], acesso: [], materiais: [], notas: [], palavrasDoCliente: null });

const BLOCOS = ["WORK", "PROPERTY", "ACCESS", "MATERIALS", "NOTES"] as const;

/** Já está no padrão: começa por um dos blocos e não tem formulário cru. */
export function jaNoPadrao(texto: string | null | undefined): boolean {
  const t = String(texto ?? "").trim();
  return new RegExp(`^(${BLOCOS.join("|")})\\n`).test(t);
}

/** Ticket e referência interna não vão para o parceiro ("(ticket #51790)", "on the linked ticket"). */
const semTicket = (s: string) => s.replace(/\s*\(?\b(zendesk )?ticket\s*#?\d+\)?/gi, "");
const limpa = (s: string) => semTicket(s).replace(/\s+/g, " ").replace(/\s+([.,;])/g, "$1").trim();
const frase = (s: string) => {
  const t = limpa(s).replace(/^[-•*]\s*/, "");
  if (!t) return "";
  const comMaiuscula = t[0]!.toUpperCase() + t.slice(1);
  return /[.!?)"]$/.test(comMaiuscula) ? comMaiuscula : `${comMaiuscula}.`;
};
const unicos = (xs: string[]) => [...new Set(xs.map((x) => x.trim()).filter(Boolean))];

/** Monta o texto do padrão. */
export function montarScope(s: ScopeFixfy): string {
  const partes: string[] = [];
  const trabalho = unicos(s.trabalho.map(frase));
  if (trabalho.length) partes.push(`WORK\n${trabalho.map((t) => `- ${t}`).join("\n")}`);
  const imovel = unicos(s.imovel.map(limpa));
  if (imovel.length) partes.push(`PROPERTY\n${imovel.join(" · ")}`);
  const acesso = unicos(s.acesso.map(frase));
  if (acesso.length) partes.push(`ACCESS\n${acesso.join("\n")}`);
  const materiais = unicos(s.materiais.map(frase));
  if (materiais.length) partes.push(`MATERIALS\n${materiais.join("\n")}`);
  const notas = unicos(s.notas.map(frase));
  const original = s.palavrasDoCliente?.trim() ? `In the customer's words: "${limpa(s.palavrasDoCliente).replace(/"/g, "'")}"` : null;
  if (notas.length || original) partes.push(`NOTES\n${[...notas, ...(original ? [original] : [])].join("\n")}`);
  return partes.join("\n\n");
}

/* ───────────────────────────── leitores por regra ───────────────────────────── */

/** Formulário "Job details" da Housekeep: "Chave: valor" por linha. */
function lerFormulario(texto: string): ScopeFixfy | null {
  if (!/\n\s*Job details\s*\n/i.test(`\n${texto}\n`)) return null;
  const s = vazio();
  const linhas = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  const servico = linhas[0] && !/^job details$/i.test(linhas[0]) && !linhas[0].includes(":") ? linhas[0] : null;
  const quartos: string[] = [];
  for (const l of linhas) {
    const m = l.match(/^([A-Za-z ]{3,30}):\s*(.*)$/);
    if (!m) continue;
    const chave = m[1]!.trim().toLowerCase();
    const valor = m[2]!.trim();
    if (!valor || valor === "0") continue;
    if (chave === "entrance") s.acesso.push(`Entrance: ${valor}`);
    else if (chave === "property type") s.imovel.unshift(valor);
    else if (chave === "bedrooms") quartos.push(`${valor} bed`);
    else if (chave === "bathrooms") quartos.push(`${valor} bath`);
    else if (chave === "additional rooms") quartos.push(`${valor} other room${valor === "1" ? "" : "s"}`);
    else if (chave === "length") s.notas.push(`Booked for ${valor} hour${valor === "1" ? "" : "s"}`);
    else if (chave === "tasks") {
      for (const t of valor.split(/,\s*/)) {
        const tarefa = t.replace(/\s*\[[^\]]*\]\s*/g, "").trim();
        if (tarefa && !/^other odd jobs$/i.test(tarefa)) s.trabalho.push(tarefa);
      }
    } else if (chave === "additional notes" || chave === "notes") s.palavrasDoCliente = valor;
    else if (chave === "parking") s.acesso.push(`Parking: ${valor}`);
    else s.notas.push(`${m[1]!.trim()}: ${valor}`);
  }
  s.imovel.push(...quartos);
  if (servico && !s.trabalho.length && !/^(handyman|cleaner|cleaning)$/i.test(servico)) s.trabalho.push(servico);
  return s;
}

/** Blocos em caixa alta da Fantastic: "PROPERTY LAYOUT: …", "ACCESS: …". */
function lerBlocos(texto: string): ScopeFixfy | null {
  const paragrafos = texto.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  const rotulados = paragrafos.filter((p) => /^[A-Z][A-Z /&]{2,30}:\s/.test(p));
  if (rotulados.length < 2) return null;
  const s = vazio();
  for (const p of paragrafos) {
    const m = p.match(/^([A-Z][A-Z /&]{2,30}):\s*([\s\S]*)$/);
    if (!m) {
      (s.trabalho.length ? s.notas : s.trabalho).push(p);
      continue;
    }
    const chave = m[1]!.trim();
    const valor = limpa(m[2]!);
    if (/LAYOUT|PROPERTY/.test(chave)) s.imovel.push(valor);
    else if (/ACCESS|KEY/.test(chave)) s.acesso.push(valor);
    else if (/PARKING/.test(chave)) s.acesso.push(`Parking: ${valor}`);
    else if (/MATERIAL|EQUIPMENT|SUPPL/.test(chave)) s.materiais.push(valor);
    else if (/CONDITION/.test(chave)) s.notas.push(`Conditions: ${valor}`);
    else if (/START|TIME|ARRIVAL/.test(chave)) s.notas.push(`Start time: ${valor}`);
    else if (/CARPET|EXTRA|ADD.?ON|TASK|SERVICE/.test(chave)) s.trabalho.push(valor);
    else s.notas.push(`${chave[0]}${chave.slice(1).toLowerCase()}: ${valor}`);
  }
  return s;
}

/** Linhas do site: "Access: … Parking: …", "Parts: …", "Customer notes: …". */
function lerSite(texto: string): ScopeFixfy | null {
  if (!/^(Customer notes|Access):/im.test(texto)) return null;
  const s = vazio();
  for (const linha of texto.split("\n").map((l) => l.trim()).filter(Boolean)) {
    const notas = linha.match(/^Customer notes:\s*(.*)$/i);
    if (notas) {
      s.palavrasDoCliente = notas[1]!.replace(/\s*Booked on WhatsApp with Harvey\.?\s*$/i, "").trim() || null;
      continue;
    }
    const acesso = linha.match(/^Access:\s*(.*)$/i);
    if (acesso) {
      for (const p of acesso[1]!.split(/(?<=\.)\s+(?=Parking:)/i)) s.acesso.push(p.trim());
      continue;
    }
    if (/^(Parts|Materials|Paint)\b/i.test(linha)) {
      s.materiais.push(linha.replace(/^Parts:\s*/i, ""));
      continue;
    }
    if (/^Part of booking\b/i.test(linha)) {
      s.notas.push(linha);
      continue;
    }
    s.trabalho.push(linha);
  }
  return s;
}

/* ───────────────────────────── texto solto: o modelo ───────────────────────────── */

const INSTRUCAO = `You turn a job request for a home-services company in London into a job brief for the professional who will do the work.
Return ONLY JSON with five lists of plain sentences (strings, never objects): {"work":[],"property":[],"access":[],"materials":[],"notes":[]}.
- work: one task per item, starting with a verb (Fit, Replace, Clean, Paint...). List EVERY job the request mentions, even ones mentioned in passing ("a leaking tap and a flickering light strip" is two items). Keep every detail the request gives (sizes, counts, rooms, brands). If the request only names a service ("After build cleaning service"), that service is the work item. Something the customer says "may" or "will likely" be needed stays a possibility, not an order.
- property: only what the request states (e.g. "4 bed", "2 bath", "1st floor"). Never guess the property type.
- access: entrance, who opens, keys, parking, and the on-site contact with their phone number if given.
- materials: what to bring, what the customer already has.
- notes: conditions, warnings, skills needed, anything else useful.
Rules: English. Never invent anything. Never write prices or money, dates, days or times, ticket numbers, or company or platform names (Housekeep, Checkatrade, Fantastic, Express...). Leave a list empty if the request says nothing about it.
Example: "4 bed 2 Bath\nJohn - 07700900000\nAfter Build Cleaning Service" -> {"work":["After-builders clean"],"property":["4 bed","2 bath"],"access":["On-site contact: John, 07700 900000"],"materials":[],"notes":[]}`;

async function organizarComModelo(texto: string): Promise<ScopeFixfy | null> {
  if (!isOpenAIConfigured()) return null;
  try {
    const resposta = await Promise.race([
      openaiChat([{ role: "system", content: INSTRUCAO }, { role: "user", content: texto.slice(0, 6000) }], { maxTokens: 700, temperature: 0 }),
      new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 12_000)),
    ]);
    // Só o objeto: o modelo às vezes escreve algo antes ou depois dele.
    const json = JSON.parse(resposta.slice(resposta.indexOf("{"), resposta.lastIndexOf("}") + 1)) as Record<string, unknown>;
    // Item que veio como objeto vira texto com os valores, para não perder o dado.
    const comoTexto = (x: unknown): string =>
      typeof x === "string" ? x : x && typeof x === "object" ? Object.values(x as Record<string, unknown>).filter((v) => typeof v === "string" || typeof v === "number").join(", ") : "";
    const lista = (k: string) => (Array.isArray(json[k]) ? (json[k] as unknown[]).map(comoTexto).filter((x) => x.trim().length > 0) : []);
    const s: ScopeFixfy = { trabalho: lista("work"), imovel: lista("property"), acesso: lista("access"), materiais: lista("materials"), notas: lista("notes"), palavrasDoCliente: null };
    return s.trabalho.length ? s : null;
  } catch (e) {
    console.warn("[scope-padrao] model failed, keeping the text as tasks:", e instanceof Error ? e.message : e);
    return null;
  }
}

/** Sem modelo: cada linha do texto vira uma tarefa, e o texto não se repete em NOTES. */
function semModelo(texto: string): ScopeFixfy {
  const s = vazio();
  s.trabalho = texto.split("\n").map((l) => l.trim()).filter(Boolean);
  return s;
}

/**
 * O scope de qualquer fonte no padrão Fixfy. Já padronizado volta como veio.
 * `usarModelo: false` (testes, backfill sem chave) fica só nas regras.
 */
export async function scopeNoPadrao(texto: string | null | undefined, opcoes?: { usarModelo?: boolean }): Promise<string | null> {
  const t = String(texto ?? "").replace(/\r\n/g, "\n").trim();
  if (!t) return null;
  if (jaNoPadrao(t)) return t;
  const usarModelo = opcoes?.usarModelo !== false;

  const estruturado = lerFormulario(t) ?? lerBlocos(t) ?? lerSite(t);
  if (estruturado) {
    // Formulário com tarefa vaga ("Other odd jobs"): o modelo lê o texto do cliente e escreve o WORK.
    if (!estruturado.trabalho.length && estruturado.palavrasDoCliente && usarModelo) {
      const doModelo = await organizarComModelo(estruturado.palavrasDoCliente);
      if (doModelo) {
        estruturado.trabalho = doModelo.trabalho;
        estruturado.materiais.push(...doModelo.materiais);
      }
    }
    if (!estruturado.trabalho.length && estruturado.palavrasDoCliente) estruturado.trabalho.push("See the customer's words in the notes below");
    return montarScope(estruturado);
  }

  const doModelo = usarModelo ? await organizarComModelo(t) : null;
  if (doModelo) return montarScope({ ...doModelo, palavrasDoCliente: t });
  return montarScope(semModelo(t));
}
