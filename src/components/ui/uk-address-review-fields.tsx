"use client";

import { Input } from "@/components/ui/input";
import type { AddressParts } from "@/components/ui/address-autocomplete";

/** Editable UK-style breakdown after a postcode / address API lookup (e.g. Mapbox). */
export type UkAddressFormState = {
  flat: string;
  street: string;
  city: string;
  postcode: string;
};

export function emptyUkAddressForm(): UkAddressFormState {
  return { flat: "", street: "", city: "", postcode: "" };
}

export function addressPartsToFormState(parts: AddressParts): UkAddressFormState {
  return {
    flat: "",
    street: (parts.address || "").trim(),
    city: (parts.city || "").trim(),
    postcode: (parts.postcode || "").trim(),
  };
}

/** Single line for jobs / quotes (flat + street + town + postcode). */
export function previewUkAddressLine(form: UkAddressFormState): string {
  const line1 = [form.flat.trim(), form.street.trim()].filter(Boolean).join(", ");
  return [line1, form.city.trim(), form.postcode.trim()].filter(Boolean).join(", ");
}

/**
 * Merge manual flat/unit with street for DB `address` column; refresh `full_address` for display.
 */
export function formStateToAddressParts(form: UkAddressFormState, mapboxFullFallback: string): AddressParts {
  const flat = form.flat.trim();
  const street = form.street.trim();
  const city = form.city.trim();
  const pc = form.postcode.trim();
  const line1 = flat && street ? `${flat}, ${street}` : flat || street;
  const full = [line1, city, pc].filter(Boolean).join(", ");
  return {
    full_address: full || mapboxFullFallback.trim(),
    address: line1 || street || mapboxFullFallback.trim(),
    city,
    postcode: pc,
    country: "gb",
  };
}

export function UkAddressReviewFields({
  value,
  onChange,
  disabled,
}: {
  value: UkAddressFormState;
  onChange: (next: UkAddressFormState) => void;
  disabled?: boolean;
}) {
  const patch = (partial: Partial<UkAddressFormState>) => onChange({ ...value, ...partial });
  const preview = previewUkAddressLine(value);

  return (
    <div className="space-y-3 rounded-xl border border-border bg-surface-hover/60 p-3 mt-2">
      <p className="text-[11px] font-medium text-text-secondary">
        Complete UK address (Mapbox may omit flat / unit — add anything missing, then save)
      </p>
      <div>
        <label className="block text-[10px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Flat / unit / building (optional)</label>
        <Input
          placeholder="e.g. Flat 12, Building A"
          value={value.flat}
          onChange={(e) => patch({ flat: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div>
        <label className="block text-[10px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Street & number *</label>
        <Input
          placeholder="e.g. 15 High Street"
          value={value.street}
          onChange={(e) => patch({ street: e.target.value })}
          disabled={disabled}
        />
      </div>
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="block text-[10px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Town / city</label>
          <Input
            placeholder="London"
            value={value.city}
            onChange={(e) => patch({ city: e.target.value })}
            disabled={disabled}
          />
        </div>
        <div>
          <label className="block text-[10px] font-medium text-text-tertiary uppercase tracking-wide mb-1">Postcode</label>
          <Input
            placeholder="SW1A 1AA"
            value={value.postcode}
            onChange={(e) => patch({ postcode: e.target.value })}
            disabled={disabled}
          />
        </div>
      </div>
      {preview ? (
        <p className="text-[11px] text-text-tertiary pt-1 border-t border-border-light">
          <span className="font-medium text-text-secondary">Preview: </span>
          {preview}
        </p>
      ) : null}
    </div>
  );
}
