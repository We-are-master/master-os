"use client";

import { useState, useEffect, useCallback, createContext, useContext } from "react";
import { getSupabase } from "@/services/base";
import type { Profile } from "@/types/database";

interface ProfileState {
  profile: Profile | null;
  loading: boolean;
  refresh: () => void;
}

const ProfileContext = createContext<ProfileState>({ profile: null, loading: true, refresh: () => {} });

export function useProfile() {
  return useContext(ProfileContext);
}

export { ProfileContext };

export function useProfileLoader(): ProfileState {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);

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
        setProfile(data as Profile);
      } else {
        setProfile({
          id: user.id,
          email: user.email ?? "",
          full_name: user.user_metadata?.full_name ?? user.email?.split("@")[0] ?? "User",
          role: "admin",
          is_active: true,
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

  return { profile, loading, refresh };
}
