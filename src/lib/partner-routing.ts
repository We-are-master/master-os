/**
 * Roteamento direto de job para parceiro, por serviço do catálogo.
 *
 * Existe porque o matcher geográfico (`matchPartnerIdsForWork`) alcança 7 dos
 * 72 parceiros: oito têm coordenada de cobertura, treze têm código postal e
 * nenhum tem preferência de job cadastrada. Enquanto esses dados não existirem,
 * calcular a lista de convidados é pior do que declará-la.
 *
 * A regra é do dono, definida em 2026-08-13: um parceiro por família de
 * serviço, teto de cinco jobs por dia. O que passa do teto não é empurrado para
 * um segundo parceiro automaticamente, fica sem alocação para ele decidir, que
 * é o comportamento que ele pediu ("depois disso ou eu tiro manual e aloco pra
 * outro").
 *
 * Trades sem rota aqui (Builder, Carpenter, Painter, Plumber, Gardener, EPC)
 * continuam manuais de propósito: nenhum parceiro fixo foi nomeado para eles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const PARTNER_DAILY_CAP = 5;

const LANDLORD_CERTIFICATE = "17dcdc49-44c2-4793-a693-75bac6c1e2ef";
const FERNANDO_CORREA = "509dd6bc-2579-4136-b6c7-f0cea28e2ede";
const TM_HANDYMAN = "ad8844c5-9e81-4b39-b3df-0f5128f53a1c";

/** catalog_service_id → parceiro que recebe o job direto. */
export const PARTNER_ROUTES: Readonly<Record<string, string>> = {
  // Certificados e inspeções. LandLord Certificate cobre a família inteira.
  "e0cbd852-c10c-4aac-b52c-dfd274b65848": LANDLORD_CERTIFICATE, // (EICR)
  "2a4e3beb-9fd2-43e2-b1e0-142f621e5687": LANDLORD_CERTIFICATE, // (CP12) Gas Safety Check
  "d978384e-d1be-45ef-914a-9172f8d9fe62": LANDLORD_CERTIFICATE, // (GSC) Gas Safety Certificate
  "7796473e-c22b-4452-a22f-de1b8a87045a": LANDLORD_CERTIFICATE, // (PAT)
  "a1f8b034-28d4-4775-8c47-272df6701aa2": LANDLORD_CERTIFICATE, // (FRA)
  "ea6d7f17-1a9b-44ea-87d8-0e9ebf857431": LANDLORD_CERTIFICATE, // (FAC)
  "30b4992e-4834-4053-ac2b-f996074280f2": LANDLORD_CERTIFICATE, // (FES)
  "5770aaca-af1e-45dd-83ec-2ce92bdd1166": LANDLORD_CERTIFICATE, // Emergency Lighting
  "ce8057dd-68ee-4ebf-be9c-e2895b89c875": LANDLORD_CERTIFICATE, // Boiler Service
  "29313a19-cab4-4dcb-b29a-d930cd7dd1fc": LANDLORD_CERTIFICATE, // Electrician

  // Limpeza.
  "329a291f-1156-4ad4-8acd-ca55e2bf571d": FERNANDO_CORREA, // (DC) Deep Cleaning
  "23d48272-c129-4f97-84a2-ea5746df81d7": FERNANDO_CORREA, // (AB) After Builders
  "7e1189e1-37a8-4b8d-a6d3-73956810193c": FERNANDO_CORREA, // (EOT) End of Tenancy

  // Manutenção geral.
  "f31ba2ac-fd22-4961-9081-98e64e4b5c95": TM_HANDYMAN, // General Maintenance
};

export type PartnerRouteResult =
  | { routed: true; partnerId: string; usedToday: number }
  | { routed: false; reason: "no_route" | "cap_reached" | "lookup_failed"; partnerId?: string; usedToday?: number };

/**
 * Decide o parceiro de um job. O teto é contado pela data agendada, não pela de
 * criação: cinco jobs marcados para a mesma sexta é o que satura a agenda de
 * alguém, e não cinco jobs criados na mesma tarde para semanas diferentes.
 */
