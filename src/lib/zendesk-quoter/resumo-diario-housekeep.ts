/**
 * O e-mail diário da Housekeep: "You have 2 jobs on Mon 19 Oct".
 *
 * ─── Por que existe ──────────────────────────────────────────────────────
 *
 * Todo dia a Housekeep manda a lista dos jobs do dia seguinte. Até 18/10/2026
 * o Harvey pulava esse e-mail (era "lembrete", ficava no Action Required para
 * um humano), e o humano fazia sempre a mesma coisa: abria o OS e conferia se
 * cada linha estava lá, com parceiro. Dono, 18/10/2026: "quero que o Harvey
 * cheque se os jobs estão realmente booked no OS; se sim, já resolve o ticket;
 * se não, deixa notas".
 *
 * "Booked" aqui quer dizer três coisas, e as três vêm do mesmo motivo: o
 * e-mail chega na véspera, e o que falta amanhã é job sem gente.
 *
 *   1. existe job no OS, vivo (não cancelado, não apagado);
 *   2. na data do e-mail e no postcode da linha;
 *   3. com parceiro alocado.
 *
 * Janela e preço diferentes entram na nota como aviso, mas não seguram o
 * ticket: o cliente pede "depois das 17h" dentro da janela deles, e o preço
 * por hora da conta já tem dono ([[housekeep-preco-por-hora]]).
 *
 * ─── Por que sem modelo ──────────────────────────────────────────────────
 *
 * O texto do e-mail é uma tabela fixa, e o plain text do Zendesk entrega ela
 * limpa: "Handyman SW1V 3AX 09:00-15:00 start One-off 1.0 hrs £75.00 Link".
 * Regex aqui é mais barato e, principalmente, não inventa linha.
 */
import { createServiceClient } from "@/lib/supabase/service";
import { postcodesNoTexto } from "./achar-job";

export const TAG_RESUMO_OK = "harvey_resumo_ok";
export const TAG_RESUMO_FALTANDO = "harvey_resumo_faltando";

export function ehResumoDiario(assunto: string | null | undefined): boolean {
  return /you have \d+ jobs? on /i.test(String(assunto ?? ""));
}

const MESES: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * `Mon 19 Oct` no assunto vira `2026-10-19`. O assunto não traz o ano: ele sai
 * da data em que o e-mail chegou, e um e-mail de 31/12 sobre "Fri 1 Jan" é do
 * ano seguinte.
 */
