"use client";

import { useMemo, useState } from "react";
import {
  splitBidNotes,
  type PartnerBidProposalPayload,
  validatePartnerBidPayload,
} from "@/lib/quote-bid-payload";
import { normalizeCalendarDateToYmd } from "@/lib/utils";

export type PublicBidExistingBid = {
  amount: number;
  jobType: "fixed" | "hourly";
  notes: string | null;
  payload: PartnerBidProposalPayload | null;
};

interface PublicBidFormProps {
  token: string;
  quoteReference: string;
  quoteTitle: string;
  propertyAddress: string | null;
  scope: string | null;
  partnerName: string | null;
  existingBid: PublicBidExistingBid | null;
  onSubmitted: (msg: string) => void;
}

function numStr(v: number | undefined | null): string {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return String(v);
}

function initFromExisting(existing: PublicBidExistingBid | null) {
  const split = splitBidNotes(existing?.notes ?? null);
  const p = split.payload ?? existing?.payload ?? null;
  return {
    labourPricing: (p?.labour_pricing === "hourly" ? "hourly" : "fixed") as "fixed" | "hourly",
    labourCost: numStr(p?.labour_cost),
    labourHours: numStr(p?.labour_hours),
    labourRate: numStr(p?.labour_rate),
    materialsPricing: (p?.materials_pricing === "bulk" ? "bulk" : "unit") as "unit" | "bulk",
    materialsCost: numStr(p?.materials_cost),
    labourDescription: p?.labour_description ?? "",
    materialsDescription: p?.materials_description ?? "",
    startDate1: normalizeCalendarDateToYmd(p?.start_date_option_1) || "",
    startDate2: normalizeCalendarDateToYmd(p?.start_date_option_2) || "",
    notes: split.freeform,
  };
}

