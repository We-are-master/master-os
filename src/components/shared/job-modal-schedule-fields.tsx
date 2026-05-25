"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TimeSelect } from "@/components/ui/time-select";
import { cn } from "@/lib/utils";
import { ArrivalSlotPicker } from "@/components/shared/arrival-slot-picker";
import { jobModalClientArrivalPreview } from "@/lib/job-modal-schedule";
import type { RecurrenceFormState } from "@/lib/job-modal-schedule";
import {
  BYDAY_LABELS,
  BYDAY_ORDER,
  RECURRENCE_PRESET_OPTIONS,
  recurrencePresetFromRule,
  ruleFromRecurrencePreset,
  seriesPreview,
  type RecurrencePresetId,
} from "@/lib/job-recurrence";
import type {
  JobKind,
  JobRecurrenceByday,
  JobRecurrencePattern,
} from "@/types/database";

export type JobModalScheduleFieldKey =
  | "scheduled_date"
  | "arrival_from"
  | "arrival_window_mins"
  | "end_date"
  | "end_time"
  | "job_kind";

type Props = {
  /** mig 158: 'one_off' | 'multi_day' | 'recurring'. Default 'one_off'. */
  jobKind?: JobKind;
  scheduledDate: string;
  arrivalFrom: string;
  arrivalWindowMins: string;
  /** Multi-day extras (mig 158). */
  endDate?: string;
  endTime?: string;
  /** Recurring sub-form state — required when jobKind === 'recurring' is reachable in this modal. */
  recurrence?: RecurrenceFormState;
  onRecurrenceChange?: (patch: Partial<RecurrenceFormState>) => void;
  onChange: (field: JobModalScheduleFieldKey, value: string) => void;
  /** e.g. quote pre-fill hint under start date */
  startDateFooter?: ReactNode;
  startDateRequired?: boolean;
  requiredFieldClassName?: string;
  /** When true, the one-off form skips the arrival-slot picker — the caller is rendering it elsewhere (e.g. inline with Type of Work in the Rate Type section). */
  hideArrivalSlot?: boolean;
};

/**
 * Job-creation schedule fields — shared by:
 *   - jobs/page.tsx CreateJobModal
 *   - requests-client.tsx ConvertToJobModal
 *   - quotes-client.tsx ConvertToJobModal
 *
 * 2-level kind toggle (mig 158):
 *   [ Single day ]  [ Multiple visits ]
 *                          ↓ (when active)
 *                   [ Spans days ]  [ Repeats ]
 *
 * Internal state (`jobKind`) maps as: single→one_off, spans_days→multi_day,
 * repeats→recurring. Multi-day and Recurring share visual nesting but are
 * distinct in the schema (1 row vs N rows).
 */
