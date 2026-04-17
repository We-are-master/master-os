"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Button } from "@/components/ui/button";
import { SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { listAccountProperties } from "@/services/account-properties";
import { listAccounts } from "@/services/accounts";
import type { AccountProperty } from "@/types/database";
import type { Account } from "@/types/database";
import type { ListParams } from "@/services/base";
import { Plus, MapPin, Building2, ChevronRight } from "lucide-react";
import { formatDate } from "@/lib/utils";

export default function AssetsPage() {
  const [rows, setRows] = useState<AccountProperty[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [accounts, setAccounts] = useState<Account[]>([]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params: ListParams & { accountId?: string } = {
        page: 1,
        pageSize: 100,
        search: debouncedSearch.trim() || undefined,
        accountId: accountId.trim() || undefined,
      };
      const res = await listAccountProperties(params);
      setRows(res.data);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, accountId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await listAccounts({ page: 1, pageSize: 500 });
        if (!cancelled) setAccounts(r.data);
      } catch {
        if (!cancelled) setAccounts([]);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="Assets"
          subtitle="Physical sites and properties linked to client accounts — not the account billing address."
        >
          <Link
            href="/assets/new"
            className="inline-flex items-center justify-center rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <Plus className="w-4 h-4 mr-2" />
            Add property
          </Link>
        </PageHeader>

        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            placeholder="Search name, address, type…"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="max-w-md"
          />
          <Select
            label=""
            className="sm:w-72"
            options={[
              { value: "", label: "All accounts" },
              ...accounts.map((a) => ({ value: a.id, label: a.company_name })),
            ]}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
          <Button variant="outline" onClick={() => void load()}>
            Refresh
          </Button>
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-sm text-text-tertiary">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <MapPin className="w-10 h-10 mx-auto text-text-tertiary mb-3" />
              <p className="text-text-secondary text-sm">No properties yet. Add one to link requests and jobs to a site.</p>
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {rows.map((p) => (
                <Link
                  key={p.id}
                  href={`/assets/${p.id}`}
                  className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-secondary/80 transition-colors group"
                >
                  <div className="min-w-0 flex items-start gap-3">
                    <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                      <MapPin className="w-5 h-5 text-primary" />
                    </div>
                    <div className="min-w-0">
                      <p className="font-bold text-text-primary truncate">{p.name}</p>
                      <p className="text-xs text-text-tertiary line-clamp-2">{p.full_address}</p>
                      <div className="flex flex-wrap gap-2 mt-2">
                        <Badge variant="default" size="sm">
                          {p.property_type}
                        </Badge>
                        <span className="text-xs text-text-tertiary flex items-center gap-1">
                          <Building2 className="w-3 h-3" />
                          Account-linked
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="text-right shrink-0 flex items-center gap-2">
                    <span className="text-xs text-text-tertiary hidden sm:block">
                      {formatDate(p.created_at)}
                    </span>
                    <ChevronRight className="w-5 h-5 text-text-tertiary group-hover:text-primary transition-colors" />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </PageTransition>
  );
}