export default function PublicBidForm({
  token,
  quoteReference,
  quoteTitle,
  propertyAddress,
  scope,
  partnerName,
  existingBid,
  onSubmitted,
}: PublicBidFormProps) {
  const initial = initFromExisting(existingBid);
  const [labourPricing, setLabourPricing] = useState<"fixed" | "hourly">(initial.labourPricing);
  const [labourCost, setLabourCost] = useState(initial.labourCost);
  const [labourHours, setLabourHours] = useState(initial.labourHours);
  const [labourRate, setLabourRate] = useState(initial.labourRate);
  const [materialsPricing, setMaterialsPricing] = useState<"unit" | "bulk">(initial.materialsPricing);
  const [materialsCost, setMaterialsCost] = useState(initial.materialsCost);
  const [labourDescription, setLabourDescription] = useState(initial.labourDescription);
  const [materialsDescription, setMaterialsDescription] = useState(initial.materialsDescription);
  const [startDate1, setStartDate1] = useState(initial.startDate1);
  const [startDate2, setStartDate2] = useState(initial.startDate2);
  const [notes, setNotes] = useState(initial.notes);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const computedLabourCost = useMemo(() => {
    if (labourPricing === "hourly") {
      const h = Number(labourHours);
      const r = Number(labourRate);
      if (Number.isFinite(h) && h > 0 && Number.isFinite(r) && r > 0) {
        return Math.round(h * r * 100) / 100;
      }
      return 0;
    }
    const n = Number(labourCost);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [labourPricing, labourCost, labourHours, labourRate]);

  const computedMaterialsCost = useMemo(() => {
    const n = Number(materialsCost);
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }, [materialsCost]);

  const bidTotal = useMemo(
    () => Math.round((computedLabourCost + computedMaterialsCost) * 100) / 100,
    [computedLabourCost, computedMaterialsCost],
  );

  const buildPayload = (): PartnerBidProposalPayload => ({
    labour_cost: computedLabourCost,
    materials_cost: computedMaterialsCost,
    labour_pricing: labourPricing,
    ...(labourPricing === "hourly"
      ? { labour_hours: Number(labourHours) || undefined, labour_rate: Number(labourRate) || undefined }
      : {}),
    materials_pricing: materialsPricing,
    labour_description: labourDescription.trim() || undefined,
    materials_description: materialsDescription.trim() || undefined,
    start_date_option_1: startDate1,
    start_date_option_2: startDate2,
  });

  const submit = async () => {
    setError(null);
    const payload = buildPayload();
    const validation = validatePartnerBidPayload(payload, bidTotal);
    if (!validation.ok) {
      setError(validation.errors.join(" "));
      return;
    }
    if (bidTotal <= 0) {
      setError("Total bid must be greater than zero.");
      return;
    }
    setSubmitting(true);
    try {
      const res = await fetch("/api/quotes/submit-bid", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          token,
          bidAmount: bidTotal,
          jobType: labourPricing === "hourly" ? "hourly" : "fixed",
          payload: validation.payload,
          notes: notes.trim() || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string; errors?: string[] } | null;
      if (!res.ok) {
        setError(body?.error ?? body?.errors?.join(" ") ?? "Could not submit the bid.");
        return;
      }
      onSubmitted(existingBid ? "Bid updated. Thank you." : "Bid submitted. Thank you.");
    } finally {
      setSubmitting(false);
    }
  };

  const inputClass = "w-full rounded-md border border-[#D8D8DD] px-3 py-2 text-[14px]";
  const labelClass = "block text-[13px] font-medium text-[#020040]";
  const sectionTitle = "text-[11px] font-semibold uppercase tracking-wide text-[#6B6B70]";

  return (
    <div className="space-y-5">
      <header className="space-y-1 pb-2 border-b border-[#E4E4E8]">
        <p className="text-[11px] uppercase tracking-wide text-[#6B6B70]">Submit bid</p>
        <h2 className="text-[20px] font-semibold text-[#020040]">{quoteTitle}</h2>
        <p className="text-[12px] text-[#6B6B70]">
          {propertyAddress ?? ""} · {quoteReference}
        </p>
        {partnerName ? (
          <p className="text-[11px] text-[#6B6B70]">
            Bidding as <strong>{partnerName}</strong>
          </p>
        ) : null}
      </header>

      <div className="rounded-md bg-[#F7F7FB] border border-[#E4E4EC] px-3 py-2 text-[12px] text-[#3A3A55]">
        All fields marked required must be completed — labour, materials (can be £0), and two different start dates.
      </div>

      {scope?.trim() ? (
        <section className="rounded-md bg-[#F7F7FB] border border-[#E4E4EC] p-3">
          <p className="text-[10px] uppercase tracking-wide text-[#6B6B70] mb-1">Scope</p>
          <p className="text-[13px] text-[#3A3A55] whitespace-pre-wrap">{scope.trim()}</p>
        </section>
      ) : null}

      {existingBid ? (
        <div className="rounded-md bg-[#FFF8F3] border border-[#F5CFB8] px-3 py-2 text-[12px] text-[#7A3D00]">
          You previously bid £{existingBid.amount.toFixed(2)}. Update your figures below.
        </div>
      ) : null}

      <section className="space-y-4">
        <div className="space-y-3">
          <p className={sectionTitle}>Labour (required)</p>
          <div className="flex gap-2">
            {(["fixed", "hourly"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setLabourPricing(mode)}
                className="px-3 py-1.5 rounded-md text-[13px] font-medium border"
                style={
                  labourPricing === mode
                    ? { background: "#020040", color: "#fff", borderColor: "#020040" }
                    : { background: "#fff", color: "#020040", borderColor: "#D8D8DD" }
                }
              >
                {mode === "fixed" ? "Fixed" : "Hourly"}
              </button>
            ))}
          </div>
          {labourPricing === "fixed" ? (
            <div className="space-y-1">
              <label className={labelClass}>Labour cost (GBP)</label>
              <input
                type="number"
                min={0}
                step={0.01}
                value={labourCost}
                onChange={(e) => setLabourCost(e.target.value)}
                placeholder="e.g. 650"
                className={inputClass}
              />
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <label className={labelClass}>Hours</label>
                <input
                  type="number"
                  min={0}
                  step={0.25}
                  value={labourHours}
                  onChange={(e) => setLabourHours(e.target.value)}
                  className={inputClass}
                />
              </div>
              <div className="space-y-1">
                <label className={labelClass}>Rate (£/hr)</label>
                <input
                  type="number"
                  min={0}
                  step={0.01}
                  value={labourRate}
                  onChange={(e) => setLabourRate(e.target.value)}
                  className={inputClass}
                />
              </div>
            </div>
          )}
          <div className="space-y-1">
            <label className={labelClass}>Labour description (optional)</label>
            <input
              type="text"
              value={labourDescription}
              onChange={(e) => setLabourDescription(e.target.value)}
              placeholder="e.g. Two decorators, prep and two coats"
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-[#E4E4E8] pt-4">
          <p className={sectionTitle}>Materials (required)</p>
          <div className="flex gap-2">
            {(["unit", "bulk"] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                onClick={() => setMaterialsPricing(mode)}
                className="px-3 py-1.5 rounded-md text-[13px] font-medium border"
                style={
                  materialsPricing === mode
                    ? { background: "#020040", color: "#fff", borderColor: "#020040" }
                    : { background: "#fff", color: "#020040", borderColor: "#D8D8DD" }
                }
              >
                {mode === "unit" ? "Per unit" : "Bulk"}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Materials cost (GBP) — enter 0 if none</label>
            <input
              type="number"
              min={0}
              step={0.01}
              value={materialsCost}
              onChange={(e) => setMaterialsCost(e.target.value)}
              placeholder="e.g. 120 or 0"
              className={inputClass}
            />
          </div>
          <div className="space-y-1">
            <label className={labelClass}>Materials description (optional)</label>
            <input
              type="text"
              value={materialsDescription}
              onChange={(e) => setMaterialsDescription(e.target.value)}
              placeholder="e.g. Paint, filler, masking tape"
              className={inputClass}
            />
          </div>
        </div>

        <div className="space-y-3 border-t border-[#E4E4E8] pt-4">
          <p className={sectionTitle}>Available start dates (required)</p>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1">
              <label className={labelClass}>Option 1</label>
              <input
                type="date"
                value={startDate1}
                onChange={(e) => setStartDate1(e.target.value)}
                className={inputClass}
              />
            </div>
            <div className="space-y-1">
              <label className={labelClass}>Option 2</label>
              <input
                type="date"
                value={startDate2}
                onChange={(e) => setStartDate2(e.target.value)}
                className={inputClass}
              />
            </div>
          </div>
        </div>

        <div className="rounded-md bg-[#F0F4FF] border border-[#D8DDF5] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-wide text-[#6B6B70]">Your bid total</p>
          <p className="text-[22px] font-bold text-[#020040] tabular-nums">£{bidTotal.toFixed(2)}</p>
          <p className="text-[11px] text-[#6B6B70] mt-0.5">
            Labour £{computedLabourCost.toFixed(2)} + Materials £{computedMaterialsCost.toFixed(2)}
          </p>
        </div>

        <div className="space-y-1">
          <label className={labelClass}>Additional notes (optional)</label>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={3}
            placeholder="Access restrictions, assumptions, etc."
            className={inputClass}
          />
        </div>
      </section>

      {error ? (
        <div className="rounded-md bg-[#FFF1EB] border border-[#F5CFB8] p-3 text-[12px] text-[#7A3D00]">
          {error}
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting}
        className="w-full inline-flex items-center justify-center gap-2 rounded-md px-4 py-3 text-[14px] font-semibold disabled:opacity-50"
        style={{ background: "#020040", color: "#fff" }}
      >
        {submitting ? "Submitting…" : existingBid ? "Update bid" : "Submit bid"}
      </button>
    </div>
  );
}
