"use client";

import { useId } from "react";
import { Check } from "lucide-react";

/**
 * Mandatory Zendesk-ticket-id input shown inside the Create Job / Create
 * Quote modals. Staff either:
 *  - paste the existing ticket id (default), or
 *  - tick "No ticket — create a new one" which tells the parent to call
 *    /api/zendesk/create-ticket-for-entity on submit and use the returned id.
 *
 * The field is mandatory in both states: the parent treats `noTicket: true`
 * as "I confirmed I want a new ticket created automatically".
 */
export interface ZendeskTicketFieldValue {
  ticketId: string;
  noTicket: boolean;
}

interface Props {
  value:    ZendeskTicketFieldValue;
  onChange: (next: ZendeskTicketFieldValue) => void;
  /** Optional override for the helper line under the checkbox. */
  helperText?: string;
  className?: string;
}

const REQUIRED_RING =
  "border-[#d9d5cf] focus:border-[#b8b2aa] focus:ring-[#ede9e3] hover:border-[#cfcac3]";

export function ZendeskTicketField({ value, onChange, helperText, className }: Props) {
  const checkboxId = useId();
  const inputId    = useId();

  const handleTicketChange = (raw: string) => {
    // Strip whitespace + "#" prefix and any non-digit/dash garbage Zendesk
    // sometimes wraps the id with when copy-pasted from the UI.
    const cleaned = raw.replace(/^[#\s]+/, "").trim();
    onChange({ ...value, ticketId: cleaned });
  };

  const toggleNoTicket = (checked: boolean) => {
    onChange({
      noTicket: checked,
      ticketId: checked ? "" : value.ticketId,
    });
  };

  return (
    <div className={className}>
      <label htmlFor={inputId} className="block text-xs font-medium text-text-secondary mb-1.5">
        Zendesk ticket ID <span className="text-red-500">*</span>
      </label>

      <input
        id={inputId}
        type="text"
        inputMode="numeric"
        value={value.ticketId}
        disabled={value.noTicket}
        onChange={(e) => handleTicketChange(e.target.value)}
        placeholder="e.g. 8472"
        className={`w-full rounded-lg border px-3 py-2 text-sm shadow-sm transition-colors ${REQUIRED_RING} focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:bg-surface-hover/40 disabled:text-text-tertiary`}
        aria-describedby={`${inputId}-help`}
      />

      <button
        type="button"
        onClick={() => toggleNoTicket(!value.noTicket)}
        className="mt-2 inline-flex items-start gap-2 text-xs text-text-secondary hover:text-text-primary group"
      >
        <span
          id={checkboxId}
          className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
            value.noTicket
              ? "border-primary bg-primary text-white"
              : "border-border bg-card group-hover:border-primary/50"
          }`}
          aria-checked={value.noTicket}
          role="checkbox"
          tabIndex={-1}
        >
          {value.noTicket && <Check className="h-3 w-3" strokeWidth={3} />}
        </span>
        <span className="leading-tight text-left">
          <span className="font-medium">No ticket — create a new one</span>
          <span className="block text-[11px] text-text-tertiary mt-0.5">
            {helperText ?? "A new Zendesk ticket will be opened with team@getfixfy.com as requester and a comment containing the work details."}
          </span>
        </span>
      </button>
    </div>
  );
}

/** True when the field has either a ticket id OR the "no ticket" checkbox set. */
export function isZendeskTicketFieldValid(v: ZendeskTicketFieldValue): boolean {
  if (v.noTicket) return true;
  return v.ticketId.trim().length > 0;
}