export function JobModalScheduleFields({
  jobKind = "one_off",
  scheduledDate,
  arrivalFrom,
  arrivalWindowMins,
  endDate = "",
  endTime = "17:00",
  recurrence,
  onRecurrenceChange,
  onChange,
  startDateFooter,
  startDateRequired,
  requiredFieldClassName,
  hideArrivalSlot = false,
}: Props) {
  const isOneOff = jobKind === "one_off";
  const isMultiDay = jobKind === "multi_day";
  const isRecurring = jobKind === "recurring";
  const preview = jobModalClientArrivalPreview(scheduledDate, arrivalFrom, arrivalWindowMins, {
    useArrivalSlots: isOneOff && !hideArrivalSlot,
  });
  const isMultiple = isMultiDay || isRecurring;

  const setKind = (k: JobKind) => onChange("job_kind", k);

  return (
    <>
      {/* Primary toggle: One-Off / Recurring */}
      <div className="flex flex-wrap items-stretch gap-1.5 min-w-0">
        <KindTab
          label="One-Off"
          description="One day only"
          active={isOneOff}
          onClick={() => setKind("one_off")}
        />
        <KindTab
          label="Recurring"
          description="Spans days or repeats"
          active={isMultiple}
          onClick={() => {
            // First click on Recurring → default to Spans days.
            if (!isMultiple) setKind("multi_day");
          }}
        />
      </div>

      {/* Secondary toggle (only when Multiple is active) */}
      {isMultiple ? (
        <div className="flex flex-wrap items-stretch gap-1.5 -mt-1 pl-3 border-l-2 border-primary/30 min-w-0">
          <SubKindTab
            label="Spans days"
            description="Mon → Fri (continuous)"
            active={isMultiDay}
            onClick={() => setKind("multi_day")}
          />
          <SubKindTab
            label="Repeats"
            description="Every Tuesday, monthly, …"
            active={isRecurring}
            onClick={() => setKind("recurring")}
          />
        </div>
      ) : null}

      {/* Form per mode */}
      {isOneOff ? (
        <>
          <div
            className={cn(
              "grid grid-cols-1 gap-2 min-w-0",
              !hideArrivalSlot && "@lg:grid-cols-[minmax(7.5rem,9rem)_minmax(0,1fr)] @lg:gap-3",
            )}
          >
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Start Date{startDateRequired ? " *" : ""}
              </label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => onChange("scheduled_date", e.target.value)}
                className={`h-10 w-full ${requiredFieldClassName ?? ""}`.trim()}
              />
              {startDateFooter ? <div className="mt-1">{startDateFooter}</div> : null}
            </div>
            {!hideArrivalSlot && (
              <ArrivalSlotPicker
                arrivalFrom={arrivalFrom}
                arrivalWindowMins={arrivalWindowMins}
                onPick={(from, mins) => {
                  onChange("arrival_from", from);
                  onChange("arrival_window_mins", mins);
                }}
              />
            )}
          </div>
          {preview ? <p className="text-[11px] font-medium text-text-secondary">{preview}</p> : null}
          <p className="text-[10px] text-text-tertiary -mt-1">
            Clients and partners see this slot as the arrival window. Late status is still based on the window end.
          </p>
        </>
      ) : isMultiDay ? (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Start Date *
              </label>
              <Input
                type="date"
                value={scheduledDate}
                onChange={(e) => {
                  const v = e.target.value;
                  onChange("scheduled_date", v);
                  if (v && endDate && endDate < v) onChange("end_date", v);
                }}
                className={`h-10 max-w-[200px] ${requiredFieldClassName ?? ""}`.trim()}
              />
              {startDateFooter ? <div className="mt-1">{startDateFooter}</div> : null}
            </div>
            <TimeSelect
              label="Start Time *"
              value={arrivalFrom}
              onChange={(v) => onChange("arrival_from", v)}
              className={requiredFieldClassName}
            />
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                End Date *
              </label>
              <Input
                type="date"
                value={endDate}
                min={scheduledDate.trim() || undefined}
                disabled={!scheduledDate.trim()}
                title={scheduledDate.trim() ? `On or after ${scheduledDate.trim()}` : "Set the start date first"}
                onChange={(e) => {
                  const v = e.target.value;
                  const min = scheduledDate.trim();
                  if (min && v && v < min) return;
                  onChange("end_date", v);
                }}
                className={`h-10 max-w-[200px] ${requiredFieldClassName ?? ""}`.trim()}
              />
            </div>
            <TimeSelect
              label="End Time *"
              value={endTime}
              onChange={(v) => onChange("end_time", v)}
              className={requiredFieldClassName}
            />
          </div>
          <p className="text-[10px] text-text-tertiary -mt-1">
            Multi-day jobs render as a continuous bar in the calendar. Start time = arrival on day one;
            end time = wrap-up on the last day. No arrival window — the partner app shows the multi-day range directly.
          </p>
        </>
      ) : (
        // Recurring sub-form
        <RecurringFormFields
          scheduledDate={scheduledDate}
          recurrence={recurrence}
          onChange={onChange}
          onRecurrenceChange={onRecurrenceChange}
          startDateFooter={startDateFooter}
          requiredFieldClassName={requiredFieldClassName}
        />
      )}
    </>
  );
}

