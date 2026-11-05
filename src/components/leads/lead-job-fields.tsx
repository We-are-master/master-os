"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { updateLeadJobFields, type LeadJobFields } from "@/services/crm-leads";
import type { JobKind, Lead } from "@/types/database";

type Form = {
  preferred_date: string;
  preferred_window: string;
  in_ccz: "" | "yes" | "no";
  has_free_parking: "" | "yes" | "no";
  job_kind: "" | JobKind;
  price_mode: "" | NonNullable<Lead["price_mode"]>;
  price_given: string;
};

const yn = (v: boolean | null | undefined): Form["in_ccz"] => (v == null ? "" : v ? "yes" : "no");
const toBool = (v: Form["in_ccz"]) => (v === "" ? null : v === "yes");

function fromLead(l: Lead): Form {
  return {
    preferred_date: l.preferred_date ?? "",
    preferred_window: l.preferred_window ?? "",
    in_ccz: yn(l.in_ccz),
    has_free_parking: yn(l.has_free_parking),
    job_kind: (l.job_kind ?? "") as Form["job_kind"],
    price_mode: (l.price_mode ?? "") as Form["price_mode"],
    price_given: l.price_given != null ? String(l.price_given) : "",
  };
}

const YES_NO = [
  { value: "", label: "Not asked" },
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

/** Dados que o job precisa e o lead ainda não tinha (data, janela, CCZ, preço dado). */
export function LeadJobFieldsEditor({ lead, hasQuote, onSaved }: { lead: Lead; hasQuote: boolean; onSaved: (l: Lead) => void }) {
  const [f, setF] = useState<Form>(() => fromLead(lead));
  const [saving, setSaving] = useState(false);
  useEffect(() => setF(fromLead(lead)), [lead]);

  const dirty = JSON.stringify(f) !== JSON.stringify(fromLead(lead));

  const save = async () => {
    const price = f.price_given.trim() ? Number(f.price_given) : null;
    if (price != null && (!Number.isFinite(price) || price < 0)) return toast.error("Price given must be a positive number");
    const patch: LeadJobFields = {
      preferred_date: f.preferred_date || null,
      preferred_window: f.preferred_window,
      in_ccz: toBool(f.in_ccz),
      has_free_parking: toBool(f.has_free_parking),
      job_kind: f.job_kind || null,
      price_mode: f.price_mode || null,
      price_given: price,
    };
    setSaving(true);
    try {
      const updated = await updateLeadJobFields(lead.id, patch);
      toast.success("Job details saved");
      onSaved(updated);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not save job details");
    } finally {
      setSaving(false);
    }
  };

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setF((x) => ({ ...x, [k]: v }));

  return (
    <div className="rounded-xl border border-border-light p-3 space-y-3">
      <p className="text-xs font-semibold text-text-secondary uppercase tracking-wide">Job details</p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Preferred date">
          <Input type="date" value={f.preferred_date} onChange={(e) => set("preferred_date", e.target.value)} />
        </Field>
        <Field label="Arrival window">
          <Input value={f.preferred_window} onChange={(e) => set("preferred_window", e.target.value)} placeholder="08:00 to 10:00" />
        </Field>
        <Field label="In the CCZ">
          <Select value={f.in_ccz} onChange={(e) => set("in_ccz", e.target.value as Form["in_ccz"])} options={YES_NO} />
        </Field>
        <Field label="Free parking">
          <Select value={f.has_free_parking} onChange={(e) => set("has_free_parking", e.target.value as Form["has_free_parking"])} options={YES_NO} />
        </Field>
        <Field label="Job kind">
          <Select
            value={f.job_kind}
            onChange={(e) => set("job_kind", e.target.value as Form["job_kind"])}
            options={[
              { value: "", label: "Not set" },
              { value: "one_off", label: "One-off" },
              { value: "multi_day", label: "Multi-day" },
              { value: "recurring", label: "Recurring" },
            ]}
          />
        </Field>
        <Field label="Pricing">
          <Select
            value={f.price_mode}
            onChange={(e) => set("price_mode", e.target.value as Form["price_mode"])}
            options={[
              { value: "", label: "Not set" },
              { value: "fixed", label: "Fixed" },
              { value: "hourly", label: "Hourly" },
              { value: "half_day", label: "Half day" },
              { value: "daily", label: "Daily" },
            ]}
          />
        </Field>
        <Field label={hasQuote ? "Price given (the quote wins)" : "Price given in the chat (£)"}>
          <Input
            type="number"
            inputMode="decimal"
            min={0}
            step="0.01"
            value={f.price_given}
            onChange={(e) => set("price_given", e.target.value)}
            placeholder="180"
          />
        </Field>
      </div>
      <div className="flex justify-end">
        <Button size="sm" variant={dirty ? "primary" : "secondary"} onClick={save} disabled={saving || !dirty}>
          {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save job details"}
        </Button>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="text-xs font-medium text-text-secondary mb-1.5 block">{label}</label>
      {children}
    </div>
  );
}
