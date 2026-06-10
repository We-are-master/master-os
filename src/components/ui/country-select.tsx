"use client";

import { Select } from "@/components/ui/select";
import { countrySelectOptionsFor, resolveCountrySelectValue } from "@/lib/countries";
import { cn } from "@/lib/utils";

export const COUNTRY_WORK_HINT = "Which country are you working from?";

type CountrySelectProps = {
  value: string;
  onChange: (value: string) => void;
  label?: string;
  hint?: string | null;
  className?: string;
  required?: boolean;
};

export function CountrySelect({
  value,
  onChange,
  label,
  hint = COUNTRY_WORK_HINT,
  className,
  required,
}: CountrySelectProps) {
  const resolved = resolveCountrySelectValue(value);
  const options = countrySelectOptionsFor(value);

  return (
    <div className="w-full min-w-0">
      <Select
        label={label}
        value={resolved}
        onChange={(e) => onChange(e.target.value)}
        options={options}
        required={required}
        className={cn(className)}
      />
      {hint ? <p className="text-[11px] text-text-tertiary mt-1">{hint}</p> : null}
    </div>
  );
}
