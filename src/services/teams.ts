import { getSupabase, softDeleteById } from "./base";
import type { BusinessUnit, TeamMember } from "@/types/database";

function uniqueSlugFromName(name: string): string {
  const base = name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
  return `${base || "bu"}-${Date.now().toString(36)}`;
}

export async function listBusinessUnits(): Promise<BusinessUnit[]> {
  const { data, error } = await getSupabase()
    .from("business_units")
    .select("*")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as BusinessUnit[];
}

export async function createBusinessUnit(name: string): Promise<BusinessUnit> {
  const supabase = getSupabase();
  const trimmed = name.trim();
  if (!trimmed) throw new Error("Name is required");
  const now = new Date().toISOString();
  const slug = uniqueSlugFromName(trimmed);

  const payloads: Record<string, unknown>[] = [
    { name: trimmed, created_at: now, updated_at: now },
    { name: trimmed },
    { name: trimmed, slug, created_at: now, updated_at: now },
    { name: trimmed, slug },
  ];

  let lastErr: { message?: string; code?: string } | null = null;
  for (const row of payloads) {
    const { data, error } = await supabase.from("business_units").insert(row).select().single();
    if (!error && data) return data as BusinessUnit;
    lastErr = error as { message?: string; code?: string };
  }

  if (lastErr?.message) throw new Error(lastErr.message);
  throw new Error("Could not create business unit");
}

export async function updateBusinessUnit(
  id: string,
  updates: Partial<Pick<BusinessUnit, "name">>,
): Promise<void> {
  const { error } = await getSupabase()
    .from("business_units")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteBusinessUnit(id: string): Promise<void> {
  await softDeleteById("business_units", id);
}

// Deprecated aliases — kept so in-flight callers don't break during rename.
/** @deprecated Use `listBusinessUnits`. */
export const listSquads = listBusinessUnits;
/** @deprecated Use `createBusinessUnit`. */
export const createSquad = createBusinessUnit;
/** @deprecated Use `updateBusinessUnit`. */
export const updateSquad = updateBusinessUnit;
/** @deprecated Use `deleteBusinessUnit`. */
export const deleteSquad = deleteBusinessUnit;

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await getSupabase()
    .from("team_members")
    .select(`
      *,
      business_units(name)
    `)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as (TeamMember & { business_units: { name: string } | null })[];
  return rows.map((r) => ({
    ...r,
    bu_name: r.business_units?.name,
    business_units: undefined,
  })) as TeamMember[];
}

export async function createTeamMember(
  payload: Omit<TeamMember, "id" | "created_at" | "updated_at" | "bu_name">,
): Promise<TeamMember> {
  const { data, error } = await getSupabase()
    .from("team_members")
    .insert({
      full_name: payload.full_name,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      role: payload.role,
      bu_id: payload.bu_id ?? null,
      base_salary: payload.base_salary ?? null,
      start_date: payload.start_date ?? null,
      status: payload.status ?? "active",
      profile_id: payload.profile_id ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return data as TeamMember;
}

export async function updateTeamMember(
  id: string,
  updates: Partial<
    Pick<
      TeamMember,
      "full_name" | "email" | "phone" | "role" | "bu_id" | "base_salary" | "start_date" | "status" | "profile_id"
    >
  >,
): Promise<void> {
  const { error } = await getSupabase()
    .from("team_members")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteTeamMember(id: string): Promise<void> {
  await softDeleteById("team_members", id);
}
