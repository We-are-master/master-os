"use client";

import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import type { CatalogService } from "@/types/database";

type Props = {
  label?: string;
  catalog: CatalogService[];
  value: string;
  onChange: (catalogId: string, service: CatalogService | null) => void;
  disabled?: boolean;
};

export function ServiceCatalogSelect({
  label = "From catalog (optional)",
  catalog,
  value,
  onChange,
  disabled,
}: Props) {
  return (
    <Select
      label={label}
      value={value}
      disabled={disabled}
      onChange={(e) => {
        const id = e.target.value;
        const svc = id ? catalog.find((c) => c.id === id) ?? null : null;
        onChange(id, svc);
      }}
      options={[
        { value: "", label: "— Custom only (no template) —" },
        ...catalog.map((c) => ({
          value: c.id,
          label: `${c.name} — ${
            c.pricing_mode === "fixed"
              ? formatCurrency(c.fixed_price)
              : `${formatCurrency(c.hourly_rate)}/h × ${Number(c.default_hours) || 1}h`
          }`,
        })),
      ]}
    />
  );
}
