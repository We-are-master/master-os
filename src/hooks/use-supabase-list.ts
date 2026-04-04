"use client";

import { useState, useEffect, useCallback, useRef, useLayoutEffect } from "react";
import type { ListResult, ListParams } from "@/services/base";
import { createClient } from "@/lib/supabase/client";

interface UseSupabaseListOptions<T> {
  fetcher: (params: ListParams) => Promise<ListResult<T>>;
  pageSize?: number;
  /** Initial status filter (e.g. `pipeline` when fetcher maps to statusIn). */
  initialStatus?: string;
  /** Subscribe to Postgres changes and soft-refresh the list (enable Realtime on this table in Supabase). */
  realtimeTable?: string;
  /** Merged into every fetch (use a stable reference when values are unchanged, e.g. module-level `{}`). */
  listParams?: Partial<ListParams>;
}

interface UseSupabaseListReturn<T> {
  data: T[];
  loading: boolean;
  error: string | null;
  page: number;
  totalPages: number;
  totalItems: number;
  setPage: (p: number) => void;
  search: string;
  setSearch: (s: string) => void;
  status: string;
  setStatus: (s: string) => void;
  /** Full reload with loading skeleton */
  refresh: () => void;
  /** Re-fetch in the background without clearing the table */
  refreshSilent: () => void;
}

export function useSupabaseList<T>(options: UseSupabaseListOptions<T>): UseSupabaseListReturn<T> {
  const { fetcher, pageSize = 10, realtimeTable, initialStatus = "all", listParams } = options;
  const fetcherRef = useRef(fetcher);
  const listParamsRef = useRef(listParams);
  useLayoutEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);
  useLayoutEffect(() => {
    listParamsRef.current = listParams;
  }, [listParams]);

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearchRaw] = useState("");
  const [status, setStatusRaw] = useState(initialStatus);
  const [tick, setTick] = useState(0);
  const skipLoadingRef = useRef(false);

  const scheduleRangeKey = listParams?.scheduleRange
    ? `${listParams.scheduleRange.from}|${listParams.scheduleRange.to}`
    : "";
  const dateRangeKey = listParams?.invoicePeriodBounds
    ? `inv|${listParams.invoicePeriodBounds.from}|${listParams.invoicePeriodBounds.to}|${listParams.invoicePeriodBounds.startIso}|${listParams.invoicePeriodBounds.endIso}`
    : listParams?.dateColumn
      ? `${listParams.dateColumn}|${listParams.dateFromUtcIso ?? listParams.dateFrom ?? ""}|${listParams.dateToUtcIso ?? listParams.dateTo ?? ""}`
      : "";
  const prevRangeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevRangeKeyRef.current === null) {
      prevRangeKeyRef.current = scheduleRangeKey;
      return;
    }
    if (prevRangeKeyRef.current === scheduleRangeKey) return;
    prevRangeKeyRef.current = scheduleRangeKey;
    queueMicrotask(() => setPage(1));
  }, [scheduleRangeKey]);
  const prevDateRangeKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevDateRangeKeyRef.current === null) {
      prevDateRangeKeyRef.current = dateRangeKey;
      return;
    }
    if (prevDateRangeKeyRef.current === dateRangeKey) return;
    prevDateRangeKeyRef.current = dateRangeKey;
    queueMicrotask(() => setPage(1));
  }, [dateRangeKey]);

  const setSearch = useCallback((s: string) => {
    setSearchRaw(s);
    setPage(1);
  }, []);

  const setStatus = useCallback((s: string) => {
    setStatusRaw(s);
    setPage(1);
  }, []);

  const refresh = useCallback(() => {
    skipLoadingRef.current = false;
    setTick((t) => t + 1);
  }, []);

  const refreshSilent = useCallback(() => {
    skipLoadingRef.current = true;
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    const silent = skipLoadingRef.current;
    skipLoadingRef.current = false;

    if (!silent) {
      queueMicrotask(() => {
        setLoading(true);
        setError(null);
      });
    }

    fetcherRef
      .current({
        page,
        pageSize,
        search: search || undefined,
        status: status !== "all" ? status : undefined,
        ...(listParamsRef.current ?? {}),
      })
      .then((result) => {
        if (cancelled) return;
        setData(result.data);
        setTotalPages(result.totalPages);
        setTotalItems(result.count);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        const message = err instanceof Error ? err.message : "Failed to load data";
        setError(message);
        if (!silent) setData([]);
      })
      .finally(() => {
        if (!cancelled && !silent) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, search, status, tick, scheduleRangeKey, dateRangeKey]);

  const refreshSilentRef = useRef(refreshSilent);
  useLayoutEffect(() => {
    refreshSilentRef.current = refreshSilent;
  }, [refreshSilent]);

  useEffect(() => {
    if (!realtimeTable?.trim()) return;
    let supabase: ReturnType<typeof createClient>;
    try {
      supabase = createClient();
    } catch {
      return;
    }
    let debounce: ReturnType<typeof setTimeout> | undefined;
    const channel = supabase
      .channel(`list:${realtimeTable}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: realtimeTable },
        () => {
          if (debounce) clearTimeout(debounce);
          debounce = setTimeout(() => refreshSilentRef.current(), 350);
        }
      )
      .subscribe();

    return () => {
      if (debounce) clearTimeout(debounce);
      supabase.removeChannel(channel);
    };
  }, [realtimeTable]);

  return {
    data,
    loading,
    error,
    page,
    totalPages,
    totalItems,
    setPage,
    search,
    setSearch,
    status,
    setStatus,
    refresh,
    refreshSilent,
  };
}
