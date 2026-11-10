"use client";

import { getSupabase } from "@/services/base";
import { getAccountServicePrice } from "@/services/account-service-prices";
import { getPartnerServicePrice } from "@/services/partner-service-prices";
import { resolveJobPricing } from "@/lib/job-pricing-resolver";
import { resolveInitialBilledHours } from "@/lib/job-hourly-billing";
import type { CatalogService, Job } from "@/types/database";

export type TaxasPorHora = {
  clientRate: number;
  partnerRate: number;
  /** Horas iniciais: as do Rate card da conta (o call out combinado) ou as do catálogo. */
  hours: number;
  /** De onde veio a taxa do cliente, para a tela dizer. */
  fonte: "account" | "catalog" | "job";
};

/**
 * Taxas para o job virar Hourly, com o Rate card da conta na frente do catálogo
 * (dono, 10/11/2026: JOB-9831 da Crestview virou £72/h com acordo de £45/h e
 * call out de 2h). Mesmo resolvedor do New job e das visitas.
 */
export async function taxasPorHoraDoJob(
  job: Pick<Job, "catalog_service_id" | "client_id" | "partner_id" | "hourly_client_rate" | "hourly_partner_rate" | "billed_hours"> & {
    account_id?: string | null;
  },
): Promise<TaxasPorHora> {
  const doJob: TaxasPorHora = {
    clientRate: Number(job.hourly_client_rate ?? 0) || 0,
    partnerRate: Number(job.hourly_partner_rate ?? 0) || 0,
    hours: resolveInitialBilledHours(null, job.billed_hours ?? null),
    fonte: "job",
  };
  const servico = job.catalog_service_id?.trim();
  if (!servico) return doJob;
  const sb = getSupabase();
  const { data: cat } = await sb.from("service_catalog").select("*").eq("id", servico).maybeSingle();
  if (!cat) return doJob;

  let conta = job.account_id?.trim() || null;
  if (!conta && job.client_id?.trim()) {
    const { data } = await sb.from("clients").select("source_account_id").eq("id", job.client_id.trim()).maybeSingle();
    conta = (data as { source_account_id?: string | null } | null)?.source_account_id?.trim() || null;
  }
  const parceiro = job.partner_id?.trim() || null;
  const [accountOverride, partnerOverride] = await Promise.all([
    conta ? getAccountServicePrice(conta, servico).catch(() => null) : Promise.resolve(null),
    parceiro ? getPartnerServicePrice(parceiro, servico).catch(() => null) : Promise.resolve(null),
  ]);
  const r = resolveJobPricing({ catalog: cat as CatalogService, accountOverride, partnerOverride });
  const deConta = r.client.hourly_rate_source === "custom" || r.client.default_hours_source === "custom";
  return {
    clientRate: r.client.hourly_rate ?? doJob.clientRate,
    partnerRate: r.partner.hourly_partner_rate ?? doJob.partnerRate,
    hours: resolveInitialBilledHours(r.client.default_hours ?? null),
    fonte: deConta ? "account" : "catalog",
  };
}
