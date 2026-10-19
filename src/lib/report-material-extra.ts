/**
 * Material comprado on site, declarado NO REPORT — e daí para o dinheiro do job.
 *
 * O parceiro (link público) ou o escritório (modal) preenche dois números no
 * relatório final: o que foi PAGO em material e o que se COBRA do cliente.
 * Cobrança em branco aplica a regra da casa: custo + 30% (mesma política do
 * supplier_prices, mig 253 — lá é piso de lista, aqui é o padrão do job).
 *
 * Aplicação nos totais reusa os patches oficiais de extra (job-extra-charges):
 *   - lado parceiro → materials_cost (reembolso; entra no self-bill semanal)
 *   - lado cliente  → extras_amount (receita; entra em margem e invoice)
 *
 * IDEMPOTENTE POR DELTA: o report pode ser editado e regravado. O que já foi
 * aplicado é lido do envelope ANTERIOR do final_report; só a diferença mexe no
 * job. Editar o custo de £40 para £25 devolve £15, não soma £25 de novo.
 *
 * O ledger (job_extra_entries) espelha o estado ATUAL do report: entradas
 * antigas do tipo `report_materials` são soft-deletadas e regravadas. Falha de
 * ledger não desfaz os totais — tabela pode nem existir (padrão do repo).
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import {
  applyCustomerExtraPatch,
  applyPartnerExtraPatch,
  reverseCustomerExtraPatch,
  reversePartnerExtraPatch,
} from "@/lib/job-extra-charges";

export const REPORT_MATERIALS_EXTRA_TYPE = "report_materials";

const round2 = (n: number) => Math.round(n * 100) / 100;

/** Markup padrão da casa para material no job: cliente paga custo + 30%. */
export const MATERIAL_CLIENT_MARKUP = 1.3;

export type MaterialExtraDoReport = {
  /** O que o parceiro pagou (reembolso). */
  cost: number;
  /** O que o cliente paga (receita). */
  charge: number;
};

/**
 * Lê os dois números do field map do relatório final. Cobrança ausente com
 * custo presente = custo × 1.30. Valores não numéricos ou ≤ 0 viram 0.
 */
export function parseMaterialExtra(
  finalData: Record<string, unknown> | null | undefined,
): MaterialExtraDoReport {
  const num = (v: unknown): number => {
    const n = Number(String(v ?? "").trim());
    return Number.isFinite(n) && n > 0 ? round2(n) : 0;
  };
  const cost = num(finalData?.materials_extra_cost);
  let charge = num(finalData?.materials_extra_charge);
  if (charge === 0 && cost > 0) charge = round2(cost * MATERIAL_CLIENT_MARKUP);
  return { cost, charge };
}

/**
 * Aplica no job a DIFERENÇA entre o que este report declara e o que o report
 * anterior já tinha aplicado. Chamada pelos dois transportes (link público do
 * parceiro e modal do escritório) logo após `persistReportSubmission`.
 *
 * Nunca lança: o report já está salvo e não pode "falhar" por causa do
 * dinheiro — problema aqui vira log e retorno para o chamador anotar.
 */
