/**
 * Os motivos abertos de cada job, para a aba Action Required do OS (plano do
 * dono, 22/10/2026, etapa D). Só leitura: quem abre e resolve é
 * `sincronizarPendencias` (motivos.ts). Tabela vazia = a aba como antes.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { MOTIVOS, ROTULO_DO_MOTIVO, type Motivo } from "./motivos";

export type ChipDeMotivo = { motivo: Motivo; rotulo: string };
export type LinhaDeMotivo = { job_id: string; reason: string };

/** Status em que motivo aberto não puxa o job para a fila (o cálculo também não abre). */
const ENCERRADOS = new Set(["completed", "cancelled", "deleted"]);

/** job_id → chips na ordem de MOTIVOS, sem repetir; motivo desconhecido é ignorado. */
export function chipsPorJob(linhas: readonly LinhaDeMotivo[]): Map<string, ChipDeMotivo[]> {
  const porJob = new Map<string, Set<Motivo>>();
  for (const l of linhas) {
    if (!l?.job_id || !(MOTIVOS as readonly string[]).includes(l.reason)) continue;
    const s = porJob.get(l.job_id) ?? new Set<Motivo>();
    s.add(l.reason as Motivo);
    porJob.set(l.job_id, s);
  }
  const out = new Map<string, ChipDeMotivo[]>();
  for (const [job, s] of porJob) out.set(job, MOTIVOS.filter((m) => s.has(m)).map((motivo) => ({ motivo, rotulo: ROTULO_DO_MOTIVO[motivo] })));
  return out;
}

/** Um motivo aberto põe o job na aba, além do filtro de sempre, desde que ele não esteja encerrado. */
export function motivoPoeNaFila(job: { status: string }, temMotivoAberto: boolean): boolean {
  return temMotivoAberto && !ENCERRADOS.has(job.status);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Teto de ids no filtro da lista (vai na URL do PostgREST). */
export const MAX_IDS_COM_MOTIVO = 150;

/** Só ids válidos e no máximo MAX_IDS_COM_MOTIVO: o filtro vai interpolado no `or` do PostgREST. */
export function idsSegurosParaFiltro(ids: readonly string[]): string[] {
  return [...new Set(ids.filter((id) => UUID.test(id)))].slice(0, MAX_IDS_COM_MOTIVO);
}

/** Motivos abertos (todos ou só destes jobs). Falha de leitura = vazio, a tela segue como antes. */
export async function lerMotivosAbertos(sb: SupabaseClient, jobIds?: readonly string[]): Promise<LinhaDeMotivo[]> {
  try {
    let q = sb.from("job_attention_reasons").select("job_id, reason").is("resolved_at", null);
    if (jobIds) {
      const ids = [...new Set(jobIds.filter((id) => UUID.test(id)))];
      if (!ids.length) return [];
      q = q.in("job_id", ids.slice(0, 500));
    } else {
      q = q.order("opened_at", { ascending: false }).limit(1000);
    }
    const { data, error } = await q;
    if (error) return [];
    return (data ?? []) as LinhaDeMotivo[];
  } catch {
    return [];
  }
}