function RecurringFormFields({
  scheduledDate,
  recurrence,
  onChange,
  onRecurrenceChange,
  startDateFooter,
  requiredFieldClassName,
}: {
  scheduledDate: string;
  recurrence?: RecurrenceFormState;
  onChange: (field: JobModalScheduleFieldKey, value: string) => void;
  onRecurrenceChange?: (patch: Partial<RecurrenceFormState>) => void;
  startDateFooter?: ReactNode;
  requiredFieldClassName?: string;
}) {
  if (!recurrence || !onRecurrenceChange) {
    return (
      <p className="text-[11px] text-amber-600">
        Recurring is not configured in this modal. (Parent must pass <code>recurrence</code> + <code>onRecurrenceChange</code>.)
      </p>
    );
  }

  const presetId = recurrencePresetFromRule(recurrence.pattern, recurrence.interval);
  const isCustomInterval = presetId === "custom";

  const previewLine = scheduledDate
    ? seriesPreview({
        pattern: recurrence.pattern,
        interval: recurrence.interval,
        byday: recurrence.pattern === "weekly" && recurrence.byday.length > 0 ? recurrence.byday : undefined,
        start_date: scheduledDate,
        end_date: recurrence.end_mode === "until" && recurrence.end_date ? recurrence.end_date : null,
        max_occurrences:
          recurrence.end_mode === "count" && recurrence.max_occurrences
            ? Number(recurrence.max_occurrences)
            : null,
      })
    : "Pick a start date to preview the series.";

  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Start Date *
          </label>
          <Input
            type="date"
            value={scheduledDate}
            onChange={(e) => {
              const v = e.target.value;
              onChange("scheduled_date", v);
              if (
                v &&
                recurrence.end_mode === "until" &&
                recurrence.end_date.trim() &&
                recurrence.end_date < v
              ) {
                onRecurrenceChange({ end_date: v });
              }
            }}
            className={`h-10 max-w-[200px] ${requiredFieldClassName ?? ""}`.trim()}
          />
          {startDateFooter ? <div className="mt-1">{startDateFooter}</div> : null}
        </div>
        <Select
          label="Repeats"
          value={presetId}
          onChange={(e) => {
            const id = e.target.value as RecurrencePresetId;
            if (id === "custom") {
              onRecurrenceChange({ pattern: recurrence.pattern, interval: recurrence.interval });
              return;
            }
            const { pattern, interval } = ruleFromRecurrencePreset(id);
            onRecurrenceChange({ pattern, interval });
          }}
          options={RECURRENCE_PRESET_OPTIONS.map((p) => ({ value: p.id, label: p.label }))}
        />
        {isCustomInterval ? (
          <>
            <Select
              label="Unit"
              value={recurrence.pattern}
              onChange={(e) =>
                onRecurrenceChange({ pattern: e.target.value as JobRecurrencePattern })
              }
              options={[
                { value: "daily", label: "Day(s)" },
                { value: "weekly", label: "Week(s)" },
                { value: "monthly", label: "Month(s)" },
              ]}
            />
            <div>
              <label className="block text-xs font-medium text-text-secondary mb-1.5">
                Every
              </label>
              <div className="flex items-center gap-2">
                <Input
                  type="number"
                  min={1}
                  max={365}
                  value={String(recurrence.interval)}
                  onChange={(e) => {
                    const n = Math.max(1, Number(e.target.value) || 1);
                    onRecurrenceChange({ interval: n });
                  }}
                  className={`h-10 w-20 ${requiredFieldClassName ?? ""}`.trim()}
                />
                <span className="text-xs text-text-secondary">
                  {recurrence.pattern === "daily" && (recurrence.interval === 1 ? "day" : "days")}
                  {recurrence.pattern === "weekly" && (recurrence.interval === 1 ? "week" : "weeks")}
                  {recurrence.pattern === "monthly" && (recurrence.interval === 1 ? "month" : "months")}
                </span>
              </div>
            </div>
          </>
        ) : (
          <div className="md:col-span-2">
            <p className="text-[11px] text-text-tertiary rounded-lg border border-border-light bg-surface-hover/30 px-3 py-2">
              Repeats{" "}
              <span className="font-medium text-text-secondary">
                {RECURRENCE_PRESET_OPTIONS.find((p) => p.id === presetId)?.label ?? "—"}
              </span>
              . Choose <span className="font-medium">Custom interval…</span> for any frequency (e.g. every 4 weeks or 6
              months).
            </p>
          </div>
        )}
        {recurrence.pattern === "weekly" ? (
          <div>
            <label className="block text-xs font-medium text-text-secondary mb-1.5">
              On These Weekdays
            </label>
            <div className="flex flex-wrap gap-1.5">
              {BYDAY_ORDER.map((day) => {
                const active = recurrence.byday.includes(day);
                return (
                  <button
                    key={day}
                    type="button"
                    onClick={() => {
                      const next = active
                        ? recurrence.byday.filter((d) => d !== day)
                        : [...recurrence.byday, day].sort(
                            (a, b) => BYDAY_ORDER.indexOf(a) - BYDAY_ORDER.indexOf(b),
                          );
                      onRecurrenceChange({ byday: next });
                    }}
                    className={cn(
                      "rounded-md border px-2.5 py-1 text-xs font-medium transition-colors",
                      active
                        ? "border-primary bg-primary text-white"
                        : "border-border-light bg-card text-text-secondary hover:border-primary/40",
                    )}
                  >
                    {BYDAY_LABELS[day]}
                  </button>
                );
              })}
            </div>
            <p className="mt-1 text-[10px] text-text-tertiary">
              Leave empty to repeat on the same weekday as the start date.
            </p>
          </div>
        ) : (
          <div />
        )}
        <TimeSelect
          label="Start Time *"
          value={recurrence.start_time}
          onChange={(v) => onRecurrenceChange({ start_time: v })}
          className={requiredFieldClassName}
        />
        <TimeSelect
          label="End Time *"
          value={recurrence.end_time}
          onChange={(v) => onRecurrenceChange({ end_time: v })}
          className={requiredFieldClassName}
        />
      </div>

      {/* End condition */}
      <div className="rounded-lg border border-border-light bg-surface-hover/30 p-3">
        <p className="mb-2 text-xs font-medium text-text-secondary">Ends</p>
        <div className="flex flex-col gap-2">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="recurrence_end_mode"
              checked={recurrence.end_mode === "count"}
              onChange={() => onRecurrenceChange({ end_mode: "count" })}
            />
            <span className="text-xs">After</span>
            <Input
              type="number"
              min={1}
              max={365}
              value={recurrence.max_occurrences}
              onChange={(e) => onRecurrenceChange({ max_occurrences: e.target.value })}
              disabled={recurrence.end_mode !== "count"}
              className="h-8 w-20"
            />
            <span className="text-xs">visits</span>
          </label>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="radio"
              name="recurrence_end_mode"
              checked={recurrence.end_mode === "until"}
              onChange={() => onRecurrenceChange({ end_mode: "until" })}
            />
            <span className="text-xs">Until</span>
            <Input
              type="date"
              value={recurrence.end_date}
              min={scheduledDate.trim() || undefined}
              disabled={recurrence.end_mode !== "until" || !scheduledDate.trim()}
              title={
                recurrence.end_mode !== "until"
                  ? undefined
                  : scheduledDate.trim()
                    ? `On or after ${scheduledDate.trim()}`
                    : "Set the start date first"
              }
              onChange={(e) => {
                const v = e.target.value;
                const min = scheduledDate.trim();
                if (min && v && v < min) return;
                onRecurrenceChange({ end_date: v });
              }}
              className="h-8"
            />
          </label>
        </div>
      </div>

      {/* Live preview */}
      <div className="rounded-lg border border-blue-300/40 bg-blue-50/60 px-3 py-2 dark:border-blue-700/40 dark:bg-blue-950/20">
        <p className="text-[11px] font-medium text-blue-900 dark:text-blue-200">
          {previewLine}
        </p>
      </div>

      <p className="text-[10px] text-text-tertiary -mt-1">
        Each occurrence becomes its own job in the schedule. The first 90 days
        are generated immediately; the rest are filled in by the daily cron.
      </p>
    </>
  );
}