export async function aplicarMaterialExtraDoReport(
  admin: SupabaseClient,
  jobId: string,
  input: {
    finalData: Record<string, unknown>;
    /** `final_report.data` de ANTES desta gravação (null na primeira). */
    previousFinalData?: Record<string, unknown> | null;
  },
): Promise<{ applied: boolean; cost: number; charge: number; error?: string }> {
  const alvo = parseMaterialExtra(input.finalData);
  const antes = parseMaterialExtra(input.previousFinalData ?? null);
  const deltaCost = round2(alvo.cost - antes.cost);
  const deltaCharge = round2(alvo.charge - antes.charge);
  if (deltaCost === 0 && deltaCharge === 0) {
    return { applied: false, ...alvo };
  }

  try {
    const { data: jobRow, error: jobErr } = await admin
      .from("jobs")
      .select("*")
      .eq("id", jobId)
      .maybeSingle();
    if (jobErr || !jobRow) {
      return { applied: false, ...alvo, error: jobErr?.message ?? "job not found" };
    }

    // Os dois patches em sequência sobre o MESMO estado acumulado, senão o
    // segundo recalcula margem por cima de números velhos.
    let job = jobRow as Job;
    let patch: Partial<Job> = {};
    const acumular = (p: Partial<Job>) => {
      patch = { ...patch, ...p };
      job = { ...job, ...p } as Job;
    };
    if (deltaCost > 0) acumular(applyPartnerExtraPatch(job, deltaCost, "materials"));
    else if (deltaCost < 0) acumular(reversePartnerExtraPatch(job, -deltaCost, "materials"));
    if (deltaCharge > 0) acumular(applyCustomerExtraPatch(job, deltaCharge, "extras"));
    else if (deltaCharge < 0) acumular(reverseCustomerExtraPatch(job, -deltaCharge, "extras"));

    if (Object.keys(patch).length > 0) {
      const { error: upErr } = await admin.from("jobs").update(patch).eq("id", jobId);
      if (upErr) return { applied: false, ...alvo, error: upErr.message };
    }

    // Ledger espelha o estado atual: apaga as entradas antigas deste tipo e
    // regrava. Best-effort de propósito — os totais acima são a verdade.
    try {
      await admin
        .from("job_extra_entries")
        .update({
          deleted_at: new Date().toISOString(),
          deleted_by_name: "Report",
          deleted_reason: "superseded by report edit",
        })
        .eq("job_id", jobId)
        .eq("extra_type", REPORT_MATERIALS_EXTRA_TYPE)
        // As linhas das visitas extras são delas (aplicarMaterialDaVisita): não apaga.
        .not("reason", "ilike", "%(visit %")
        .is("deleted_at", null);
      const linhas = [
        alvo.cost > 0 && {
          job_id: jobId,
          side: "partner",
          extra_type: REPORT_MATERIALS_EXTRA_TYPE,
          reason: "Materials bought on site (from work report)",
          amount: alvo.cost,
          allocation: "materials",
          created_by_name: "Report",
        },
        alvo.charge > 0 && {
          job_id: jobId,
          side: "client",
          extra_type: REPORT_MATERIALS_EXTRA_TYPE,
          reason: "Materials charged to the client (from work report)",
          amount: alvo.charge,
          allocation: "extras",
          created_by_name: "Report",
        },
      ].filter(Boolean);
      if (linhas.length > 0) await admin.from("job_extra_entries").insert(linhas);
    } catch (e) {
      console.error(`[report-material] ${jobId} ledger falhou (totais aplicados):`, e);
    }

    return { applied: true, ...alvo };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "unknown error";
    console.error(`[report-material] ${jobId} falhou: ${msg}`);
    return { applied: false, ...alvo, error: msg };
  }
}

// ─── Pergunta obrigatória e recibo (19/10/2026) ──────────────────────────────

/** Chave da pergunta "comprou material?" por template (jardinagem já tinha a dela). */
export function chaveDaPerguntaDeMaterial(template: string): string | null {
  if (template === "gardener") return "materials_charges";
  if (template === "general" || template === "cleaner") return "materials_bought";
  return null;
}

/** Endereços das fotos de recibo guardadas no relatório. */
export function recibosDoMaterial(finalData: Record<string, unknown> | null | undefined): string[] {
  const v = finalData?.materials_receipt;
  return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];
}

/**
 * O que falta para o material ficar certo no relatório (dono, 19/10/2026: "nunca
 * esquecer de colocar isso no report do nosso cliente"). Vazio = pode enviar.
 *
 *  - a pergunta "comprou material?" tem que ter resposta;
 *  - Yes exige o valor pago e pelo menos uma foto do recibo.
 *
 * `recibosNoEnvio`: fotos de recibo que sobem junto com o envio (formulário do
 * escritório), ainda sem endereço no relatório.
 */
export function pendenciasDeMaterial(
  template: string,
  finalData: Record<string, unknown> | null | undefined,
  recibosNoEnvio = 0,
): string[] {
  const chave = chaveDaPerguntaDeMaterial(template);
  if (!chave) return [];
  const resposta = finalData?.[chave];
  if (resposta !== true && resposta !== false) return ["Answer: did you buy any materials for this job?"];
  if (resposta === false) return [];
  const faltas: string[] = [];
  if (parseMaterialExtra(finalData).cost <= 0) faltas.push("Materials bought on site (£): enter what you paid");
  if (recibosDoMaterial(finalData).length + recibosNoEnvio === 0) faltas.push("Photo of the receipt for the materials");
  return faltas;
}

/**
 * Material do relatório de UMA visita extra (19/10/2026). Mesmo princípio do job,
 * por delta, mas cada lado no seu lugar:
 *  - o que o parceiro pagou → `job_visits.materials_cost` (self-bill do parceiro DA VISITA);
 *  - o que o cliente paga → `jobs.extras_amount`, somando com o material das outras visitas.
 */