export async function routePartnerForJob(
  supabase: SupabaseClient,
  input: { catalogServiceId: string | null | undefined; scheduledDate: string | null | undefined },
): Promise<PartnerRouteResult> {
  const partnerId = input.catalogServiceId ? PARTNER_ROUTES[input.catalogServiceId] : undefined;
  if (!partnerId) return { routed: false, reason: "no_route" };
  if (!input.scheduledDate) return { routed: false, reason: "no_route", partnerId };

  const { count, error } = await supabase
    .from("jobs")
    .select("id", { count: "exact", head: true })
    .eq("partner_id", partnerId)
    .eq("scheduled_date", input.scheduledDate)
    .neq("status", "cancelled");

  if (error) {
    // Falha de leitura não pode virar alocação às cegas: um parceiro estourado
    // recebendo o sexto job é pior do que um job esperando alocação manual.
    console.error("[partner-routing] contagem falhou:", error.message);
    return { routed: false, reason: "lookup_failed", partnerId };
  }

  const usedToday = count ?? 0;
  if (usedToday >= PARTNER_DAILY_CAP) {
    return { routed: false, reason: "cap_reached", partnerId, usedToday };
  }
  return { routed: true, partnerId, usedToday };
}

/** Liga o roteamento. Sem a variável, nada é atribuído nem enviado. */
export function partnerRoutingEnabled(): boolean {
  return process.env.PARTNER_ROUTING_ENABLED === "1";
}

/**
 * Atribui o parceiro da rota e pede a confirmação dele pela side conversation
 * do ticket, com o botão de aceitar.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * O job é atribuído na hora, sem leilão. O `auto_assign` existe para quando não
 * se sabe quem vai pegar; aqui se sabe, porque há um parceiro nomeado por
 * serviço com acordo de volume diário. Leiloar o que já está combinado só
 * deixaria o job órfão esperando alguém clicar.
 *
 * Mas `partner_confirmed_at` continua nulo até ele aceitar de verdade. Atribuir
 * é ato nosso, confirmar é dele. Preencher os dois juntos daria um número bonito
 * e apagaria a única informação útil: quem recebeu e ainda não respondeu.
 *
 * O aviso vai por `confirmation_request`, que é o email que carrega o link de
 * aceite encurtado. O email com o link de relatório (`booked`) sai depois, no
 * aceite, que é a ordem certa: primeiro ele topa, depois ganha a ferramenta de
 * entregar.
 *
 * A escrita é condicional (`.is("partner_id", null)`) para que duas execuções
 * do mesmo job não troquem o parceiro de quem já foi avisado.
 */
export async function assignRoutedPartner(
  supabase: SupabaseClient,
  args: { jobId: string; partnerId: string },
): Promise<{ assigned: boolean; emailSent?: boolean; reason?: string }> {
  const { data: partner } = await supabase
    .from("partners")
    .select("id, email, phone, company_name, contact_name, zendesk_user_id")
    .eq("id", args.partnerId)
    .maybeSingle();
  if (!partner) return { assigned: false, reason: "partner_not_found" };

  const partnerName =
    (partner.contact_name as string | null)?.trim() ||
    (partner.company_name as string | null)?.trim() ||
    null;

  // `partner_confirmed_at` fica nulo de propósito. Atribuir é nosso ato;
  // confirmar é dele, e acontece em /api/jobs/confirm-acceptance. Preencher os
  // dois de uma vez daria um número bonito e apagaria a única informação que
  // interessa aqui: quem recebeu e ainda não respondeu.
  const { data: claimed, error } = await supabase
    .from("jobs")
    .update({
      partner_id: args.partnerId,
      partner_name: partnerName,
      status: "scheduled",
    })
    .eq("id", args.jobId)
    .is("partner_id", null)
    .select("id")
    .maybeSingle();

  if (error) {
    console.error("[partner-routing] atribuição falhou:", error.message);
    return { assigned: false, reason: error.message };
  }
  if (!claimed) return { assigned: false, reason: "already_assigned" };

  const { notifyPartnerJobZendesk } = await import("@/lib/notify-partner-job-zendesk-server");
  const res = await notifyPartnerJobZendesk(supabase, args.jobId, {
    kind: "confirmation_request",
    actorUserId: null,
    skipPush: false,
  });
  if (res.status >= 400) {
    // O job fica atribuído mesmo assim: desfazer deixaria o parceiro que já
    // pode ter visto o ticket sem job, e o aviso é reenviável pelo painel.
    console.error("[partner-routing] pedido de confirmação falhou:", res.body);
    return { assigned: true, emailSent: false, reason: String(res.body?.error ?? "notify_failed") };
  }
  return { assigned: true, emailSent: true };
}
