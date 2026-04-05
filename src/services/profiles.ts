import { getSupabase } from "./base";

export interface AssignableUser {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
  /** false = user deactivated in Team; still listable so admins can assign commission owners. */
  is_active?: boolean;
}

/**
 * All internal profiles (admin/manager/operator), not only active ones.
 * Inactive users were previously hidden from the Job owner dropdown — that looked like "missing" users.
 */
export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase.from("profiles").select("id, full_name, email, role, is_active").order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    full_name?: string | null;
    email?: string | null;
    role?: string | null;
    is_active?: boolean | null;
  }>;

  const mapped = rows.map((u) => ({
    id: u.id,
    full_name: u.full_name?.trim() || u.email?.trim() || "User",
    email: u.email ?? undefined,
    role: u.role ?? undefined,
    is_active: u.is_active !== false,
  }));

  mapped.sort((a, b) => {
    if (a.is_active !== b.is_active) return a.is_active ? -1 : 1;
    return a.full_name.localeCompare(b.full_name, undefined, { sensitivity: "base" });
  });

  return mapped;
}

/** Internal assignees with `is_active` — for account owner, job owner, etc. (excludes deactivated Team users). */
export async function listActiveAssignableUsers(): Promise<AssignableUser[]> {
  const all = await listAssignableUsers();
  return all.filter((u) => u.is_active);
}
