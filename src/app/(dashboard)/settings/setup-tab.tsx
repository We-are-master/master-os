"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AlarmClock, CalendarClock, Car, ChevronDown, ChevronUp, ClipboardCheck, Loader2, MapPin, SlidersHorizontal, PauseCircle, Plus, Trash2, XCircle } from "lucide-react";
import { FixfyHintIcon } from "@/components/ui/fixfy-hint-icon";
import { MicroLabel } from "@/components/fx/primitives";
import { toast } from "sonner";
import { getSupabase } from "@/services/base";
import { useAdminConfig } from "@/hooks/use-admin-config";
import {
  DEFAULT_ACCESS_CCZ_FEE_GBP,
  DEFAULT_ACCESS_PARKING_FEE_GBP,
  DEFAULT_JOB_ON_HOLD_PRESETS,
  DEFAULT_PULSE_LOW_MARGIN_PCT,
  MAX_ACCESS_FEE_GBP,
  MIN_ACCESS_FEE_GBP,
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
  normalizeJobOnHoldPresets,
  type JobOnHoldPresetRow,
  type OfficeJobCancellationPresetRow,
} from "@/lib/frontend-setup";
import { slugifyJobOnHoldPresetId } from "@/lib/job-on-hold-reasons";
import {
  buildDefaultPartnerDocumentRules,
  getPartnerDocumentCatalogForSetup,
  mergePartnerDocumentRules,
  type PartnerDocCatalogEntry,
  type PartnerDocRuleRow,
} from "@/lib/partner-required-docs";

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
  const [onHoldPresets, setOnHoldPresets] = useState<JobOnHoldPresetRow[]>(() =>
    DEFAULT_JOB_ON_HOLD_PRESETS.map((r) => ({ ...r })),
  );

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
  const [zendeskOnHoldReasonFieldId, setZendeskOnHoldReasonFieldId] = useState("");
  const [zendeskComplaintDescriptionFieldId, setZendeskComplaintDescriptionFieldId] = useState("");
  const [zendeskComplaintSolutionFieldId, setZendeskComplaintSolutionFieldId] = useState("");
  const [onHoldZendeskSyncing, setOnHoldZendeskSyncing] = useState(false);
  const [accessCczFeeStr, setAccessCczFeeStr] = useState(String(DEFAULT_ACCESS_CCZ_FEE_GBP));
  const [accessParkingFeeStr, setAccessParkingFeeStr] = useState(String(DEFAULT_ACCESS_PARKING_FEE_GBP));
  const [partnerDocRules, setPartnerDocRules] = useState<PartnerDocRuleRow[]>(() =>
    buildDefaultPartnerDocumentRules(),
  );
  const [tradeCertsExpanded, setTradeCertsExpanded] = useState(false);

  const syncOnHoldReasonsToZendesk = useCallback(
    async (opts?: { dryRun?: boolean; silent?: boolean }) => {
      setOnHoldZendeskSyncing(true);
      try {
        const res = await fetch("/api/admin/job-on-hold/zendesk-sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ dryRun: opts?.dryRun === true, presets: onHoldPresets }),
        });
        const json = (await res.json().catch(() => ({}))) as {
          ok?: boolean;
          skipped?: string;
          error?: string;
          userMessage?: string | null;
          stats?: { append?: number; prune?: number; rename?: number };
        };
        if (!res.ok || json.ok === false) {
          if (!opts?.silent) {
            toast.error(json.userMessage ?? json.error ?? json.skipped ?? "Zendesk sync failed");
          }
          return false;
        }
        if (json.skipped) {
          if (!opts?.silent) {
            toast.error(
              json.userMessage
                ?? "Configure the on-hold reason field id under Integrations · Zendesk, then Save Setup.",
            );
          }
          return false;
        }
        if (!opts?.silent && json.stats) {
          const { append = 0, prune = 0, rename = 0 } = json.stats;
          toast.success(
            opts?.dryRun
              ? `Preview: +${append} / −${prune} / rename ${rename} (dry run)`
              : `Zendesk on-hold reasons synced (+${append}, −${prune}, rename ${rename})`,
          );
        }
        return true;
      } catch {
        if (!opts?.silent) toast.error("Zendesk sync failed");
        return false;
      } finally {
        setOnHoldZendeskSyncing(false);
      }
    },
    [onHoldPresets],
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
      setOnHoldPresets([...normalizeJobOnHoldPresets(parsed.job_on_hold_presets ?? null)]);
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
      setZendeskOnHoldReasonFieldId(
        parsed.zendesk_on_hold_reason_field_id ? String(parsed.zendesk_on_hold_reason_field_id) : "",
      );
      setZendeskComplaintDescriptionFieldId(
        parsed.zendesk_complaint_description_field_id
          ? String(parsed.zendesk_complaint_description_field_id)
          : "",
      );
      setZendeskComplaintSolutionFieldId(
        parsed.zendesk_complaint_solution_field_id ? String(parsed.zendesk_complaint_solution_field_id) : "",
      );
      setAccessCczFeeStr(String(parsed.access_ccz_fee_gbp ?? DEFAULT_ACCESS_CCZ_FEE_GBP));
      setAccessParkingFeeStr(String(parsed.access_parking_fee_gbp ?? DEFAULT_ACCESS_PARKING_FEE_GBP));
      setPartnerDocRules(mergePartnerDocumentRules(parsed.partner_document_rules));
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
      const accessCczFee = Number(accessCczFeeStr);
      const accessParkingFee = Number(accessParkingFeeStr);
      for (const [label, v] of [
        ["CCZ fee", accessCczFee],
        ["Parking fee", accessParkingFee],
      ] as const) {
        if (!Number.isFinite(v) || v < MIN_ACCESS_FEE_GBP || v > MAX_ACCESS_FEE_GBP) {
          toast.error(`${label} must be between £${MIN_ACCESS_FEE_GBP} and £${MAX_ACCESS_FEE_GBP}.`);
          setSaving(false);
          return;
        }
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
        zendesk_on_hold_reason_field_id: zendeskOnHoldReasonFieldId.trim()
          ? Number(zendeskOnHoldReasonFieldId.trim())
          : undefined,
        zendesk_complaint_description_field_id: zendeskComplaintDescriptionFieldId.trim()
          ? Number(zendeskComplaintDescriptionFieldId.trim())
          : undefined,
        zendesk_complaint_solution_field_id: zendeskComplaintSolutionFieldId.trim()
          ? Number(zendeskComplaintSolutionFieldId.trim())
          : undefined,
        access_ccz_fee_gbp: accessCczFee,
        access_parking_fee_gbp: accessParkingFee,
        partner_document_rules: partnerDocRules,
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
      setOnHoldPresets([...normalizeJobOnHoldPresets(next.job_on_hold_presets ?? null)]);
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
      setZendeskOnHoldReasonFieldId(
        next.zendesk_on_hold_reason_field_id ? String(next.zendesk_on_hold_reason_field_id) : "",
      );
      setZendeskComplaintDescriptionFieldId(
        next.zendesk_complaint_description_field_id
          ? String(next.zendesk_complaint_description_field_id)
          : "",
      );
      setZendeskComplaintSolutionFieldId(
        next.zendesk_complaint_solution_field_id ? String(next.zendesk_complaint_solution_field_id) : "",
      );
      setAccessCczFeeStr(String(next.access_ccz_fee_gbp ?? DEFAULT_ACCESS_CCZ_FEE_GBP));
      setAccessParkingFeeStr(String(next.access_parking_fee_gbp ?? DEFAULT_ACCESS_PARKING_FEE_GBP));
      setPartnerDocRules(mergePartnerDocumentRules(next.partner_document_rules));
      toast.success("Setup saved");
      window.dispatchEvent(new Event("master-os-company-settings"));
      if (next.zendesk_on_hold_reason_field_id) {
        void syncOnHoldReasonsToZendesk({ silent: true });
      }
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
              <Car className="h-4 w-4 text-text-tertiary" />
              <CardTitle>Jobs · Access Fees</CardTitle>
              <FixfyHintIcon text="Customer surcharges when CCZ or paid parking is applied on a job (create job, request convert, job detail). Stored in company settings — no migration needed." />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-2xl">
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  <MapPin className="h-3.5 w-3.5" />
                  CCZ fee (£)
                  <FixfyHintIcon text="Congestion Charge surcharge when CCZ is applied on an eligible central London job." />
                </label>
                <Input
                  type="number"
                  min={MIN_ACCESS_FEE_GBP}
                  max={MAX_ACCESS_FEE_GBP}
                  step={0.01}
                  value={accessCczFeeStr}
                  onChange={(e) => setAccessCczFeeStr(e.target.value)}
                  disabled={!canEditConfig}
                />
                <p className="mt-1 text-[10px] text-text-tertiary">Default £{DEFAULT_ACCESS_CCZ_FEE_GBP.toFixed(2)}.</p>
              </div>
              <div>
                <label className="block text-xs font-medium text-text-secondary mb-1.5 inline-flex items-center gap-1.5">
                  <Car className="h-3.5 w-3.5" />
                  Parking fee (£)
                  <FixfyHintIcon text="Surcharge when the customer does not offer free parking on site." />
                </label>
                <Input
                  type="number"
                  min={MIN_ACCESS_FEE_GBP}
                  max={MAX_ACCESS_FEE_GBP}
                  step={0.01}
                  value={accessParkingFeeStr}
                  onChange={(e) => setAccessParkingFeeStr(e.target.value)}
                  disabled={!canEditConfig}
                />
                <p className="mt-1 text-[10px] text-text-tertiary">Default £{DEFAULT_ACCESS_PARKING_FEE_GBP.toFixed(2)}.</p>
              </div>
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
              <FixfyHintIcon text={`On-hold reason ids (e.g. complaint) must match the Zendesk dropdown. Rename labels for staff; reorder up to ${MAX_JOB_ON_HOLD_PRESETS} options.`} />
            </div>
          </CardHeader>
          <div className="space-y-4 px-6 pb-6">
          <div className="space-y-2 max-w-xl">
            {onHoldPresets.map((row, idx) => (
              <div key={row.id} className="flex items-start gap-2">
                <div className="flex-1 min-w-0 space-y-1">
                  <label className="block text-[10px] font-medium text-text-tertiary truncate" title={row.id}>
                    id: <code className="text-[11px]">{row.id}</code>
                  </label>
                  <Input
                    value={row.label}
                    maxLength={MAX_JOB_ON_HOLD_PRESET_LEN}
                    placeholder="Label shown to staff"
                    onChange={(e) => {
                      const v = e.target.value;
                      setOnHoldPresets((prev) => prev.map((p, i) => (i === idx ? { ...p, label: v } : p)));
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
                setOnHoldPresets((prev) => {
                  if (prev.length >= MAX_JOB_ON_HOLD_PRESETS) return prev;
                  const label = "New reason";
                  let id = slugifyJobOnHoldPresetId(label);
                  let n = 1;
                  while (prev.some((p) => p.id === id)) {
                    id = `${slugifyJobOnHoldPresetId(label)}_${n++}`;
                  }
                  return [...prev, { id, label }];
                })
              }
            >
              <Plus className="h-4 w-4 mr-1.5 inline" />
              Add Reason
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={!canEditConfig || onHoldZendeskSyncing}
              loading={onHoldZendeskSyncing}
              onClick={() => void syncOnHoldReasonsToZendesk()}
            >
              Sync reasons → Zendesk
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
          <p className="text-[10px] text-text-tertiary leading-snug max-w-xl">
            Sync uses the list above (no need to save first). First time: paste the{" "}
            <strong>On-hold reason field id</strong> under <strong>Integrations · Zendesk</strong> below and Save Setup.
            Zendesk option <code className="text-[11px]">value</code> = the <code className="text-[11px]">id</code> on each row.
          </p>
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
            <ClipboardCheck className="h-4 w-4 text-text-tertiary" />
            <CardTitle>Partner documents</CardTitle>
            <FixfyHintIcon text="Choose which documents partners must upload. Request shows the doc in checklists and upload links; Mandatory blocks compliance and counts toward the document score when missing." />
          </div>
          <p className="text-xs text-text-tertiary mt-1 font-normal leading-relaxed max-w-3xl">
            UTR applies to self-employed partners only. Trade certificates apply when the partner has that trade.
          </p>
        </CardHeader>
        <div className="px-6 pb-6 space-y-5">
          <PartnerDocRulesGroup
            title="Core & legal"
            entries={getPartnerDocumentCatalogForSetup().filter((e) =>
              ["core", "utr", "agreement"].includes(e.group),
            )}
            rules={partnerDocRules}
            canEdit={canEditConfig}
            onPatch={(id, patch) => {
              setPartnerDocRules((prev) =>
                prev.map((r) => {
                  if (r.id !== id) return r;
                  const enabled = patch.enabled ?? r.enabled;
                  return {
                    ...r,
                    enabled,
                    mandatory: enabled ? (patch.mandatory ?? r.mandatory) : false,
                  };
                }),
              );
            }}
          />
          <div>
            <button
              type="button"
              className="flex w-full items-center justify-between gap-2 rounded-lg border border-border-light bg-card px-3 py-2.5 text-left hover:bg-surface-hover/80 transition-colors"
              onClick={() => setTradeCertsExpanded((v) => !v)}
            >
              <span className="text-sm font-medium text-text-primary">Trade certificates</span>
              {tradeCertsExpanded ? (
                <ChevronUp className="h-4 w-4 text-text-tertiary shrink-0" />
              ) : (
                <ChevronDown className="h-4 w-4 text-text-tertiary shrink-0" />
              )}
            </button>
            {tradeCertsExpanded ? (
              <div className="mt-3 space-y-3">
                <div className="flex flex-wrap gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={!canEditConfig}
                    onClick={() => {
                      const tradeIds = new Set(
                        getPartnerDocumentCatalogForSetup()
                          .filter((e) => e.group === "trade_cert")
                          .map((e) => e.id),
                      );
                      setPartnerDocRules((prev) =>
                        prev.map((r) =>
                          tradeIds.has(r.id) ? { ...r, enabled: true, mandatory: true } : r,
                        ),
                      );
                    }}
                  >
                    All trade certs mandatory
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    disabled={!canEditConfig}
                    onClick={() => {
                      const tradeIds = new Set(
                        getPartnerDocumentCatalogForSetup()
                          .filter((e) => e.group === "trade_cert")
                          .map((e) => e.id),
                      );
                      setPartnerDocRules((prev) =>
                        prev.map((r) =>
                          tradeIds.has(r.id) ? { ...r, enabled: true, mandatory: false } : r,
                        ),
                      );
                    }}
                  >
                    All optional
                  </Button>
                </div>
                <PartnerDocRulesGroup
                  title=""
                  entries={getPartnerDocumentCatalogForSetup().filter((e) => e.group === "trade_cert")}
                  rules={partnerDocRules}
                  canEdit={canEditConfig}
                  onPatch={(id, patch) => {
                    setPartnerDocRules((prev) =>
                      prev.map((r) => {
                        if (r.id !== id) return r;
                        const enabled = patch.enabled ?? r.enabled;
                        return {
                          ...r,
                          enabled,
                          mandatory: enabled ? (patch.mandatory ?? r.mandatory) : false,
                        };
                      }),
                    );
                  }}
                />
              </div>
            ) : null}
          </div>
          <PartnerDocRulesGroup
            title="Optional extras"
            entries={getPartnerDocumentCatalogForSetup().filter((e) => e.group === "extra")}
            rules={partnerDocRules}
            canEdit={canEditConfig}
            onPatch={(id, patch) => {
              setPartnerDocRules((prev) =>
                prev.map((r) => {
                  if (r.id !== id) return r;
                  const enabled = patch.enabled ?? r.enabled;
                  return {
                    ...r,
                    enabled,
                    mandatory: enabled ? (patch.mandatory ?? r.mandatory) : false,
                  };
                }),
              );
            }}
          />
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
            <FixfyHintIcon text="Zendesk subdomain + complaint ticket field ids. Field ids can also be set via env vars (see docs). Dropdown options sync from On Hold Reasons when you save." />
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
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                On-hold reason field id
              </label>
              <Input
                value={zendeskOnHoldReasonFieldId}
                onChange={(e) => setZendeskOnHoldReasonFieldId(e.target.value.replace(/\D/g, ""))}
                placeholder="Zendesk dropdown field id"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Complaint description field id
              </label>
              <Input
                value={zendeskComplaintDescriptionFieldId}
                onChange={(e) => setZendeskComplaintDescriptionFieldId(e.target.value.replace(/\D/g, ""))}
                placeholder="Multiline field id"
                inputMode="numeric"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Partner solution field id
              </label>
              <Input
                value={zendeskComplaintSolutionFieldId}
                onChange={(e) => setZendeskComplaintSolutionFieldId(e.target.value.replace(/\D/g, ""))}
                placeholder="Multiline field id"
                inputMode="numeric"
              />
            </div>
          </div>
          <p className="text-[10px] text-text-tertiary max-w-3xl leading-snug">
            In Zendesk Admin → Ticket fields, open each field and copy the numeric id from the URL
            (e.g. <code className="text-[11px]">.../ticket_fields/1234567890123</code>). Map the complaint form fields to the same ids.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              onClick={() => void handleSave()}
              disabled={!canEditConfig || saving}
              icon={saving ? <Loader2 className="h-4 w-4 animate-spin" /> : undefined}
            >
              {saving ? "Saving…" : "Save Setup"}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={!canEditConfig || onHoldZendeskSyncing}
              loading={onHoldZendeskSyncing}
              onClick={() => void syncOnHoldReasonsToZendesk()}
            >
              Sync on-hold reasons → Zendesk
            </Button>
          </div>
        </div>
      </Card>
      </section>
    </div>
  );
}

function PartnerDocRulesGroup({
  title,
  entries,
  rules,
  canEdit,
  onPatch,
}: {
  title: string;
  entries: PartnerDocCatalogEntry[];
  rules: PartnerDocRuleRow[];
  canEdit: boolean;
  onPatch: (id: string, patch: Partial<Pick<PartnerDocRuleRow, "enabled" | "mandatory">>) => void;
}) {
  const ruleById = new Map(rules.map((r) => [r.id, r]));
  if (entries.length === 0) return null;
  return (
    <div className="space-y-2">
      {title ? <MicroLabel>{title}</MicroLabel> : null}
      <div className="rounded-lg border border-border-light overflow-hidden divide-y divide-border-light">
        <div className="hidden sm:grid sm:grid-cols-[1fr_5.5rem_5.5rem] gap-2 px-3 py-2 bg-surface-hover/60 text-[10px] font-mono uppercase tracking-[0.1em] text-text-tertiary">
          <span>Document</span>
          <span className="text-center">Request</span>
          <span className="text-center">Mandatory</span>
        </div>
        {entries.map((entry) => {
          const rule = ruleById.get(entry.id) ?? { id: entry.id, enabled: true, mandatory: true };
          return (
            <div
              key={entry.id}
              className="grid grid-cols-1 sm:grid-cols-[1fr_5.5rem_5.5rem] gap-2 px-3 py-2.5 items-start sm:items-center"
            >
              <div className="min-w-0">
                <p className="text-sm font-medium text-text-primary">{entry.name}</p>
                <p className="text-[11px] text-text-tertiary leading-snug">
                  {entry.description}
                  {entry.trade ? ` · ${entry.trade}` : ""}
                </p>
              </div>
              <label className="flex items-center justify-start sm:justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary shrink-0"
                  checked={rule.enabled}
                  disabled={!canEdit}
                  onChange={(e) => onPatch(entry.id, { enabled: e.target.checked })}
                />
                <span className="sm:hidden">Request</span>
              </label>
              <label className="flex items-center justify-start sm:justify-center gap-2 text-xs text-text-secondary">
                <input
                  type="checkbox"
                  className="h-3.5 w-3.5 rounded border-border text-primary shrink-0"
                  checked={rule.mandatory}
                  disabled={!canEdit || !rule.enabled}
                  onChange={(e) => onPatch(entry.id, { mandatory: e.target.checked })}
                />
                <span className="sm:hidden">Mandatory</span>
              </label>
            </div>
          );
        })}
      </div>
    </div>
  );
}