export function dataDoResumo(assunto: string, recebidoEm: string | Date): string | null {
  const m = String(assunto).match(/\bon\s+(?:[A-Za-z]{3,9}\s+)?(\d{1,2})\s+([A-Za-z]{3})/i);
  if (!m) return null;
  const dia = Number(m[1]);
  const mes = MESES[m[2]!.toLowerCase()];
  if (!mes || dia < 1 || dia > 31) return null;
  const recebido = new Date(recebidoEm);
  let ano = recebido.getUTCFullYear();
  if (mes < recebido.getUTCMonth() + 1 - 6) ano += 1;
  return `${ano}-${String(mes).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

export interface LinhaDoResumo {
  tipo: string | null;
  /** Como veio no e-mail, `SW1V 3AX`. */
  postcode: string;
  /** Sem espaço e em maiúsculas, para casar. */
  chave: string;
  /** `HH:MM`, horário de Londres. */
  inicio: string;
  fim: string;
  horas: number | null;
  total: number | null;
}

const LINHA =
  /([A-Z]{1,2}\d[A-Z\d]?)\s?(\d[A-Z]{2})\s+(\d{1,2}:\d{2})\s*[-–]\s*(\d{1,2}:\d{2})(?:\s+start)?(?:\s+\S+)?(?:\s+([\d.]+)\s*hrs?)?(?:\s+£\s?([\d,]+(?:\.\d+)?))?/gi;

/**
 * As linhas da tabela. Cada linha do e-mail termina em "Link" (o card do job),
 * então o texto depois do cabeçalho "Job report" é cortado em "Link" e cada
 * pedaço é uma linha. O tipo de serviço é o que vem antes do postcode.
 */
export function linhasDoResumo(texto: string): LinhaDoResumo[] {
  const plano = String(texto ?? "").replace(/\s+/g, " ");
  const inicioTabela = plano.search(/\bJob report\b/i);
  const corpo = inicioTabela >= 0 ? plano.slice(inicioTabela + "Job report".length) : plano;
  const linhas: LinhaDoResumo[] = [];
  for (const pedaco of corpo.split(/\bLink\b/)) {
    LINHA.lastIndex = 0;
    const m = LINHA.exec(pedaco);
    if (!m) continue;
    const tipo = pedaco.slice(0, m.index).trim().split(/\.\s|:\s/).pop()?.trim() || null;
    const postcode = `${m[1]!.toUpperCase()} ${m[2]!.toUpperCase()}`;
    linhas.push({
      tipo: tipo && tipo.length <= 40 ? tipo : null,
      postcode,
      chave: postcode.replace(/\s+/g, ""),
      inicio: m[3]!.padStart(5, "0"),
      fim: m[4]!.padStart(5, "0"),
      horas: m[5] ? Number(m[5]) : null,
      total: m[6] ? Number(m[6].replace(/,/g, "")) : null,
    });
  }
  return linhas;
}

export interface JobDoResumo {
  reference: string;
  status: string;
  client_name: string | null;
  property_address: string | null;
  scheduled_date: string | null;
  scheduled_start_at: string | null;
  partner_name: string | null;
  partner_id: string | null;
  client_price: number | null;
}

export interface ConferenciaDaLinha {
  linha: LinhaDoResumo;
  job: JobDoResumo | null;
  /** Mais de um job vivo no mesmo postcode e dia: o humano escolhe. */
  ambiguos: JobDoResumo[];
  /** O que impede chamar de booked. Vazio = booked. */
  falta: string[];
  /** Diferenças que não seguram o ticket. */
  avisos: string[];
}

/** `2026-10-19T08:00:00Z` vira `09:00` em Londres. */
export function horaEmLondres(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Pura: decide, para uma linha, o que achou nos jobs do dia. */
export function conferirLinha(linha: LinhaDoResumo, jobsDoDia: readonly JobDoResumo[]): ConferenciaDaLinha {
  const vivos = jobsDoDia.filter((j) => !["cancelled", "deleted"].includes(j.status));
  const hits = vivos.filter((j) => postcodesNoTexto(j.property_address).includes(linha.chave));
  if (hits.length === 0) {
    return { linha, job: null, ambiguos: [], falta: ["no job in the OS for this postcode on this day"], avisos: [] };
  }
  if (hits.length > 1) {
    return {
      linha,
      job: null,
      ambiguos: hits,
      falta: [`${hits.length} jobs in the OS for this postcode on this day (${hits.map((h) => h.reference).join(", ")})`],
      avisos: [],
    };
  }
  const job = hits[0]!;
  const falta: string[] = [];
  const avisos: string[] = [];
  if (!job.partner_id) falta.push("no partner assigned");
  const hora = horaEmLondres(job.scheduled_start_at);
  if (hora && (hora < linha.inicio || hora > linha.fim)) {
    avisos.push(`OS start ${hora}, Housekeep window ${linha.inicio}-${linha.fim}`);
  }
  if (linha.total != null && job.client_price != null && Math.abs(Number(job.client_price) - linha.total) >= 0.01) {
    avisos.push(`OS price £${Number(job.client_price).toFixed(2)}, Housekeep £${linha.total.toFixed(2)}`);
  }
  return { linha, job, ambiguos: [], falta, avisos };
}

async function jobsDoDia(data: string): Promise<JobDoResumo[]> {
  const supabase = createServiceClient();
  const { data: rows, error } = await supabase
    .from("jobs")
    .select("reference,status,client_name,property_address,scheduled_date,scheduled_start_at,partner_name,partner_id,client_price")
    .eq("scheduled_date", data)
    .is("deleted_at", null);
  if (error) throw new Error(`jobs do dia ${data}: ${error.message}`);
  return (rows ?? []) as JobDoResumo[];
}

export async function conferirResumo(linhas: readonly LinhaDoResumo[], data: string): Promise<ConferenciaDaLinha[]> {
  const jobs = await jobsDoDia(data);
  return linhas.map((l) => conferirLinha(l, jobs));
}

/** A nota interna. Em inglês, como o resto do conteúdo do OS. */
export function notaDoResumo(
  data: string,
  conferencias: readonly ConferenciaDaLinha[],
  esperadas: number | null,
): { ok: boolean; corpo: string } {
  const faltandoLinha = esperadas != null && esperadas !== conferencias.length;
  const ok = !faltandoLinha && conferencias.length > 0 && conferencias.every((c) => c.falta.length === 0);
  const linhas = conferencias.map((c) => {
    const l = c.linha;
    const cabeca = `${l.tipo ?? "Job"} · ${l.postcode} · ${l.inicio}-${l.fim}${l.total != null ? ` · £${l.total.toFixed(2)}` : ""}`;
    if (c.job && c.falta.length === 0) {
      const extra = c.avisos.length ? `\n   ⚠️ ${c.avisos.join("; ")}` : "";
      return `✓ ${cabeca}\n   ${c.job.reference} · ${c.job.client_name ?? "?"} · ${c.job.partner_name}${extra}`;
    }
    const ref = c.job ? `${c.job.reference} · ${c.job.client_name ?? "?"} · ` : "";
    return `✗ ${cabeca}\n   ${ref}${c.falta.join("; ")}`;
  });
  const titulo = ok
    ? `✅ HARVEY — daily list for ${data}: all ${conferencias.length} job(s) are booked in the OS with a partner. Solving this ticket.`
    : `⚠️ HARVEY — daily list for ${data}: not everything is booked in the OS. Ticket stays open.`;
  const aviso = faltandoLinha
    ? `\n\nThe email says ${esperadas} job(s) but I could read ${conferencias.length} line(s). Please check the email.`
    : "";
  return { ok, corpo: `${titulo}\n\n${linhas.join("\n\n")}${aviso}` };
}

/** Quantos jobs o próprio e-mail diz que tem ("You have 2 jobs"). */
export function quantosNoAssunto(assunto: string): number | null {
  const m = String(assunto).match(/you have (\d+) jobs?/i);
  return m ? Number(m[1]) : null;
}

/**
 * Assinatura do que falta, para não repetir a mesma nota a cada 5 minutos: só
 * comenta de novo quando o quadro muda.
 */
export function assinaturaDoResumo(conferencias: readonly ConferenciaDaLinha[]): string {
  return conferencias.map((c) => `${c.linha.chave}:${c.job?.reference ?? "-"}:${c.falta.join("|")}`).join(";");
}

export type ResultadoDoResumo =
  | { status: "fechado"; data: string; corpo: string }
  | { status: "pendente"; data: string; corpo: string; assinatura: string; comentou: boolean }
  | { status: "ilegivel"; motivo: string };

function zendeskBase(): string {
  return `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
}
function zendeskAuth(): string {
  return `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64")}`;
}

