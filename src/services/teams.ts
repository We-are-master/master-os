import { getSupabase, softDeleteById } from "./base";
import type { Squad, TeamMember } from "@/types/database";

export async function listSquads(): Promise<Squad[]> {
  const { data, error } = await getSupabase()
    .from("squads")
    .select("*")
    .is("deleted_at", null)
    .order("name", { ascending: true });
  if (error) throw error;
  return (data ?? []) as Squad[];
}

export async function createSquad(name: string): Promise<Squad> {
  const { data, error } = await getSupabase()
    .from("squads")
    .insert({ name })
    .select()
    .single();
  if (error) throw error;
  return data as Squad;
}

export async function updateSquad(id: string, updates: Partial<Pick<Squad, "name">>): Promise<void> {
  const { error } = await getSupabase()
    .from("squads")
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

export async function deleteSquad(id: string): Promise<void> {
  await softDeleteById("squads", id);
}

export async function listTeamMembers(): Promise<TeamMember[]> {
  const { data, error } = await getSupabase()
    .from("team_members")
    .select(`
      *,
      squads(name)
    `)
    .is("deleted_at", null)
    .order("full_name", { ascending: true });
  if (error) throw error;
  const rows = (data ?? []) as (TeamMember & { squads: { name: string } | null })[];
  return rows.map((r) => ({
    ...r,
    squad_name: r.squads?.name,
    squads: undefined,
  })) as TeamMember[];
}

export async function createTeamMember(
  payload: Omit<TeamMember, "id" | "created_at" | "updated_at" | "squad_name">
): Promise<TeamMember> {
  const { data, error } = await getSupabase()
    .from("team_members")
    .insert({
      full_name: payload.full_name,
      email: payload.email ?? null,
      phone: payload.phone ?? null,
      role: payload.role,
      squad_id: payload.squad_id ?? null,
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
  updates: Partial<Pick<TeamMember, "full_name" | "email" | "phone" | "role" | "squad_id" | "base_salary" | "start_date" | "status">>
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