function KindTab({
  label, description, active, disabled, onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={cn(
        "min-w-0 flex-1 basis-[calc(50%-0.375rem)] rounded-md border px-2.5 py-1.5 text-left transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : disabled
            ? "border-border-light bg-surface-hover/40 text-text-tertiary opacity-60 cursor-not-allowed"
            : "border-border-light bg-card text-text-secondary hover:border-primary/40 hover:text-text-primary",
      )}
    >
      <span className="block text-xs font-semibold leading-tight">{label}</span>
      <span className="block text-[10px] leading-tight opacity-80">{description}</span>
    </button>
  );
}

function SubKindTab({
  label, description, active, onClick,
}: {
  label: string;
  description: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "min-w-0 flex-1 basis-[calc(50%-0.375rem)] rounded-md border px-2 py-1 text-left transition-colors",
        active
          ? "border-primary bg-primary/10 text-primary"
          : "border-border-light bg-card text-text-secondary hover:border-primary/40 hover:text-text-primary",
      )}
    >
      <span className="block text-[11px] font-semibold leading-tight">{label}</span>
      <span className="block text-[10px] leading-tight opacity-80">{description}</span>
    </button>
  );
}

/** Re-export for parents that maintain their own form state. */
export type { JobRecurrenceByday } from "@/types/database";
