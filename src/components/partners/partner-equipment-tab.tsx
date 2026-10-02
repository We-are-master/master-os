"use client";

import { useState } from "react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { updatePartner } from "@/services/partners";
import type { Partner } from "@/types/database";

type Field = "has_own_tools" | "can_supply_materials";

const QUESTIONS: { field: Field; label: string; hint: string }[] = [
  {
    field: "has_own_tools",
    label: "Own tools & equipment",
    hint: "Turns up with everything the trade needs.",
  },
  {
    field: "can_supply_materials",
    label: "Can supply materials",
    hint: "Can buy what the job needs (reimbursed on the report).",
  },
];

/** One line for the drawer header: what the partner answered at onboarding. */
export function formatPartnerEquipmentSummary(partner: Pick<Partner, Field>): string {
  const tools = partner.has_own_tools;
  const materials = partner.can_supply_materials;
  if (tools == null && materials == null) return "Not answered yet";
  const part = (v: boolean | null | undefined, yes: string, no: string) =>
    v == null ? null : v ? yes : no;
  return [
    part(tools, "Own tools", "No own tools"),
    part(materials, "Supplies materials", "Doesn't supply materials"),
  ]
    .filter(Boolean)
    .join(" · ");
}

/**
 * The two answers from the Tools & materials step of /get-started (trade portal).
 * Both are required there; partners who joined before the step show "Not answered".
 */
export function PartnerEquipmentTab({
  partner,
  onPartnerUpdate,
  canEdit = true,
}: {
  partner: Partner;
  onPartnerUpdate: (p: Partner) => void;
  canEdit?: boolean;
}) {
  const [saving, setSaving] = useState<Field | null>(null);

  const setAnswer = async (field: Field, value: boolean) => {
    if (!canEdit || partner[field] === value) return;
    setSaving(field);
    try {
      const updated = await updatePartner(partner.id, { [field]: value });
      onPartnerUpdate(updated);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Couldn't save.");
    } finally {
      setSaving(null);
    }
  };

  return (
    <div className="space-y-3">
      {QUESTIONS.map((q) => {
        const value = partner[q.field];
        return (
          <div key={q.field} className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="text-sm font-medium text-text-primary">{q.label}</p>
              <p className="text-xs text-text-tertiary">
                {value == null ? "Not answered at onboarding" : q.hint}
              </p>
            </div>
            <div className="flex shrink-0 overflow-hidden rounded-lg border border-border-light">
              {([true, false] as const).map((opt) => (
                <button
                  key={String(opt)}
                  type="button"
                  disabled={!canEdit || saving === q.field}
                  onClick={() => void setAnswer(q.field, opt)}
                  className={cn(
                    "min-w-12 px-3 py-1.5 text-xs font-semibold transition-colors disabled:cursor-default",
                    value === opt
                      ? opt
                        ? "bg-emerald-600 text-white"
                        : "bg-red-600 text-white"
                      : "bg-card text-text-secondary hover:bg-surface-hover",
                  )}
                >
                  {opt ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}
