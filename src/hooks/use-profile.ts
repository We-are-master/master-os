"use client";

import { useState, useEffect, useCallback, useMemo, createContext, useContext } from "react";
import { getSupabase } from "@/services/base";
import type { Profile } from "@/types/database";

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  /**
   * Login sem acesso ao OS (15/10/2026): não tem linha em profiles ou o perfil
   * está desativado. Parceiro e cliente do portal caem aqui e não veem o OS.
   */
  blocked: boolean;
  refresh: () => void;
}

const ProfileContext = createContext<ProfileState>({ profile: null, loading: true, blocked: false, refresh: () => {} });

export function useProfile() {
  return useContext(ProfileContext);
}

export { ProfileContext };

export function useProfileLoader(): ProfileState {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [blocked, setBlocked] = useState(false);

  const load = useCallback(async () => {
    const supabase = getSupabase();
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) {
        setProfile(null);
        setLoading(false);
        return;
      }

      const { data, error } = await supabase
        .from("profiles")
        .select("*")
        .eq("id", user.id)
        .single();

      if (data && !error) {
        const p = data as Profile;
        // Perfil desativado não entra: o OS é só da equipe.
        setBlocked(p.is_active === false);
        setProfile(p.is_active === false ? null : p);
      } else if (error?.code === "PGRST116") {
        // A consulta respondeu e não há perfil: não é equipe (parceiro, cliente
        // do portal). Antes isso virava "operator" e abria o OS inteiro.
        setBlocked(true);
        setProfile(null);
      } else {
        // A consulta falhou (rede, timeout): não dá para afirmar que não é
        // equipe, então segue como operator; o banco (is_internal_staff) é
        // quem decide o que ele lê.
        setProfile({
          id: user.id,
          email: user.email ?? "",
          full_name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User",
          role: "operator",
          is_active: true,
          custom_permissions: null,
          created_at: user.created_at,
          updated_at: user.created_at,
        });
      }
    } catch {
      setProfile(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const refresh = useCallback(() => {
    setLoading(true);
    load();
  }, [load]);

  // Stable object reference — without useMemo, every render of the layout
  // creates a fresh object, triggering every ProfileContext.Provider consumer
  // to re-render unnecessarily (and re-runs the entire dashboard tree).
  return useMemo(
    () => ({ profile, loading, blocked, refresh }),
    [profile, loading, blocked, refresh],
  );
}
