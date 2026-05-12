"use client";

import { useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlarmClock, CalendarClock, ChevronDown, ChevronUp, Loader2, SlidersHorizontal, PauseCircle, Plus, Trash2, XCircle } from "lucide-react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { MicroLabel } from "@/components/fx/primitives";
import { toast } from "sonner";
import { getSupabase } from "@/services/base";
import { useAdminConfig } from "@/hooks/use-admin-config";
import {
  DEFAULT_JOB_ON_HOLD_PRESETS,
  DEFAULT_PULSE_LOW_MARGIN_PCT,
  DEFAULT_SLA_ARRIVAL_GRACE_HOURS,
  DEFAULT_SLA_FINAL_CHECKS_HOURS,
  DEFAULT_SLA_QUOTE_SEND_HOURS,
  DEFAULT_TARGET_MARGIN_PCT,
  DEFAULT_WORKING_DAYS,
  DEFAULT_WORKING_HOURS,
  MAX_JOB_ON_HOLD_PRESETS,
  MAX_JOB_ON_HOLD_PRESET_LEN,
  MAX_OFFICE_CANCEL_PRESET_LABEL_LEN,
  MAX_BIDDING_SLA_HOURS,
  MAX_SLA_HOURS,
  MIN_BIDDING_SLA_HOURS,
  MIN_SLA_HOURS,
  mergeFrontendSetup,
  normalizeOfficeJobCancellationPresets,
  parseFrontendSetup,
  type OfficeJobCancellationPresetRow,
} from "@/lib/frontend-setup";

