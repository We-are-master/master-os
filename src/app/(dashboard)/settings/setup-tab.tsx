"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ChevronDown, ChevronUp, Loader2, SlidersHorizontal, PauseCircle, Plus, Trash2, XCircle } from "lucide-react";
import { toast } from "sonner";
import { getSupabase } from "@/services/base";
import { useAdminConfig } from "@/hooks/use-admin-config";
import {
  DEFAULT_JOB_ON_HOLD_PRESETS,
  MAX_JOB_ON_HOLD_PRESETS,
  MAX_JOB_ON_HOLD_PRESET_LEN,
  MAX_OFFICE_CANCEL_PRESET_LABEL_LEN,
  MAX_BIDDING_SLA_HOURS,
  MIN_BIDDING_SLA_HOURS,
  mergeFrontendSetup,
  normalizeOfficeJobCancellationPresets,
  parseFrontendSetup,
  type OfficeJobCancellationPresetRow,
} from "@/lib/frontend-setup";

function moveArrayItem<T>(arr: T[], index: number, delta: -1 | 1): T[] {
  const j = index + delta;
  if (j < 0 || j >= arr.length) return arr;
  const next = [...arr];
  const tmp = next[index]!;
  next[index] = next[j]!;
  next[j] = tmp;
  return next;
}

