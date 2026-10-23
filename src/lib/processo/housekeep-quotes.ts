/**
 * Quotes da Housekeep no v2 (plano do dono, 22/10/2026).
 *
 * No lugar da janela de 2h e do aviso de 26h da varredura de lances:
 *   - lance viável chegou: processa NA HORA (não espera janela nenhuma);
 *   - 8h depois do primeiro convite sem lance viável: nota interna, uma vez;
 *   - 48h sem lance viável (era 36h; dono, 23/10/2026): relê o ticket; se ninguém da equipe respondeu à mão,
 *     manda o "sem disponibilidade" (textos.ts) no ticket, uma vez
 *     (`housekeep-sem-disponibilidade:<quoteId>`), e fecha a quote como rejected
 *     com o motivo. Se alguém respondeu, não manda nada e deixa com a equipe.
 *   - antes de qualquer envio automático do preço: se a equipe já mandou uma
 *     quote à mão (resposta pública com £), não processa.
 *
 * As decisões são puras; o envio recebe as dependências para dar para testar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";
import { HOUSEKEEP_SEM_DISPONIBILIDADE_HTML, HOUSEKEEP_SEM_DISPONIBILIDADE_MOTIVO, preencherTexto } from "./textos";

export const HK_CHECAGEM_HORAS = 8;
export const HK_SEM_DISPONIBILIDADE_HORAS = 48;

/** Marcas em quotes.automation_status. */
export const HK_MARCA_8H = "housekeep_no_bid_8h";
export const HK_MARCA_SEM_DISPONIBILIDADE = "housekeep_no_availability_sent";
export const HK_MARCA_EQUIPE_RESPONDEU = "housekeep_team_replied";

/** Marcas que encerram a automação desta quote. */
const MARCAS_FINAIS = new Set([HK_MARCA_SEM_DISPONIBILIDADE, HK_MARCA_EQUIPE_RESPONDEU, "no_bids_reported", "no_bids_ticket_closed"]);

export type PassoHousekeep = "nada" | "esperar" | "avisar_8h" | "processar" | "fechar_48h";

export function passoDaQuoteHousekeep(i: { horasDesdeConvite: number; temLanceViavel: boolean; marca: string | null | undefined }): PassoHousekeep {
  if (i.marca && MARCAS_FINAIS.has(i.marca)) return "nada";
  if (i.temLanceViavel) return "processar";
  if (i.horasDesdeConvite >= HK_SEM_DISPONIBILIDADE_HORAS) return "fechar_48h";
  if (i.horasDesdeConvite >= HK_CHECAGEM_HORAS && i.marca !== HK_MARCA_8H) return "avisar_8h";
  return "esperar";
}

export type PassoDepoisDoHistorico = "processar" | "sem_disponibilidade" | "equipe_respondeu";

/**
 * O passo depois de reler o ticket. `processar` só para quando a equipe já
 * mandou preço à mão; `fechar_48h` para com QUALQUER resposta manual.
 */
export function passoDepoisDoHistorico(
  passo: "processar" | "fechar_48h",
  h: { respostaManual: boolean; respostaManualComPreco: boolean },
): PassoDepoisDoHistorico {
  if (passo === "processar") return h.respostaManualComPreco ? "equipe_respondeu" : "processar";
  return h.respostaManual ? "equipe_respondeu" : "sem_disponibilidade";
}

export type QuoteHousekeep = { id: string; reference: string; external_ref: string };

export type DependenciasDoAviso = {
  postarPublico: (ticketId: number, html: string) => Promise<void>;
  /** Status do ticket acompanha a quote (best-effort). */
  sincronizarStatus?: (quoteId: string) => Promise<unknown>;
};

export type ResultadoDoAviso = { enviado: boolean; linha: string };

/** Manda o "sem disponibilidade" uma vez e fecha a quote. */
export async function avisarSemDisponibilidade(
  sb: SupabaseClient,
  q: QuoteHousekeep,
  deps: DependenciasDoAviso,
): Promise<ResultadoDoAviso> {
  const ticketId = Number(q.external_ref);
  if (!Number.isFinite(ticketId) || ticketId <= 0) return { enviado: false, linha: "no ticket on the quote" };
  const chave = chaveDeEnvio("housekeep-sem-disponibilidade", q.id);
  const reserva = await reservarEnvio(sb, {
    chave,
    finalidade: "housekeep-sem-disponibilidade",
    canal: "email",
    quoteId: q.id,
    ticketId,
    template: "housekeep_no_availability",
    motivo: HOUSEKEEP_SEM_DISPONIBILIDADE_MOTIVO,
  });
  if (!reserva.reservado) return { enviado: false, linha: `not sent: ${reserva.motivo ?? "already reserved"}` };
  try {
    const html = preencherTexto(HOUSEKEEP_SEM_DISPONIBILIDADE_HTML, { referenciaEntreParenteses: "" });
    await deps.postarPublico(ticketId, html);
    await confirmarEnvio(sb, chave, `zendesk:${ticketId}`);
  } catch (e) {
    await falhouEnvio(sb, chave, e).catch(() => undefined);
    return { enviado: false, linha: `send failed: ${e instanceof Error ? e.message.slice(0, 120) : String(e)}` };
  }
  const { error } = await sb
    .from("quotes")
    .update({
      status: "rejected",
      rejection_reason: HOUSEKEEP_SEM_DISPONIBILIDADE_MOTIVO,
      automation_status: HK_MARCA_SEM_DISPONIBILIDADE,
      bidding_started_at: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", q.id);
  if (error) return { enviado: true, linha: `sent, but the quote did not close: ${error.message}` };
  if (deps.sincronizarStatus) await deps.sincronizarStatus(q.id).catch(() => undefined);
  return { enviado: true, linha: "no-availability sent, quote closed" };
}
