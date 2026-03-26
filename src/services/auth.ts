import { getSupabase } from "./base";
import type { Profile } from "@/types/database";
import type { Session } from "@supabase/supabase-js";

export async function signIn(email: string, password: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signInWithPassword({
    email,
    password,
  });
  if (error) throw error;
  return data;
}

export async function signUp(email: string, password: string, fullName: string) {
  const supabase = getSupabase();
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { full_name: fullName },
    },
  });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const supabase = getSupabase();
  const { error } = await supabase.auth.signOut({ scope: "global" });
  if (error) throw error;
}

/**
 * Returns the local session only after `getUser()` succeeds (verified with Supabase).
 * Prefer `getCurrentProfile()` or `getUser()` for auth checks; use this only when you need tokens from the session object.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = getSupabase();
  const { data: { user }, error: userErr } = await supabase.auth.getUser();
  if (userErr || !user) return null;
  const { data: { session } } = await supabase.auth.getSession();
  return session;
}

export async function getCurrentProfile(): Promise<Profile | null> {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", user.id)
    .single();

  return data as Profile | null;
}