export async function aplicarMaterialDaVisita(
  admin: SupabaseClient,
  visita: { id: string; job_id: string; visit_index: number; materials_cost?: number | null },
  input: { finalData: Record<string, unknown>; previousFinalData?: Record<string, unknown> | null },
): Promise<{ applied: boolean; cost: number; charge: number; error?: string }> {
  const alvo = parseMaterialExtra(input.finalData);
  const antes = parseMaterialExtra(input.previousFinalData ?? null);
  const deltaCost = round2(alvo.cost - antes.cost);
  const deltaCharge = round2(alvo.charge - antes.charge);
  if (deltaCost === 0 && deltaCharge === 0) return { applied: false, ...alvo };
  try {
    if (deltaCost !== 0) {
      const novo = Math.max(0, round2(Number(visita.materials_cost ?? 0) + deltaCost));
      const { error } = await admin.from("job_visits").update({ materials_cost: novo }).eq("id", visita.id);
      if (error) return { applied: false, ...alvo, error: error.message };
    }
    if (deltaCharge !== 0) {
      const { data: jobRow } = await admin.from("jobs").select("*").eq("id", visita.job_id).maybeSingle();
      if (!jobRow) return { applied: false, ...alvo, error: "job not found" };
      const patch =
        deltaCharge > 0
          ? applyCustomerExtraPatch(jobRow as Job, deltaCharge, "extras")
          : reverseCustomerExtraPatch(jobRow as Job, -deltaCharge, "extras");
      const { error } = await admin.from("jobs").update(patch).eq("id", visita.job_id);
      if (error) return { applied: false, ...alvo, error: error.message };
    }
    try {
      const sufixo = `(visit ${visita.visit_index})`;
      await admin
        .from("job_extra_entries")
        .update({ deleted_at: new Date().toISOString(), deleted_by_name: "Report", deleted_reason: "superseded by report edit" })
        .eq("job_id", visita.job_id)
        .eq("extra_type", REPORT_MATERIALS_EXTRA_TYPE)
        .ilike("reason", `%${sufixo}%`)
        .is("deleted_at", null);
      const linhas = [
        alvo.cost > 0 && {
          job_id: visita.job_id, side: "partner", extra_type: REPORT_MATERIALS_EXTRA_TYPE,
          reason: `Materials bought on site ${sufixo}`, amount: alvo.cost, allocation: "materials", created_by_name: "Report",
        },
        alvo.charge > 0 && {
          job_id: visita.job_id, side: "client", extra_type: REPORT_MATERIALS_EXTRA_TYPE,
          reason: `Materials charged to the client ${sufixo}`, amount: alvo.charge, allocation: "extras", created_by_name: "Report",
        },
      ].filter(Boolean);
      if (linhas.length > 0) await admin.from("job_extra_entries").insert(linhas);
    } catch (e) {
      console.error(`[report-material] visita ${visita.id} ledger falhou (totais aplicados):`, e);
    }
    return { applied: true, ...alvo };
  } catch (e) {
    return { applied: false, ...alvo, error: e instanceof Error ? e.message : "unknown error" };
  }
}

/**
 * Material do job inteiro: o relatório do job (visita 1) mais o de cada visita extra
 * que mandou relatório (19/10/2026). É o que o cliente paga de material, somado.
 */
export async function materialDoJobInteiro(
  admin: SupabaseClient,
  jobId: string,
  finalReportDoJob: Record<string, unknown> | null,
): Promise<{ cost: number; charge: number; porVisita: Array<{ index: number; cost: number; charge: number; recibos: number }> }> {
  const dadosDe = (env: Record<string, unknown> | null | undefined) =>
    ((env?.data as Record<string, unknown> | undefined) ?? env ?? null) as Record<string, unknown> | null;
  const v1 = parseMaterialExtra(dadosDe(finalReportDoJob));
  const porVisita = [{ index: 1, ...v1, recibos: recibosDoMaterial(dadosDe(finalReportDoJob)).length }];
  try {
    const { data } = await admin
      .from("job_visits")
      .select("visit_index, final_report")
      .eq("job_id", jobId)
      .is("deleted_at", null)
      .neq("status", "cancelled")
      .not("final_report", "is", null)
      .order("visit_index", { ascending: true });
    for (const v of (data ?? []) as Array<{ visit_index: number; final_report: Record<string, unknown> | null }>) {
      const m = parseMaterialExtra(dadosDe(v.final_report));
      porVisita.push({ index: v.visit_index, ...m, recibos: recibosDoMaterial(dadosDe(v.final_report)).length });
    }
  } catch {
    /* sem visitas (ou sem a mig 338): fica só o job */
  }
  return {
    cost: round2(porVisita.reduce((n, v) => n + v.cost, 0)),
    charge: round2(porVisita.reduce((n, v) => n + v.charge, 0)),
    porVisita,
  };
}
