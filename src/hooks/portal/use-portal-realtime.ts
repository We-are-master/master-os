"use client";

import { useEffect, useRef } from "react";
import { getSupabase } from "@/services/base";

type AnyRow = Record<string, unknown>;
type Handler = (payload: { eventType: string; new: AnyRow; old: AnyRow }) => void;

/**
 * Subscribe to an account-scoped realtime channel.
 *
 * Safety: RLS on the table (see migration 142) limits what the client can
 * even SEE — so even if Supabase Realtime broadcasts a row cross-tenant,
 * the client's subsequent SELECT refresh would return nothing. We still
 * filter on the channel so we don't waste bandwidth relaying events for
 * other accounts.
 *
 * Usage:
 *   useAccountScopedRealtime({
 *     table: "tickets",
 *     filter: `account_id=eq.${accountId}`,
 *     onChange: () => router.refresh(),
 *   });
 */
export function useAccountScopedRealtime(opts: {
  table: string;
  filter?: string;
  event?: "INSERT" | "UPDATE" | "DELETE" | "*";
  onChange: Handler;
  /** Stable channel name suffix so concurrent subscribers don't collide. */
  channelSuffix?: string;
  /** Skip subscribe when falsy (e.g. auth still loading) */
  enabled?: boolean;
}) {
  const handlerRef = useRef(opts.onChange);
  handlerRef.current = opts.onChange;

  const { table, filter, event = "*", channelSuffix = "", enabled = true } = opts;

  useEffect(() => {
    if (!enabled) return;
    const supabase = getSupabase();
    const channelName = `portal-${table}${channelSuffix ? `-${channelSuffix}` : ""}-${filter ?? "all"}`;
    const channel = supabase.channel(channelName);

    channel.on(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      "postgres_changes" as any,
      { event, schema: "public", table, filter },
      (payload: { eventType: string; new: AnyRow; old: AnyRow }) => {
        handlerRef.current(payload);
      },
    );
    channel.subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [table, filter, event, channelSuffix, enabled]);
}
