"use client";

import type { ReactNode } from "react";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { TimeSelect } from "@/components/ui/time-select";
import { ARRIVAL_WINDOW_OPTIONS } from "@/lib/job-arrival-window";
import { jobModalClientArrivalPreview } from "@/lib/job-modal-schedule";

export type JobModalScheduleFieldKey =
  | "scheduled_date"
  | "arrival_from"
  | "arrival_window_mins"
  | "expected_finish_date";

type Props = {
  scheduledDate: string;
  arrivalFrom: string;
  arrivalWindowMins: string;
  expectedFinishDate: string;
  onChange: (field: JobModalScheduleFieldKey, value: string) => void;
  /** e.g. quote pre-fill hint under start date */
  startDateFooter?: ReactNode;
  startDateRequired?: boolean;
  requiredFieldClassName?: string;
};

export function JobModalScheduleFields({
  scheduledDate,
  arrivalFrom,
  arrivalWindowMins,
  expectedFinishDate,
  onChange,
  startDateFooter,
  startDateRequired,
  requiredFieldClassName,
}: Props) {
  const preview = jobModalClientArrivalPreview(scheduledDate, arrivalFrom, arrivalWindowMins);
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">
            Start date{startDateRequired ? " *" : ""}
          </label>
          <Input
            type="date"
            value={scheduledDate}
            onChange={(e) => onChange("scheduled_date", e.target.value)}
            className={`h-10 max-w-[200px] ${requiredFieldClassName ?? ""}`.trim()}
          />
          {startDateFooter ? <div className="mt-1">{startDateFooter}</div> : null}
        </div>
        <TimeSelect
          label="Arrival time (from)"
          value={arrivalFrom}
          onChange={(v) => onChange("arrival_from", v)}
          className={requiredFieldClassName}
        />
        <Select
          label="Arrival window length"
          value={arrivalWindowMins}
          onChange={(e) => onChange("arrival_window_mins", e.target.value)}
          options={[...ARRIVAL_WINDOW_OPTIONS]}
        />
        <div>
          <label className="block text-xs font-medium text-text-secondary mb-1.5">Expected finish (date only)</label>
          <Input
            type="date"
            value={expectedFinishDate}
            onChange={(e) => onChange("expected_finish_date", e.target.value)}
            className="h-10 max-w-[200px]"
          />
        </div>
      </div>
      {preview ? <p className="text-[11px] font-medium text-text-secondary">{preview}</p> : null}
      <p className="text-[10px] text-text-tertiary -mt-1">
        Window end = start time + length (often 2–3 hours). That range is what clients and partners see as arrival time. Expected finish is calendar-only (no time); late is still based on window end.
      </p>
    </>
  );
}
