/**
 * Funil do /book sem cookie (tabela em 301).
 *
 * O site manda um evento por passo com um `visit_id` aleatório que só existe
 * na memória da página. Aqui só se limpa e grava; repetir o mesmo passo na
 * mesma visita não conta duas vezes (único em visit_id + event).
 */

import { createServiceClient } from "@/lib/supabase/service";

export const EVENTOS_DO_FUNIL = ["landing", "book_1", "book_2", "book_3", "book_4"] as const;
export type EventoDoFunil = (typeof EVENTOS_DO_FUNIL)[number];

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SERVICOS = ["clean", "paint", "fix", "cert"];

const curto = (v: unknown, max = 120): string | null => {
  if (typeof v !== "string") return null;
  const s = v.trim().replace(/\0/g, "").slice(0, max);
  return s || null;
};

export type LinhaDoFunil = {
  visit_id: string;
  event: EventoDoFunil;
  services: string | null;
  utm_source: string | null;
  utm_medium: string | null;
  utm_campaign: string | null;
  utm_content: string | null;
  landing: string | null;
};

/** O que o site mandou, virando linha. Nada fora da lista passa. */
export function linhaDoFunil(body: Record<string, unknown>): LinhaDoFunil | null {
  const visit = typeof body.visitId === "string" ? body.visitId : "";
  const evento = body.step as EventoDoFunil;
  if (!UUID.test(visit) || !EVENTOS_DO_FUNIL.includes(evento)) return null;
  const servicos = Array.isArray(body.services)
    ? (body.services as unknown[]).map(String).filter((s) => SERVICOS.includes(s))
    : [];
  const utm = (body.utm && typeof body.utm === "object" ? body.utm : {}) as Record<string, unknown>;
  const landing = curto(body.landing, 200);
  return {
    visit_id: visit.toLowerCase(),
    event: evento,
    services: servicos.length ? [...new Set(servicos)].sort().join(",") : null,
    utm_source: curto(utm.utm_source),
    utm_medium: curto(utm.utm_medium),
    utm_campaign: curto(utm.utm_campaign),
    utm_content: curto(utm.utm_content),
    // Só o caminho: query string pode trazer dado de quem clicou.
    landing: landing && landing.startsWith("/") ? landing.split(/[?#]/)[0] : null,
  };
}

export async function registrarFunil(body: Record<string, unknown>) {
  const linha = linhaDoFunil(body);
  if (!linha) return { ok: false as const, error: "evento inválido" };
  const { error } = await createServiceClient()
    .from("site_funnel_events")
    .upsert(linha, { onConflict: "visit_id,event", ignoreDuplicates: true });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}
