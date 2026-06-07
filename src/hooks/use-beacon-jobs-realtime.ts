"use client";

import { useEffect } from "react";
import { getSupabase } from "@/services/base";

const DEBOUNCE_MS = 300;

/**
 * Subscribes to `jobs` table changes and debounces a refetch.
 * Used by Beacon schedule page (map) and kanban board.
 */
export function useBeaconJobsRealtime(onRefresh: () => void, channelId = "beacon_jobs") {
  useEffect(() => {
    const supabase = getSupabase();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        onRefresh();
      }, DEBOUNCE_MS);
    };
    const channel = supabase
      .channel(channelId)
      .on("postgres_changes", { event: "*", schema: "public", table: "jobs" }, schedule)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      supabase.removeChannel(channel);
    };
  }, [onRefresh, channelId]);
}
