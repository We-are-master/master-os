"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { Plus, CalendarClock, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { Input, SearchInput } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { listAccounts } from "@/services/accounts";
import { listAccountProperties } from "@/services/account-properties";
import {
  createAccountPpmPlan,
  deleteAccountPpmPlan,
  listAccountPpmPlans,
} from "@/services/account-ppm-plans";
import type {
  Account,
  AccountPpmPlan,
  AccountProperty,
  PpmFrequency,
  PpmStatus,
} from "@/types/database";

const FREQ_OPTIONS: { value: PpmFrequency; label: string }[] = [
  { value: "weekly",      label: "Weekly" },
  { value: "fortnightly", label: "Fortnightly" },
  { value: "monthly",     label: "Monthly" },
  { value: "quarterly",   label: "Quarterly" },
  { value: "semi_annual", label: "Semi-annual" },
  { value: "yearly",      label: "Yearly" },
  { value: "custom",      label: "Custom (set days)" },
];

const STATUS_BADGE: Record<PpmStatus, { label: string; variant: "success" | "warning" | "default" }> = {
  active:    { label: "Active",    variant: "success" },
  paused:    { label: "Paused",    variant: "warning" },
  cancelled: { label: "Cancelled", variant: "default" },
};

function formatDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

export default function PpmPage() {
  const [rows, setRows] = useState<AccountPpmPlan[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [accountId, setAccountId] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | PpmStatus>("");

  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(searchInput), 400);
    return () => clearTimeout(t);
  }, [searchInput]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await listAccountPpmPlans({
        page: 1,
        pageSize: 200,
        search: debouncedSearch.trim() || undefined,
        accountId: accountId.trim() || undefined,
        status: statusFilter || undefined,
      });
      setRows(res.data);
    } catch (e) {
      console.error(e);
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [debouncedSearch, accountId, statusFilter]);

  useEffect(() => { void load(); }, [load]);

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
    return () => { cancelled = true; };
  }, []);

  const accountMap = useMemo(() => {
    const m = new Map<string, string>();
    for (const a of accounts) m.set(a.id, a.company_name);
    return m;
  }, [accounts]);

  async function handleDelete(id: string) {
    if (!window.confirm("Delete this PPM plan?")) return;
    try {
      await deleteAccountPpmPlan(id);
      toast.success("PPM plan removed.");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not delete.");
    }
  }

  return (
    <PageTransition>
      <div className="space-y-6">
        <PageHeader
          title="PPM Plans"
          subtitle="Planned preventive maintenance schedules per account/property. Drives the portal's Live View calendar and the PPM tab in PropertyDrawer."
        >
          <Button
            onClick={() => setDrawerOpen(true)}
            className="inline-flex items-center justify-center rounded-xl bg-primary text-white px-4 py-2.5 text-sm font-semibold hover:opacity-90"
          >
            <Plus className="w-4 h-4 mr-2" />
            Create plan
          </Button>
        </PageHeader>

        <div className="flex flex-col sm:flex-row gap-3">
          <SearchInput
            placeholder="Search by name…"
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
          <Select
            label=""
            className="sm:w-40"
            options={[
              { value: "", label: "Any status" },
              { value: "active", label: "Active" },
              { value: "paused", label: "Paused" },
              { value: "cancelled", label: "Cancelled" },
            ]}
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | PpmStatus)}
          />
        </div>

        <div className="bg-card rounded-2xl border border-border overflow-hidden">
          {loading ? (
            <div className="p-12 text-center text-sm text-text-tertiary">Loading…</div>
          ) : rows.length === 0 ? (
            <div className="p-12 text-center">
              <CalendarClock className="w-10 h-10 mx-auto text-text-tertiary mb-3" />
              <p className="text-text-secondary text-sm">No PPM plans yet.</p>
            </div>
          ) : (
            <div className="divide-y divide-border-light">
              {rows.map((p) => {
                const badge = STATUS_BADGE[p.status];
                const accountName = accountMap.get(p.account_id) ?? "—";
                return (
                  <div
                    key={p.id}
                    className="flex items-center justify-between gap-4 px-5 py-4 hover:bg-surface-secondary/80"
                  >
                    <div className="min-w-0 flex items-start gap-3 flex-1">
                      <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
                        <CalendarClock className="w-5 h-5 text-primary" />
                      </div>
                      <div className="min-w-0">
                        <p className="font-bold text-text-primary truncate">{p.name}</p>
                        <p className="text-xs text-text-tertiary line-clamp-1">{accountName}</p>
                        <div className="flex flex-wrap gap-2 mt-2 items-center">
                          <Badge variant={badge.variant} size="sm">{badge.label}</Badge>
                          <span className="text-xs text-text-tertiary capitalize">
                            {p.frequency.replace(/_/g, " ")}
                          </span>
                          {p.next_visit_date && (
                            <span className="text-xs text-text-tertiary">Next visit {formatDate(p.next_visit_date)}</span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => void handleDelete(p.id)}
                      className="text-red-600 hover:text-red-700"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <NewPlanDrawer
          open={drawerOpen}
          accounts={accounts}
          onClose={() => setDrawerOpen(false)}
          onCreated={() => { setDrawerOpen(false); void load(); }}
        />
      </div>
    </PageTransition>
  );
}

function NewPlanDrawer({
  open,
  accounts,
  onClose,
  onCreated,
}: {
  open: boolean;
  accounts: Account[];
  onClose: () => void;
  onCreated: () => void;
}) {
  const [accountId, setAccountId] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [properties, setProperties] = useState<AccountProperty[]>([]);
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<PpmFrequency>("monthly");
  const [customDays, setCustomDays] = useState("");
  const [nextVisit, setNextVisit] = useState("");
  const [notes, setNotes] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    if (open) {
      setAccountId("");
      setPropertyId("");
      setProperties([]);
      setName("");
      setFrequency("monthly");
      setCustomDays("");
      setNextVisit("");
      setNotes("");
    }
  }, [open]);

  useEffect(() => {
    if (!accountId) { setProperties([]); setPropertyId(""); return; }
    let cancelled = false;
    (async () => {
      try {
        const r = await listAccountProperties({ page: 1, pageSize: 200, accountId });
        if (!cancelled) setProperties(r.data);
      } catch {
        if (!cancelled) setProperties([]);
      }
    })();
    return () => { cancelled = true; };
  }, [accountId]);

  const canSubmit =
    accountId.trim().length > 0 &&
    name.trim().length > 0 &&
    !pending &&
    (frequency !== "custom" || (Number(customDays) > 0));

  async function submit() {
    if (!canSubmit) return;
    setPending(true);
    try {
      await createAccountPpmPlan({
        account_id:      accountId,
        property_id:     propertyId || null,
        name:            name.trim(),
        frequency,
        frequency_days:  frequency === "custom" ? Number(customDays) : null,
        next_visit_date: nextVisit || null,
        notes:           notes || null,
      });
      toast.success("PPM plan created.");
      onCreated();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save.");
    } finally {
      setPending(false);
    }
  }

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Create PPM plan"
      subtitle="The plan shows up in the portal Live View calendar on the next visit date."
      width="w-[520px]"
      footer={
        <div className="flex justify-end gap-2 px-5 py-3 border-t border-border-light bg-card">
          <Button variant="outline" onClick={onClose} disabled={pending}>Cancel</Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {pending ? "Saving…" : "Create"}
          </Button>
        </div>
      }
    >
      <div className="p-5 space-y-4">
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Account *</label>
          <Select
            label=""
            options={[
              { value: "", label: "— pick an account —" },
              ...accounts.map((a) => ({ value: a.id, label: a.company_name })),
            ]}
            value={accountId}
            onChange={(e) => setAccountId(e.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Property</label>
          <Select
            label=""
            options={[
              { value: "", label: properties.length > 0 ? "Account-wide" : "Pick an account first" },
              ...properties.map((p) => ({ value: p.id, label: p.name })),
            ]}
            value={propertyId}
            onChange={(e) => setPropertyId(e.target.value)}
            disabled={!accountId}
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Plan name *</label>
          <Input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. Annual Boiler Service"
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-secondary">Frequency *</label>
            <Select
              label=""
              options={FREQ_OPTIONS}
              value={frequency}
              onChange={(e) => setFrequency(e.target.value as PpmFrequency)}
            />
          </div>
          {frequency === "custom" ? (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary">Days *</label>
              <Input
                type="number"
                min={1}
                value={customDays}
                onChange={(e) => setCustomDays(e.target.value)}
              />
            </div>
          ) : (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-text-secondary">Next visit</label>
              <Input
                type="date"
                value={nextVisit}
                onChange={(e) => setNextVisit(e.target.value)}
              />
            </div>
          )}
        </div>
        {frequency === "custom" && (
          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-text-secondary">Next visit</label>
            <Input
              type="date"
              value={nextVisit}
              onChange={(e) => setNextVisit(e.target.value)}
            />
          </div>
        )}
        <div className="space-y-1.5">
          <label className="text-xs font-semibold text-text-secondary">Notes</label>
          <textarea
            rows={2}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Scope, who's responsible, etc."
            className="w-full rounded-lg border border-border bg-card p-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30"
          />
        </div>
      </div>
    </Drawer>
  );
}
