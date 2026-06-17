"use client";

import { useMemo, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { computeAccountRelationshipInsights } from "@/lib/account-insights";
import { formatCurrency, cn } from "@/lib/utils";
import {
  deleteAccountLegacyYearlyStat,
  listAccountLegacyYearlyStats,
  upsertAccountLegacyYearlyStat,
} from "@/services/account-legacy-stats";
import type { Account, AccountLegacyYearlyStat, Job } from "@/types/database";
import { Loader2, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface AccountHistorySectionProps {
  account: Account;
  jobs: Job[];
  legacyRows: AccountLegacyYearlyStat[];
  loading?: boolean;
  isAdmin: boolean;
  onLegacyRowsChange: (rows: AccountLegacyYearlyStat[]) => void;
}

const MIN_YEAR = 2000;
const MAX_YEAR = 2100;

function sourceLabel(source: "previous_system" | "master_os"): string {
  return source === "previous_system" ? "Previous system" : "Master OS";
}

export function AccountHistorySection({
  account,
  jobs,
  legacyRows,
  loading = false,
  isAdmin,
  onLegacyRowsChange,
}: AccountHistorySectionProps) {
  const insights = useMemo(
    () =>
      computeAccountRelationshipInsights({
        legacyRows,
        jobs,
        accountCreatedAt: account.created_at,
      }),
    [legacyRows, jobs, account.created_at],
  );

  const [draftYear, setDraftYear] = useState("");
  const [draftJobs, setDraftJobs] = useState("");
  const [draftRevenue, setDraftRevenue] = useState("");
  const [draftNotes, setDraftNotes] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const resetDraft = () => {
    setDraftYear("");
    setDraftJobs("");
    setDraftRevenue("");
    setDraftNotes("");
    setEditingId(null);
  };

  const startEdit = (row: AccountLegacyYearlyStat) => {
    setEditingId(row.id);
    setDraftYear(String(row.year));
    setDraftJobs(String(row.completed_jobs_count));
    setDraftRevenue(String(row.revenue_gbp));
    setDraftNotes(row.notes ?? "");
  };

  const validateDraft = (): { year: number; jobs: number; revenue: number } | null => {
    const year = Math.trunc(Number(draftYear));
    const jobsCount = Math.trunc(Number(draftJobs));
    const revenue = Number(draftRevenue);
    if (!Number.isFinite(year) || year < MIN_YEAR || year > MAX_YEAR) {
      toast.error(`Year must be between ${MIN_YEAR} and ${MAX_YEAR}.`);
      return null;
    }
    if (!Number.isFinite(jobsCount) || jobsCount < 0) {
      toast.error("Completed jobs must be zero or greater.");
      return null;
    }
    if (!Number.isFinite(revenue) || revenue < 0) {
      toast.error("Revenue must be zero or greater.");
      return null;
    }
    const duplicate = legacyRows.some((r) => r.year === year && r.id !== editingId);
    if (duplicate) {
      toast.error(`A legacy row for ${year} already exists. Edit that row instead.`);
      return null;
    }
    return { year, jobs: jobsCount, revenue };
  };

  const refreshLegacyRows = async () => {
    const rows = await listAccountLegacyYearlyStats(account.id);
    onLegacyRowsChange(rows);
    return rows;
  };

  const handleSave = async () => {
    const parsed = validateDraft();
    if (!parsed) return;
    setSaving(true);
    try {
      await upsertAccountLegacyYearlyStat({
        account_id: account.id,
        year: parsed.year,
        completed_jobs_count: parsed.jobs,
        revenue_gbp: parsed.revenue,
        notes: draftNotes.trim() || null,
      });
      await refreshLegacyRows();
      resetDraft();
      toast.success(editingId ? "Legacy year updated" : "Legacy year added");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save legacy stats");
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    setDeletingId(id);
    try {
      await deleteAccountLegacyYearlyStat(id);
      await refreshLegacyRows();
      if (editingId === id) resetDraft();
      toast.success("Legacy year removed");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to delete legacy stats");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-border-light bg-white p-5 space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p className="text-xs font-bold text-[#020040] uppercase tracking-wider">Year breakdown</p>
            <p className="text-[11px] text-text-tertiary mt-1">
              Completed jobs and revenue by calendar year — legacy imports plus Master OS.
            </p>
          </div>
          {loading ? <Loader2 className="h-3.5 w-3.5 animate-spin text-text-tertiary shrink-0" /> : null}
        </div>

        {insights.yearRows.length === 0 ? (
          <p className="text-sm text-text-tertiary py-2">No completed jobs or legacy history yet.</p>
        ) : (
          <div className="overflow-x-auto -mx-1">
            <table className="w-full min-w-[320px] text-sm">
              <thead>
                <tr className="text-left text-[10px] font-bold uppercase tracking-wider text-text-tertiary border-b border-border-light">
                  <th className="pb-2 pr-3">Year</th>
                  <th className="pb-2 pr-3">Source</th>
                  <th className="pb-2 pr-3 text-right">Jobs</th>
                  <th className="pb-2 text-right">Revenue</th>
                </tr>
              </thead>
              <tbody>
                {insights.yearRows.map((row) => (
                  <tr
                    key={`${row.year}-${row.source}-${row.legacyStatId ?? "os"}`}
                    className="border-b border-border-light/60 last:border-0"
                  >
                    <td className="py-2.5 pr-3 tabular-nums font-medium text-text-primary">
                      {row.year}
                    </td>
                    <td className="py-2.5 pr-3">
                      <Badge
                        variant={row.source === "previous_system" ? "violet" : "info"}
                        size="sm"
                      >
                        {sourceLabel(row.source)}
                      </Badge>
                    </td>
                    <td className="py-2.5 pr-3 text-right tabular-nums text-text-secondary">
                      {row.jobs}
                    </td>
                    <td className="py-2.5 text-right tabular-nums text-text-primary">
                      {formatCurrency(row.revenue)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {isAdmin ? (
        <div className="rounded-2xl border border-border-light bg-white p-5 space-y-4">
          <div>
            <p className="text-xs font-bold text-[#020040] uppercase tracking-wider">
              Previous system history
            </p>
            <p className="text-[11px] text-text-tertiary mt-1">
              Add yearly completed jobs and revenue from before Master OS. Saves immediately.
            </p>
          </div>

          {legacyRows.length > 0 && (
            <div className="space-y-2">
              {legacyRows.map((row) => (
                <div
                  key={row.id}
                  className={cn(
                    "flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2 text-sm",
                    editingId === row.id
                      ? "border-[#ED4B00]/40 bg-[#ED4B00]/5"
                      : "border-border-light",
                  )}
                >
                  <span className="font-semibold tabular-nums w-12">{row.year}</span>
                  <span className="text-text-secondary tabular-nums">
                    {row.completed_jobs_count} jobs
                  </span>
                  <span className="text-text-primary tabular-nums font-medium">
                    {formatCurrency(Number(row.revenue_gbp))}
                  </span>
                  {row.notes?.trim() ? (
                    <span className="text-text-tertiary text-xs truncate max-w-[140px]" title={row.notes}>
                      {row.notes}
                    </span>
                  ) : null}
                  <div className="ml-auto flex items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2"
                      disabled={saving || deletingId === row.id}
                      onClick={() => startEdit(row)}
                    >
                      Edit
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="h-8 px-2 text-red-600 hover:text-red-700"
                      disabled={saving || deletingId === row.id}
                      onClick={() => void handleDelete(row.id)}
                      icon={
                        deletingId === row.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <Trash2 className="h-3.5 w-3.5" />
                        )
                      }
                    />
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">
                Year
              </label>
              <Input
                type="number"
                min={MIN_YEAR}
                max={MAX_YEAR}
                placeholder="2024"
                value={draftYear}
                disabled={saving}
                onChange={(e) => setDraftYear(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">
                Completed jobs
              </label>
              <Input
                type="number"
                min={0}
                placeholder="120"
                value={draftJobs}
                disabled={saving}
                onChange={(e) => setDraftJobs(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">
                Revenue (£)
              </label>
              <Input
                type="number"
                min={0}
                step="0.01"
                placeholder="48000"
                value={draftRevenue}
                disabled={saving}
                onChange={(e) => setDraftRevenue(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-[10px] font-bold uppercase tracking-wider text-text-tertiary mb-1">
                Notes
              </label>
              <Input
                placeholder="Optional"
                value={draftNotes}
                disabled={saving}
                onChange={(e) => setDraftNotes(e.target.value)}
              />
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button
              type="button"
              size="sm"
              disabled={saving}
              onClick={() => void handleSave()}
              icon={
                saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : editingId ? (
                  <Save className="h-3.5 w-3.5" />
                ) : (
                  <Plus className="h-3.5 w-3.5" />
                )
              }
            >
              {saving ? "Saving…" : editingId ? "Update year" : "Add year"}
            </Button>
            {editingId && (
              <Button type="button" variant="outline" size="sm" disabled={saving} onClick={resetDraft}>
                Cancel edit
              </Button>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-text-tertiary px-1">
          Only admins can edit pre–Master OS history.
        </p>
      )}
    </div>
  );
}
