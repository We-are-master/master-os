"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { ListResult, ListParams } from "@/services/base";

interface UseSupabaseListOptions<T> {
  fetcher: (params: ListParams) => Promise<ListResult<T>>;
  pageSize?: number;
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
  refresh: () => void;
}

export function useSupabaseList<T>(options: UseSupabaseListOptions<T>): UseSupabaseListReturn<T> {
  const { fetcher, pageSize = 10 } = options;
  const fetcherRef = useRef(fetcher);
  fetcherRef.current = fetcher;

  const [data, setData] = useState<T[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [search, setSearchRaw] = useState("");
  const [status, setStatusRaw] = useState("all");
  const [tick, setTick] = useState(0);

  const setSearch = useCallback((s: string) => {
    setSearchRaw(s);
    setPage(1);
  }, []);

  const setStatus = useCallback((s: string) => {
    setStatusRaw(s);
    setPage(1);
  }, []);

  const refresh = useCallback(() => {
    setTick((t) => t + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    fetcherRef
      .current({
        page,
        pageSize,
        search: search || undefined,
        status: status !== "all" ? status : undefined,
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
        setData([]);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [page, pageSize, search, status, tick]);

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
  };
}