export function SetupTab() {
  const { canEditConfig } = useAdminConfig();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [settingsId, setSettingsId] = useState<string | null>(null);
  const [rawSetup, setRawSetup] = useState<unknown>(null);
  const [biddingSlaHoursStr, setBiddingSlaHoursStr] = useState("8");
  const [onHoldPresets, setOnHoldPresets] = useState<string[]>(() => [...DEFAULT_JOB_ON_HOLD_PRESETS]);

  const [officeCancelPresets, setOfficeCancelPresets] = useState<OfficeJobCancellationPresetRow[]>(() =>
    normalizeOfficeJobCancellationPresets(null),
  );

  useEffect(() => {
    let alive = true;
    void (async () => {
      const supabase = getSupabase();
      const { data } = await supabase.from("company_settings").select("id, frontend_setup").limit(1).maybeSingle();
      if (!alive) return;
      if (data?.id) setSettingsId(data.id);
      const parsed = parseFrontendSetup(data?.frontend_setup);
      setRawSetup(data?.frontend_setup ?? null);
      setBiddingSlaHoursStr(String(parsed.bidding_sla_hours ?? 8));
      setOnHoldPresets([...(parsed.job_on_hold_presets ?? DEFAULT_JOB_ON_HOLD_PRESETS)]);
      setOfficeCancelPresets([...(parsed.office_job_cancellation_presets ?? normalizeOfficeJobCancellationPresets(null))]);
      setLoading(false);
    })();
    return () => {
      alive = false;
    };
  }, []);

  const handleSave = async () => {
    if (!canEditConfig) return;
    const hours = Number(biddingSlaHoursStr);
    if (!Number.isFinite(hours) || hours < MIN_BIDDING_SLA_HOURS || hours > MAX_BIDDING_SLA_HOURS) {
      toast.error(`SLA hours must be between ${MIN_BIDDING_SLA_HOURS} and ${MAX_BIDDING_SLA_HOURS}.`);
      return;
    }
    if (!settingsId) {
      toast.error("Company settings row missing — save System settings first or run migrations.");
      return;
    }
    setSaving(true);
    try {
      const supabase = getSupabase();
      const next = mergeFrontendSetup(rawSetup, {
        bidding_sla_hours: hours,
        job_on_hold_presets: onHoldPresets,
        office_job_cancellation_presets: officeCancelPresets,
      });
      const { error } = await supabase.from("company_settings").update({ frontend_setup: next }).eq("id", settingsId);
      if (error) throw error;
      setRawSetup(next);
      setOnHoldPresets([...(next.job_on_hold_presets ?? DEFAULT_JOB_ON_HOLD_PRESETS)]);
      setOfficeCancelPresets([...(next.office_job_cancellation_presets ?? normalizeOfficeJobCancellationPresets(null))]);
      toast.success("Setup saved");
      window.dispatchEvent(new Event("master-os-company-settings"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Failed to save");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 className="h-6 w-6 animate-spin text-text-tertiary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">Setup</h3>
        <p className="text-sm text-text-tertiary">
          Front-office behaviour and labels. More options will land here; each new control will be wired in code once.
        </p>
      </div>

      <Card padding="none">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Quotes · Bidding SLA</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-text-secondary">
            Target time for the Bidding stage: the list shows a minute-by-minute countdown to this limit, then overdue time.
            Does not change database triggers — only what operators see.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">SLA (hours)</label>
              <Input
                type="number"
                min={MIN_BIDDING_SLA_HOURS}
                max={MAX_BIDDING_SLA_HOURS}
                step={0.5}
                value={biddingSlaHoursStr}
                onChange={(e) => setBiddingSlaHoursStr(e.target.value)}
                className="w-28"
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditConfig || saving}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {saving ? "Saving…" : "Save setup"}
            </Button>
          </div>
          <p className="text-[10px] text-text-tertiary">
            Allowed range: {MIN_BIDDING_SLA_HOURS}h–{MAX_BIDDING_SLA_HOURS}h (30 days).
          </p>
        </div>
      </Card>

      <Card padding="none">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <PauseCircle className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Jobs · On hold reasons</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-text-secondary">
            Options shown in the &quot;Reason preset&quot; list when you put a job on hold. You can add or remove as many as you need (up to {MAX_JOB_ON_HOLD_PRESETS}).
            Use the arrows to change display order — add an &quot;Other&quot; line if staff should pick a typed reason.
          </p>
          <div className="space-y-2 max-w-xl">
            {onHoldPresets.map((row, idx) => (
              <div key={`on-hold-${idx}`} className="flex items-center gap-2">
                <Input
                  value={row}
                  maxLength={MAX_JOB_ON_HOLD_PRESET_LEN}
                  placeholder="Reason label"
                  onChange={(e) => {
                    const v = e.target.value;
                    setOnHoldPresets((prev) => prev.map((p, i) => (i === idx ? v : p)));
                  }}
                  className="flex-1"
                />
                <div className="flex shrink-0 flex-col border border-border rounded-md overflow-hidden divide-y divide-border bg-card">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-8 rounded-none px-0"
                    disabled={!canEditConfig || idx === 0}
                    onClick={() => setOnHoldPresets((prev) => moveArrayItem(prev, idx, -1))}
                    aria-label="Move reason up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-8 rounded-none px-0"
                    disabled={!canEditConfig || idx >= onHoldPresets.length - 1}
                    onClick={() => setOnHoldPresets((prev) => moveArrayItem(prev, idx, 1))}
                    aria-label="Move reason down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="shrink-0 text-text-tertiary hover:text-red-600"
                  disabled={!canEditConfig}
                  onClick={() => setOnHoldPresets((prev) => prev.filter((_, i) => i !== idx))}
                  aria-label="Remove preset"
                >
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEditConfig || onHoldPresets.length >= MAX_JOB_ON_HOLD_PRESETS}
              onClick={() =>
                setOnHoldPresets((prev) =>
                  prev.length >= MAX_JOB_ON_HOLD_PRESETS ? prev : [...prev, ""],
                )
              }
            >
              <Plus className="h-4 w-4 mr-1.5 inline" />
              Add reason
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditConfig || saving}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {saving ? "Saving…" : "Save setup"}
            </Button>
          </div>
          <p className="text-[10px] text-text-tertiary">
            Blank rows are dropped when you save. If every row is blank, the list falls back to the built-in defaults.
          </p>
        </div>
      </Card>

      <Card padding="none">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Jobs · Office cancellation reasons</CardTitle>
          </div>
        </CardHeader>
        <div className="space-y-4 px-6 pb-6">
          <p className="text-sm text-text-secondary">
            Reasons in the dropdown when cancelling a job from the dashboard or bulk-cancel. The internal id stays fixed (integrations and the &quot;Other&quot;
            behaviour use it) — reorder and rename the labels here to match your team&apos;s wording.
          </p>
          <div className="space-y-2 max-w-xl">
            {officeCancelPresets.map((row, idx) => (
              <div key={row.id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <label className="block text-[10px] font-medium text-text-tertiary truncate" title={row.id}>
                    id: <code className="text-[11px]">{row.id}</code>
                  </label>
                  <Input
                    value={row.label}
                    maxLength={MAX_OFFICE_CANCEL_PRESET_LABEL_LEN}
                    placeholder="Label shown to staff"
                    onChange={(e) => {
                      const v = e.target.value;
                      setOfficeCancelPresets((prev) => prev.map((p, i) => (i === idx ? { ...p, label: v } : p)));
                    }}
                    className="w-full"
                  />
                </div>
                <div className="flex shrink-0 flex-col border border-border rounded-md overflow-hidden divide-y divide-border bg-card mt-5">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-8 rounded-none px-0"
                    disabled={!canEditConfig || idx === 0}
                    onClick={() => setOfficeCancelPresets((prev) => moveArrayItem(prev, idx, -1))}
                    aria-label="Move cancellation reason up"
                  >
                    <ChevronUp className="h-4 w-4" />
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="h-7 w-8 rounded-none px-0"
                    disabled={!canEditConfig || idx >= officeCancelPresets.length - 1}
                    onClick={() => setOfficeCancelPresets((prev) => moveArrayItem(prev, idx, 1))}
                    aria-label="Move cancellation reason down"
                  >
                    <ChevronDown className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
          <Button
            type="button"
            onClick={() => void handleSave()}
            disabled={!canEditConfig || saving}
            icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
          >
            {saving ? "Saving…" : "Save setup"}
          </Button>
          <p className="text-[10px] text-text-tertiary">
            Saved with the rest of Setup. An empty label on save restores the English default for that id.
          </p>
        </div>
      </Card>
    </div>
  );
}