/**
 * Lê o e-mail diário, confere no OS e age.
 *
 *   tudo booked  nota interna + solved na MESMA chamada (dois PUTs deixavam o
 *                ticket aberto quando o segundo falhava) + tag harvey_resumo_ok
 *   falta algo   nota interna listando o que falta, ticket fica aberto, tag
 *                harvey_resumo_faltando. A nota só se repete quando o quadro
 *                muda (`assinaturaAnterior`); quando o job aparecer no OS, a
 *                próxima passada fecha sozinha.
 *
 * `postar=false` é ensaio: lê e confere, não escreve nada.
 */
export async function tratarResumoDiario(
  ticket: { id: number; subject: string; created_at: string },
  postar: boolean,
  assinaturaAnterior?: string | null,
): Promise<ResultadoDoResumo> {
  const data = dataDoResumo(ticket.subject, ticket.created_at);
  if (!data) return { status: "ilegivel", motivo: "no date in the subject" };

  const { lerTicketCompleto } = await import("./quoter");
  const lido = await lerTicketCompleto(ticket.id);
  const linhas = linhasDoResumo(lido.thread);
  if (linhas.length === 0) return { status: "ilegivel", motivo: "no job lines in the email" };

  const conferencias = await conferirResumo(linhas, data);
  const { ok, corpo } = notaDoResumo(data, conferencias, quantosNoAssunto(ticket.subject));
  const headers = { Authorization: zendeskAuth(), "content-type": "application/json" };

  if (ok) {
    if (postar) {
      const r = await fetch(`${zendeskBase()}/tickets/${ticket.id}.json`, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          ticket: {
            status: "solved",
            comment: { public: false, body: corpo },
            // Solved exige "What Happened" (422 sem ele: o #51744 ficou aberto o dia todo, 23/10/2026).
            custom_fields: [
              { id: Number(process.env.ZENDESK_WHAT_HAPPENED_FIELD_ID?.trim() || "5687150349343"), value: "other" },
              { id: Number(process.env.ZENDESK_CLOSING_SUMMARY_FIELD_ID?.trim() || "6417950403231"), value: `Housekeep daily summary for ${data}: every job is booked in the OS with a partner.` },
            ],
          },
        }),
      });
      if (!r.ok) throw new Error(`Zendesk resolve ${ticket.id}: HTTP ${r.status}`);
      const { addTicketTags } = await import("@/lib/zendesk");
      await addTicketTags(ticket.id, [TAG_RESUMO_OK]).catch(() => undefined);
    }
    return { status: "fechado", data, corpo };
  }

  const assinatura = assinaturaDoResumo(conferencias);
  const comentou = postar && assinatura !== assinaturaAnterior;
  if (comentou) {
    const r = await fetch(`${zendeskBase()}/tickets/${ticket.id}.json`, {
      method: "PUT",
      headers,
      body: JSON.stringify({ ticket: { comment: { public: false, body: corpo } } }),
    });
    if (!r.ok) throw new Error(`Zendesk nota ${ticket.id}: HTTP ${r.status}`);
    const { addTicketTags } = await import("@/lib/zendesk");
    await addTicketTags(ticket.id, [TAG_RESUMO_FALTANDO]).catch(() => undefined);
  }
  return { status: "pendente", data, corpo, assinatura, comentou };
}
