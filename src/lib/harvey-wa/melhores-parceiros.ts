/**
 * Quem recebe o convite de cotação. Era "os 3 a 5 melhores" (14/10/2026); desde
 * 19/10/2026 é TODO parceiro que atende o serviço no postcode (dono: "manda para
 * todos"), na ordem do ranking abaixo. Se ninguém do ofício cobre a área, tenta
 * General Maintenance antes de desistir, como o Harvey do e-mail.
 *
 * Quem pode receber continua sendo decidido por `matchPartnerIdsForWork`
 * (serviço, cobertura, postcodes excluídos, opt-in de leads). Aqui só se
 * escolhe a ordem e corta em cinco.
 *
 * A nota é a do OS: `partners.rating` (0 a 5, cai com reclamação e sobe com
 * elogio, partner-rating.ts). Empate desempata pelo compliance (documento em
 * dia) e depois por jobs feitos. Rating nulo é parceiro antigo sem avaliação e
 * vale 5, igual à tela (`displayPartnerRating`).
 *
 * Menos de 3 na área não trava nada: convida quem existe e a nota interna diz
 * quantos eram. Zero é a única coisa que chama gente.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { matchPartnerIdsForWork } from "@/lib/partner-work-matching";
import { displayPartnerRating } from "@/lib/partner-rating";

/** Sem teto: todos que atendem (dono, 19/10/2026). */
export const MAX_CONVIDADOS = Number.POSITIVE_INFINITY;
export const MIN_CONVIDADOS = 3;

export type ParceiroNoRanking = {
  id: string;
  company_name?: string | null;
  contact_name?: string | null;
  rating?: number | null;
  compliance_score?: number | null;
  jobs_completed?: number | null;
};

/** Do melhor para o pior, cortado em `max`. Pura: a ordem é a decisão que importa. */
export function ranquearParceiros<T extends ParceiroNoRanking>(lista: readonly T[], max = MAX_CONVIDADOS): T[] {
  return [...lista]
    .sort(
      (a, b) =>
        displayPartnerRating(b.rating) - displayPartnerRating(a.rating) ||
        Number(b.compliance_score ?? 0) - Number(a.compliance_score ?? 0) ||
        Number(b.jobs_completed ?? 0) - Number(a.jobs_completed ?? 0) ||
        a.id.localeCompare(b.id),
    )
    .slice(0, Math.max(0, max));
}

export function nomeDoParceiro(p: ParceiroNoRanking): string {
  return p.company_name?.trim() || p.contact_name?.trim() || "partner";
}

export async function melhoresParceirosParaCotacao(
  sb: SupabaseClient,
  a: { serviceType: string; catalogServiceId?: string | null; postcode: string | null },
): Promise<{ escolhidos: ParceiroNoRanking[]; elegiveis: number; usado: string }> {
  let usado = a.serviceType;
  let ids = await matchPartnerIdsForWork(sb, {
    serviceType: a.serviceType,
    catalogServiceId: a.catalogServiceId ?? null,
    postcode: a.postcode,
    kind: "lead",
  });
  if (ids.length === 0 && a.serviceType.toLowerCase() !== "general maintenance") {
    usado = "General Maintenance";
    ids = await matchPartnerIdsForWork(sb, { serviceType: usado, catalogServiceId: null, postcode: a.postcode, kind: "lead" });
  }
  if (ids.length === 0) return { escolhidos: [], elegiveis: 0, usado };
  const { data } = await sb
    .from("partners")
    .select("id, company_name, contact_name, rating, compliance_score, jobs_completed")
    .in("id", ids);
  return { escolhidos: ranquearParceiros((data ?? []) as ParceiroNoRanking[]), elegiveis: ids.length, usado };
}
