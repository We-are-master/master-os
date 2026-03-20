import { getSupabase } from "./base";

export interface AssignableUser {
  id: string;
  full_name: string;
  email?: string;
  role?: string;
}

export async function listAssignableUsers(): Promise<AssignableUser[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("profiles")
    .select("id, full_name, email, role, is_active")
    .eq("is_active", true)
    .order("full_name", { ascending: true });

  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Array<{
    id: string;
    full_name?: string | null;
    email?: string | null;
    role?: string | null;
  }>;

  return rows.map((u) => ({
    id: u.id,
    full_name: u.full_name ?? u.email ?? "User",
    email: u.email ?? undefined,
    role: u.role ?? undefined,
  }));
}
