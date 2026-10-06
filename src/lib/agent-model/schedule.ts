/**
 * Qual dos dois tipos de trabalho um job é, no modelo de agente (06/10/2026).
 *
 * Schedule A, "Platform Bookings": cliente direto da Fixfy (site, Harvey no
 * WhatsApp, cliente sem conta de empresa). A Fixfy é AGENTE do parceiro: o
 * contrato do serviço é entre cliente e parceiro, o recibo sai no nome do
 * parceiro e a receita da Fixfy é só a comissão (com VAT incluído).
 *
 * Schedule B, "Fixfy Client Work": job de conta de empresa ou plataforma
 * (Housekeep, Fantastic, Checkatrade, imobiliária, qualquer conta). A Fixfy é
 * PRINCIPAL, subcontrata o parceiro e paga por self-billing. Nada muda aqui.
 *
 * A REGRA, na ordem em que vale:
 *
 *   1. Modelo desligado (`FIXFY_AGENT_MODEL` diferente de `on`)  → B.
 *      Subir este código não muda documento nenhum. Ligar é decisão do dono,
 *      junto com a ativação dos contratos 2026-10-06 (migration 312).
 *   2. Job criado antes de `FIXFY_AGENT_MODEL_FROM` (YYYY-MM-DD), se definido → B.
 *   3. Job sem cliente (`client_id` nulo, ou cliente não encontrado)      → B.
 *      Sem cliente não há como provar que é direto; B é o comportamento de
 *      sempre, e errar para B nunca põe o nome de um parceiro num documento
 *      de conta de empresa.
 *   4. Cliente sem conta de origem (`clients.source_account_id` nulo)      → A.
 *   5. Conta de origem = a conta corporativa "Fixfy" (`FIXFY_ACCOUNT_ID`,
 *      ou a conta chamada Fixfy): é a que o site B2C e o Harvey carimbam
 *      em toda reserva                                                    → A.
 *   6. Qualquer outra conta (Housekeep, Fantastic, Checkatrade, Express,
 *      imobiliária, plataforma)                                           → B.
 *
 * Conta de empresa é o que decide, não o canal: um job da Checkatrade que
 * chegou por WhatsApp continua B, porque está ligado à conta Checkatrade.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { tryGetFixfyAccountId } from "@/lib/fixfy-account";

export type WorkSchedule = "A" | "B";

/** Interruptor do modelo de agente. Desligado por padrão, de propósito. */
export function agentModelEnabled(): boolean {
  return process.env.FIXFY_AGENT_MODEL?.trim().toLowerCase() === "on";
}

/** Data de corte opcional (YYYY-MM-DD, Londres). Nula = sem corte. */
export function agentModelEffectiveFrom(): string | null {
  const raw = process.env.FIXFY_AGENT_MODEL_FROM?.trim() ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(raw) ? raw : null;
}

export type ScheduleInput = {
  /** O job tem cliente gravado e o cliente foi encontrado. */
  hasClient: boolean;
  /** `clients.source_account_id` do cliente do job. */
  sourceAccountId: string | null | undefined;
  /** Id da conta corporativa "Fixfy" (site B2C / Harvey). */
  fixfyAccountId: string | null | undefined;
  /** `jobs.created_at`, para a data de corte opcional. */
  jobCreatedAt?: string | null;
};

export type ScheduleOptions = {
  enabled?: boolean;
  effectiveFrom?: string | null;
};

/** A regra pura (sem banco). Ver o comentário do arquivo. */
export function classifyWorkSchedule(input: ScheduleInput, opts?: ScheduleOptions): WorkSchedule {
  const enabled = opts?.enabled ?? agentModelEnabled();
  if (!enabled) return "B";

  const from = opts && "effectiveFrom" in opts ? opts.effectiveFrom ?? null : agentModelEffectiveFrom();
  if (from && input.jobCreatedAt) {
    const created = String(input.jobCreatedAt).slice(0, 10);
    if (/^\d{4}-\d{2}-\d{2}$/.test(created) && created < from) return "B";
  }

  if (!input.hasClient) return "B";
  const source = String(input.sourceAccountId ?? "").trim();
  if (!source) return "A";
  const fixfy = String(input.fixfyAccountId ?? "").trim();
  if (fixfy && source === fixfy) return "A";
  return "B";
}

export type JobForSchedule = {
  id: string;
  client_id?: string | null;
  created_at?: string | null;
};

/**
 * Classifica vários jobs com UMA consulta de clientes.
 * Modelo desligado: devolve tudo B sem tocar no banco.
 */
export async function resolveWorkSchedules(
  supabase: SupabaseClient,
  jobs: JobForSchedule[],
): Promise<Map<string, WorkSchedule>> {
  const out = new Map<string, WorkSchedule>();
  if (!agentModelEnabled()) {
    for (const j of jobs) out.set(j.id, "B");
    return out;
  }

  const clientIds = [...new Set(jobs.map((j) => String(j.client_id ?? "").trim()).filter(Boolean))];
  const sourceByClient = new Map<string, string | null>();
  if (clientIds.length > 0) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, source_account_id")
      .in("id", clientIds);
    if (error) {
      // Sem prova não há A: errar para B mantém o documento de sempre.
      console.error("[agent-model] clients lookup failed, falling back to Schedule B:", error.message);
      for (const j of jobs) out.set(j.id, "B");
      return out;
    }
    for (const row of (data ?? []) as { id: string; source_account_id: string | null }[]) {
      sourceByClient.set(row.id, row.source_account_id ?? null);
    }
  }

  const fixfyAccountId = await tryGetFixfyAccountId(supabase);
  for (const j of jobs) {
    const cid = String(j.client_id ?? "").trim();
    out.set(
      j.id,
      classifyWorkSchedule({
        hasClient: Boolean(cid) && sourceByClient.has(cid),
        sourceAccountId: cid ? sourceByClient.get(cid) : null,
        fixfyAccountId,
        jobCreatedAt: j.created_at ?? null,
      }),
    );
  }
  return out;
}

export async function resolveJobWorkSchedule(
  supabase: SupabaseClient,
  job: JobForSchedule,
): Promise<WorkSchedule> {
  const map = await resolveWorkSchedules(supabase, [job]);
  return map.get(job.id) ?? "B";
}

/**
 * Para documentos sem job (quote): classifica pelo cliente / conta de origem.
 * `sourceAccountId` já resolvido evita reler o cliente.
 */
export async function resolveClientWorkSchedule(
  supabase: SupabaseClient,
  input: { clientId?: string | null; sourceAccountId?: string | null },
): Promise<WorkSchedule> {
  if (!agentModelEnabled()) return "B";
  const clientId = String(input.clientId ?? "").trim();
  if (!clientId) return "B";
  let source = input.sourceAccountId;
  if (source === undefined) {
    const { data, error } = await supabase
      .from("clients")
      .select("id, source_account_id")
      .eq("id", clientId)
      .maybeSingle();
    if (error || !data) return "B";
    source = (data as { source_account_id?: string | null }).source_account_id ?? null;
  }
  const fixfyAccountId = await tryGetFixfyAccountId(supabase);
  return classifyWorkSchedule({ hasClient: true, sourceAccountId: source, fixfyAccountId });
}
