/**
 * O diário de decisões do Harvey (tabela `harvey_diario`, migration 327).
 *
 * Cada ponto onde ele decide algo grava uma linha: o que decidiu (inglês, uma
 * linha), qual regra seguiu e o que ficou pendente, com quem. O brief das 8h
 * lê as pendências de ontem.
 *
 * Nunca derruba quem chamou: sem tabela (o dono roda o SQL à mão), sem
 * Supabase ou com erro, só loga e segue.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

export type OrigemDoDiario = "whatsapp" | "lances" | "followup" | "quotes";

export type Decisao = {
  origem: OrigemDoDiario;
  decisao: string;
  regra: string;
  pendente?: string | null;
  ticketId?: number | string | null;
  quoteRef?: string | null;
  jobRef?: string | null;
};

let semTabela = false;

function ticketNumero(v: Decisao["ticketId"]): number | null {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
}

/** Grava a decisão. Nunca lança. */
export async function registrarDecisao(d: Decisao, sb?: SupabaseClient): Promise<void> {
  if (semTabela) return;
  try {
    const cliente = sb ?? createServiceClient();
    const { error } = await cliente.from("harvey_diario").insert({
      origem: d.origem,
      decisao: d.decisao.replace(/\s+/g, " ").trim().slice(0, 500),
      regra: d.regra.replace(/\s+/g, " ").trim().slice(0, 300),
      pendente: d.pendente?.trim() ? d.pendente.replace(/\s+/g, " ").trim().slice(0, 300) : null,
      ticket_id: ticketNumero(d.ticketId),
      quote_ref: d.quoteRef ?? null,
      job_ref: d.jobRef ?? null,
    });
    if (error) {
      // Tabela ainda não existe: para de tentar até o próximo deploy.
      if (/PGRST205|42P01|could not find the table|does not exist/i.test(`${error.code ?? ""} ${error.message}`)) {
        semTabela = true;
        console.warn("[harvey-diario] tabela harvey_diario não existe (rodar a migration 327); diário desligado");
      } else console.error("[harvey-diario]", error.message);
    }
  } catch (e) {
    console.error("[harvey-diario]", e instanceof Error ? e.message : e);
  }
}
