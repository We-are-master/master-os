import { getSupabase } from "./base";
import type { Account, CrmDeal, CrmStage, CrmStageKind } from "@/types/database";

/**
 * CRM B2B (mig 311). Tudo roda no navegador com a sessão do escritório; a RLS
 * (is_internal_staff) é quem garante que só a equipe lê e grava.
 */

export async function listCrmStages(): Promise<CrmStage[]> {
  const { data, error } = await getSupabase().from("crm_stages").select("*").order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmStage[];
}

export async function listCrmDeals(): Promise<CrmDeal[]> {
  const { data, error } = await getSupabase()
    .from("crm_deals")
    .select("*")
    .is("deleted_at", null)
    .order("position", { ascending: true });
  if (error) throw new Error(error.message);
  return (data ?? []) as CrmDeal[];
}

export type CrmDealInput = Partial<Omit<CrmDeal, "id" | "created_at" | "updated_at" | "deleted_at">> & {
  company_name: string;
  stage_id: string;
};

async function userId(): Promise<string | null> {
  try {
    const { data } = await getSupabase().auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

/** Card novo entra no fim da coluna. */
function nextPosition(): number {
  return Date.now() / 1000;
}

export async function createCrmDeal(input: CrmDealInput): Promise<CrmDeal> {
  const { data, error } = await getSupabase()
    .from("crm_deals")
    .insert({ ...input, position: input.position ?? nextPosition(), created_by: await userId() })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CrmDeal;
}

export async function updateCrmDeal(id: string, patch: Partial<CrmDeal>): Promise<CrmDeal> {
  const rest: Partial<CrmDeal> = { ...patch };
  delete rest.id;
  delete rest.created_at;
  delete rest.updated_at;
  const { data, error } = await getSupabase().from("crm_deals").update(rest).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as CrmDeal;
}

export async function moveCrmDeal(id: string, stageId: string): Promise<CrmDeal> {
  return updateCrmDeal(id, { stage_id: stageId, position: nextPosition() });
}

export async function deleteCrmDeal(id: string): Promise<void> {
  const { error } = await getSupabase().from("crm_deals").update({ deleted_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

export async function createCrmStage(name: string, kind: CrmStageKind = "open", color = "slate"): Promise<CrmStage> {
  const stages = await listCrmStages();
  const position = stages.length ? Math.max(...stages.map((s) => s.position)) + 1 : 0;
  const { data, error } = await getSupabase()
    .from("crm_stages")
    .insert({ name: name.trim(), kind, color, position })
    .select()
    .single();
  if (error) throw new Error(error.message);
  return data as CrmStage;
}

export async function updateCrmStage(id: string, patch: Partial<Pick<CrmStage, "name" | "color" | "kind">>): Promise<CrmStage> {
  const clean = { ...patch, ...(patch.name !== undefined ? { name: patch.name.trim() } : {}) };
  const { data, error } = await getSupabase().from("crm_stages").update(clean).eq("id", id).select().single();
  if (error) throw new Error(error.message);
  return data as CrmStage;
}

/** Grava a ordem das etapas como está na lista recebida (0, 1, 2…). */
export async function reorderCrmStages(orderedIds: string[]): Promise<void> {
  const sb = getSupabase();
  for (const [position, id] of orderedIds.entries()) {
    const { error } = await sb.from("crm_stages").update({ position }).eq("id", id);
    if (error) throw new Error(error.message);
  }
}

/**
 * Apaga uma etapa. Se ainda houver cards nela, eles vão antes para
 * `moveDealsTo`; sem destino, a etapa com cards não é apagada.
 */
export async function deleteCrmStage(id: string, moveDealsTo?: string): Promise<void> {
  const sb = getSupabase();
  const { count, error: countError } = await sb
    .from("crm_deals")
    .select("id", { count: "exact", head: true })
    .eq("stage_id", id)
    .is("deleted_at", null);
  if (countError) throw new Error(countError.message);
  if ((count ?? 0) > 0) {
    if (!moveDealsTo || moveDealsTo === id) throw new Error("Choose where the cards in this stage should go.");
    const { error: moveError } = await sb.from("crm_deals").update({ stage_id: moveDealsTo }).eq("stage_id", id).is("deleted_at", null);
    if (moveError) throw new Error(moveError.message);
  }
  // Cards apagados (deleted_at) ainda apontam para a etapa; mudam junto para a FK deixar apagar.
  if (moveDealsTo && moveDealsTo !== id) {
    await sb.from("crm_deals").update({ stage_id: moveDealsTo }).eq("stage_id", id);
  }
  const { error } = await sb.from("crm_stages").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

export type CrmAccountOption = Pick<Account, "id" | "company_name" | "status" | "industry" | "contact_name" | "email" | "contact_number"> & {
  inCrm: boolean;
};

/** Contas do OS, marcando as que já têm card no CRM. */
export async function listAccountsForCrm(): Promise<CrmAccountOption[]> {
  const sb = getSupabase();
  const [{ data: accounts, error }, { data: deals, error: dealsError }] = await Promise.all([
    sb.from("accounts").select("id, company_name, status, industry, contact_name, email, contact_number").is("deleted_at", null).order("company_name"),
    sb.from("crm_deals").select("account_id").is("deleted_at", null).not("account_id", "is", null),
  ]);
  if (error) throw new Error(error.message);
  if (dealsError) throw new Error(dealsError.message);
  const inCrm = new Set((deals ?? []).map((d) => d.account_id as string));
  return ((accounts ?? []) as CrmAccountOption[]).map((a) => ({ ...a, inCrm: inCrm.has(a.id) }));
}

export async function importAccountsToCrm(accounts: CrmAccountOption[], stageId: string): Promise<number> {
  const rows = accounts
    .filter((a) => !a.inCrm)
    .map((a, i) => ({
      company_name: a.company_name,
      account_id: a.id,
      stage_id: stageId,
      segment: a.industry && a.industry !== "General" ? a.industry : null,
      contact_name: a.contact_name || null,
      contact_email: a.email || null,
      contact_phone: a.contact_number || null,
      source: "Existing account",
      position: nextPosition() + i / 1000,
    }));
  if (!rows.length) return 0;
  const created_by = await userId();
  const { error } = await getSupabase().from("crm_deals").insert(rows.map((r) => ({ ...r, created_by })));
  if (error) throw new Error(error.message);
  return rows.length;
}

export type CrmImportRow = Omit<CrmDealInput, "stage_id">;

/** Importa linhas de CSV, pulando empresas que já estão no CRM (mesmo nome). */
export async function importRowsToCrm(rows: CrmImportRow[], stageId: string): Promise<{ created: number; skipped: number }> {
  const existing = await listCrmDeals();
  const seen = new Set(existing.map((d) => d.company_name.trim().toLowerCase()));
  const fresh: CrmImportRow[] = [];
  for (const r of rows) {
    const key = r.company_name.trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    fresh.push(r);
  }
  if (fresh.length) {
    const created_by = await userId();
    const base = nextPosition();
    // Lotes de 200 para não estourar o corpo da requisição.
    for (let i = 0; i < fresh.length; i += 200) {
      const chunk = fresh.slice(i, i + 200).map((r, j) => ({ ...r, stage_id: stageId, position: base + (i + j) / 1000, created_by }));
      const { error } = await getSupabase().from("crm_deals").insert(chunk);
      if (error) throw new Error(error.message);
    }
  }
  return { created: fresh.length, skipped: rows.length - fresh.length };
}
