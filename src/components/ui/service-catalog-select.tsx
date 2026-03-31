"use client";

import { Select } from "@/components/ui/select";
import { formatCurrency } from "@/lib/utils";
import { estimatedValueFromCatalog } from "@/lib/catalog-service-defaults";
import type { CatalogService } from "@/types/database";

type Props = {
  label?: string;
  /** First option when no catalog row is selected (default: optional custom / no template). */
  emptyOptionLabel?: string;
  catalog: CatalogService[];
  value: string;
  onChange: (catalogId: string, service: CatalogService | null) => void;
  disabled?: boolean;
  className?: string;
};

export function ServiceCatalogSelect({
  label = "From catalog (optional)",
  emptyOptionLabel = "— Custom only (no template) —",
  catalog,
  value,
  onChange,
  disabled,
  className,
}: Props) {
  return (
    <Select
      label={label}
      value={value}
      disabled={disabled}
      className={className}
      onChange={(e) => {
        const id = e.target.value;
        const svc = id ? catalog.find((c) => c.id === id) ?? null : null;
        onChange(id, svc);
      }}
      options={[
        { value: "", label: emptyOptionLabel },
        ...catalog.map((c) => ({
          value: c.id,
          label: `${c.name} — Sell: ${formatCurrency(estimatedValueFromCatalog(c))}${
            c.pricing_mode === "hourly"
              ? ` (${formatCurrency(c.hourly_rate)}/h × ${Number(c.default_hours) || 1}h)`
              : ""
          }`,
        })),
      ]}
    />
  );
}