const WEEKDAY_LABELS: { id: number; short: string; full: string }[] = [
  { id: 1, short: "Mon", full: "Monday" },
  { id: 2, short: "Tue", full: "Tuesday" },
  { id: 3, short: "Wed", full: "Wednesday" },
  { id: 4, short: "Thu", full: "Thursday" },
  { id: 5, short: "Fri", full: "Friday" },
  { id: 6, short: "Sat", full: "Saturday" },
  { id: 0, short: "Sun", full: "Sunday" },
];

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

  const [workingDays, setWorkingDays] = useState<Set<number>>(() => new Set(DEFAULT_WORKING_DAYS));
  const [workStartStr, setWorkStartStr] = useState<string>(DEFAULT_WORKING_HOURS.start);
  const [workEndStr, setWorkEndStr] = useState<string>(DEFAULT_WORKING_HOURS.end);

  const [slaArrivalStr, setSlaArrivalStr] = useState(String(DEFAULT_SLA_ARRIVAL_GRACE_HOURS));
  const [slaQuoteSendStr, setSlaQuoteSendStr] = useState(String(DEFAULT_SLA_QUOTE_SEND_HOURS));
  const [slaFinalChecksStr, setSlaFinalChecksStr] = useState(String(DEFAULT_SLA_FINAL_CHECKS_HOURS));

  /** Margin colouring thresholds — drive green / neutral / red chips company-wide. */
  const [targetMarginPctStr, setTargetMarginPctStr] = useState(String(DEFAULT_TARGET_MARGIN_PCT));
  const [lowMarginPctStr, setLowMarginPctStr] = useState(String(DEFAULT_PULSE_LOW_MARGIN_PCT));

  const [zendeskSubdomain, setZendeskSubdomain] = useState("");

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
      setWorkingDays(new Set(parsed.working_days ?? DEFAULT_WORKING_DAYS));
      setWorkStartStr(parsed.working_hours?.start ?? DEFAULT_WORKING_HOURS.start);
      setWorkEndStr(parsed.working_hours?.end ?? DEFAULT_WORKING_HOURS.end);
      setSlaArrivalStr(String(parsed.sla_arrival_grace_hours ?? DEFAULT_SLA_ARRIVAL_GRACE_HOURS));
      setSlaQuoteSendStr(String(parsed.sla_quote_send_hours ?? DEFAULT_SLA_QUOTE_SEND_HOURS));
      setSlaFinalChecksStr(String(parsed.sla_final_checks_hours ?? DEFAULT_SLA_FINAL_CHECKS_HOURS));
      setTargetMarginPctStr(String(parsed.target_margin_pct ?? DEFAULT_TARGET_MARGIN_PCT));
      setLowMarginPctStr(String(parsed.pulse_low_margin_pct ?? DEFAULT_PULSE_LOW_MARGIN_PCT));
      setZendeskSubdomain(parsed.zendesk_subdomain ?? "");
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
    setSaving(true);
    try {
      const supabase = getSupabase();
      const slaArrival = Number(slaArrivalStr);
      const slaQuote = Number(slaQuoteSendStr);
      const slaFinal = Number(slaFinalChecksStr);
      for (const v of [slaArrival, slaQuote, slaFinal]) {
        if (!Number.isFinite(v) || v < MIN_SLA_HOURS || v > MAX_SLA_HOURS) {
          toast.error(`SLA hours must be between ${MIN_SLA_HOURS} and ${MAX_SLA_HOURS}.`);
          setSaving(false);
          return;
        }
      }
      const targetMargin = Number(targetMarginPctStr);
      const lowMargin = Number(lowMarginPctStr);
      for (const v of [targetMargin, lowMargin]) {
        if (!Number.isFinite(v) || v < 0 || v > 100) {
          toast.error("Margin % must be between 0 and 100.");
          setSaving(false);
          return;
        }
      }
      if (targetMargin < lowMargin) {
        toast.error("Target margin must be ≥ the low-margin threshold.");
        setSaving(false);
        return;
      }
      const next = mergeFrontendSetup(rawSetup, {
        bidding_sla_hours: hours,
        job_on_hold_presets: onHoldPresets,
        office_job_cancellation_presets: officeCancelPresets,
        working_days: [...workingDays],
        working_hours: { start: workStartStr, end: workEndStr },
        sla_arrival_grace_hours: slaArrival,
        sla_quote_send_hours: slaQuote,
        sla_final_checks_hours: slaFinal,
        target_margin_pct: targetMargin,
        pulse_low_margin_pct: lowMargin,
        zendesk_subdomain: zendeskSubdomain,
      });

      // No row yet → seed one with safe defaults so future Settings work.
      // This makes the UX a single click; no manual SQL or migration needed.
      if (!settingsId) {
        const { data: created, error: insertErr } = await supabase
          .from("company_settings")
          .insert({
            company_name: "My Company",
            address: "",
            phone: "",
            email: "",
            frontend_setup: next,
          })
          .select("id")
          .single();
        if (insertErr) throw insertErr;
        if (created?.id) setSettingsId(created.id);
      } else {
        const { error } = await supabase.from("company_settings").update({ frontend_setup: next }).eq("id", settingsId);
        if (error) throw error;
      }
      setRawSetup(next);
      setOnHoldPresets([...(next.job_on_hold_presets ?? DEFAULT_JOB_ON_HOLD_PRESETS)]);
      setOfficeCancelPresets([...(next.office_job_cancellation_presets ?? normalizeOfficeJobCancellationPresets(null))]);
      setWorkingDays(new Set(next.working_days ?? DEFAULT_WORKING_DAYS));
      setWorkStartStr(next.working_hours?.start ?? DEFAULT_WORKING_HOURS.start);
      setWorkEndStr(next.working_hours?.end ?? DEFAULT_WORKING_HOURS.end);
      setSlaArrivalStr(String(next.sla_arrival_grace_hours ?? DEFAULT_SLA_ARRIVAL_GRACE_HOURS));
      setSlaQuoteSendStr(String(next.sla_quote_send_hours ?? DEFAULT_SLA_QUOTE_SEND_HOURS));
      setSlaFinalChecksStr(String(next.sla_final_checks_hours ?? DEFAULT_SLA_FINAL_CHECKS_HOURS));
      setTargetMarginPctStr(String(next.target_margin_pct ?? DEFAULT_TARGET_MARGIN_PCT));
      setLowMarginPctStr(String(next.pulse_low_margin_pct ?? DEFAULT_PULSE_LOW_MARGIN_PCT));
      setZendeskSubdomain(next.zendesk_subdomain ?? "");
      toast.success("Setup saved");
      window.dispatchEvent(new Event("master-os-company-settings"));
    } catch (e) {
      console.error("[setup-tab] save failed", e);
      const msg = (() => {
        if (!e || typeof e !== "object") return "Failed to save";
        const err = e as { message?: string; details?: string; hint?: string; code?: string };
        const parts = [err.message, err.details, err.hint, err.code].filter(Boolean);
        return parts.length > 0 ? parts.join(" · ") : "Failed to save";
      })();
      toast.error(msg);
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
    <div className="space-y-8">
      <div>
        <h3 className="text-lg font-semibold text-text-primary">Setup</h3>
        <p className="text-sm text-text-tertiary">Office defaults and labels.</p>
      </div>

      <section className="space-y-3">
        <MicroLabel>Working Calendar</MicroLabel>
        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <CalendarClock className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Working Hours &amp; Days</CardTitle>
              <FixfyHintIcon text="Drives how monthly overhead (workforce + recurring bills) is split across working days in Pulse. Hours are also kept for SLA windows and Beacon time markers." />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Working Days</label>
            <div className="flex flex-wrap gap-1.5">
              {WEEKDAY_LABELS.map((d) => {
                const active = workingDays.has(d.id);
                return (
                  <button
                    key={d.id}
                    type="button"
                    disabled={!canEditConfig}
                    onClick={() =>
                      setWorkingDays((prev) => {
                        const next = new Set(prev);
                        if (next.has(d.id)) next.delete(d.id);
                        else next.add(d.id);
                        return next;
                      })
                    }
                    className={
                      active
                        ? "inline-flex items-center justify-center min-w-[52px] px-3 py-1.5 rounded-md text-xs font-semibold border border-primary bg-primary text-white transition-colors disabled:opacity-50"
                        : "inline-flex items-center justify-center min-w-[52px] px-3 py-1.5 rounded-md text-xs font-medium border border-border bg-card text-text-primary hover:bg-surface-hover transition-colors disabled:opacity-50"
                    }
                    aria-pressed={active}
                    aria-label={`${active ? "Disable" : "Enable"} ${d.full}`}
                  >
                    {d.short}
                  </button>
                );
              })}
            </div>
            <p className="mt-1.5 text-[10px] text-text-tertiary">
              {workingDays.size} Day{workingDays.size === 1 ? "" : "s"}/Week · ≈ {(workingDays.size * 4.345).toFixed(2)}/Month
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">Start</label>
              <Input
                type="time"
                value={workStartStr}
                onChange={(e) => setWorkStartStr(e.target.value)}
                className="w-32"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">End</label>
              <Input
                type="time"
                value={workEndStr}
                onChange={(e) => setWorkEndStr(e.target.value)}
                className="w-32"
              />
            </div>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditConfig || saving || workingDays.size === 0}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {saving ? "Saving…" : "Save Setup"}
            </Button>
          </div>
        </div>
      </Card>
      </section>

      <section className="space-y-3">
        <MicroLabel>Operations</MicroLabel>

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <AlarmClock className="h-4 w-4 text-text-tertiary" />
              <CardTitle>SLA Rules</CardTitle>
              <FixfyHintIcon text="Hours before a job breaches SLA. Used by Pulse 'SLA At Risk' and by Live View badges." />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 max-w-3xl">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  Arrival Grace (Hrs)
                  <FixfyHintIcon text="Hours past scheduled_start_at with no progress before the job breaches arrival SLA." />
                </label>
                <Input
                  type="number"
                  min={MIN_SLA_HOURS}
                  max={MAX_SLA_HOURS}
                  step={0.25}
                  value={slaArrivalStr}
                  onChange={(e) => setSlaArrivalStr(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  Quote To Be Sent (Hrs)
                  <FixfyHintIcon text="Maximum wall-clock from request creation until the quote is sent to the client." />
                </label>
                <Input
                  type="number"
                  min={MIN_SLA_HOURS}
                  max={MAX_SLA_HOURS}
                  step={0.5}
                  value={slaQuoteSendStr}
                  onChange={(e) => setSlaQuoteSendStr(e.target.value)}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  Final Checks Max (Hrs)
                  <FixfyHintIcon text="Maximum time a job may sit in Final Checks before flagged as overdue." />
                </label>
                <Input
                  type="number"
                  min={MIN_SLA_HOURS}
                  max={MAX_SLA_HOURS}
                  step={0.5}
                  value={slaFinalChecksStr}
                  onChange={(e) => setSlaFinalChecksStr(e.target.value)}
                />
              </div>
            </div>
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Margin Targets</CardTitle>
              <FixfyHintIcon text="Drives green / neutral / red colouring on margin chips across the app (Beacon Kanban, job cards, future dashboards). Margin ≥ Target = green, between Low and Target = neutral, below Low = red." />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  Target Margin (%)
                  <FixfyHintIcon text="Goal gross margin per job — at or above this number the chip is green." />
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={targetMarginPctStr}
                  onChange={(e) => setTargetMarginPctStr(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-text-tertiary">Default {DEFAULT_TARGET_MARGIN_PCT}%.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  Low Margin Threshold (%)
                  <FixfyHintIcon text="Below this margin the chip turns red. Also drives the Pulse 'Low margin jobs' KPI." />
                </label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  step={1}
                  value={lowMarginPctStr}
                  onChange={(e) => setLowMarginPctStr(e.target.value)}
                />
                <p className="mt-1 text-[10px] text-text-tertiary">Default {DEFAULT_PULSE_LOW_MARGIN_PCT}%.</p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-[11px] text-text-tertiary">
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-fx-green" /> ≥ {targetMarginPctStr || DEFAULT_TARGET_MARGIN_PCT}%</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-text-secondary/50" /> {lowMarginPctStr || DEFAULT_PULSE_LOW_MARGIN_PCT}–{targetMarginPctStr || DEFAULT_TARGET_MARGIN_PCT}%</span>
              <span>·</span>
              <span className="inline-flex items-center gap-1"><span className="inline-block h-2 w-2 rounded-full bg-fx-red" /> &lt; {lowMarginPctStr || DEFAULT_PULSE_LOW_MARGIN_PCT}%</span>
            </div>
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Quotes · Bidding SLA</CardTitle>
              <FixfyHintIcon text={`Target time for the Bidding stage. The list shows a countdown to this limit, then overdue time. Range ${MIN_BIDDING_SLA_HOURS}h–${MAX_BIDDING_SLA_HOURS}h.`} />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5">SLA (Hours)</label>
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
                {saving ? "Saving…" : "Save Setup"}
              </Button>
            </div>
          </div>
        </Card>

        <Card padding="none">
          <CardHeader className="px-6 pt-6">
            <div className="flex items-center gap-2">
              <PauseCircle className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Jobs · On Hold Reasons</CardTitle>
              <FixfyHintIcon text={`Options in the 'Reason preset' list when putting a job on hold. Add or remove up to ${MAX_JOB_ON_HOLD_PRESETS}. Use arrows to reorder.`} />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
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
              Add Reason
            </Button>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditConfig || saving}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {saving ? "Saving…" : "Save Setup"}
            </Button>
          </div>
        </div>
      </Card>

      <Card padding="none">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <XCircle className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Jobs · Cancellation Reasons</CardTitle>
            <FixfyHintIcon text="Reasons shown when cancelling a job. Internal id stays fixed (integrations and 'Other' behaviour rely on it). Rename labels to match your team." />
          </div>
        </CardHeader>
        <div className="space-y-4 px-6 pb-6">
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
        </div>
      </Card>

      <Card padding="none">
        <CardHeader className="px-6 pt-6">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Integrations · Zendesk</CardTitle>
            <FixfyHintIcon text="Subdomain used to deep-link to Zendesk tickets from the Zendesk badge popover. Falls back to the server ZENDESK_SUBDOMAIN env when blank." />
          </div>
        </CardHeader>
        <div className="space-y-4 px-6 pb-6">
          <div className="flex flex-wrap items-end gap-3 max-w-2xl">
            <div className="flex-1 min-w-[260px]">
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Subdomain
              </label>
              <div className="flex items-center gap-1.5">
                <Input
                  value={zendeskSubdomain}
                  onChange={(e) => setZendeskSubdomain(e.target.value)}
                  placeholder="e.g. yourcompany or yourcompany.zendesk.com"
                  className="flex-1"
                />
                <span className="text-[11px] text-fx-mute font-mono">.zendesk.com</span>
              </div>
              <p className="mt-1 text-[10px] text-text-tertiary">
                Accepts plain subdomain, full domain, or full URL — we normalize on save.
              </p>
            </div>
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditConfig || saving}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {saving ? "Saving…" : "Save Setup"}
            </Button>
          </div>
        </div>
      </Card>
      </section>
    </div>
  );
}
