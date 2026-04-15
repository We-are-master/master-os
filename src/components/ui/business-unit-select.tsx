"use client";

import { useEffect, useState } from "react";
import { listBusinessUnits } from "@/services/teams";
import { cn } from "@/lib/utils";
import type { BusinessUnit } from "@/types/database";

interface BusinessUnitSelectProps {
  value: string | null;
  onChange: (id: string | null) => void;
  placeholder?: string;
  includeAllOption?: boolean;
  allOptionLabel?: string;
  className?: string;
  disabled?: boolean;
}

/**
 * Reusable Business Unit picker. Loads BUs once per mount.
 *
 * Use `includeAllOption={true}` for filter contexts (shows "All BUs");
 * omit it for edit contexts (shows "— no BU —" as the first option).
 */
export function BusinessUnitSelect({
  value,
  onChange,
  placeholder = "Select BU...",
  includeAllOption = false,
  allOptionLabel = "All Business Units",
  className,
  disabled,
}: BusinessUnitSelectProps) {
  const [bus, setBus] = useState<BusinessUnit[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    listBusinessUnits()
      .then((rows) => {
        if (!cancelled) setBus(rows);
      })
      .catch((err) => console.error("[BusinessUnitSelect] load error:", err))
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <select
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value || null)}
      disabled={disabled || loading}
      className={cn(
        "h-9 px-2.5 text-sm rounded-lg border border-[var(--input-border)] bg-[var(--input-bg)] focus:outline-none focus:ring-2 focus:ring-primary/15 focus:border-primary/30 disabled:opacity-50",
        className,
      )}
    >
      <option value="">
        {includeAllOption ? allOptionLabel : placeholder}
      </option>
      {bus.map((bu) => (
        <option key={bu.id} value={bu.id}>
          {bu.name}
        </option>
      ))}
    </select>
  );
}
