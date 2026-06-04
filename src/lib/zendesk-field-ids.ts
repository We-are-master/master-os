import type { FrontendSetup } from "@/lib/frontend-setup";
import {
  ZENDESK_CANCELLATION_NOTES_FIELD_ID,
  ZENDESK_CANCELLATION_REASON_FIELD_ID,
  ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID,
  ZENDESK_COMPLAINT_SOLUTION_FIELD_ID,
  ZENDESK_ON_HOLD_REASON_FIELD_ID,
} from "@/lib/zendesk";

export type ZendeskComplaintFieldIds = {
  onHoldReasonFieldId: number;
  complaintDescriptionFieldId: number;
  complaintSolutionFieldId: number;
};

export type ZendeskCancellationFieldIds = {
  cancellationReasonFieldId: number;
  cancellationNotesFieldId: number;
};

function positiveFieldId(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
}

/** Settings → Setup overrides env for complaint / on-hold Zendesk ticket fields. */
export function resolveZendeskComplaintFieldIds(setup?: FrontendSetup | null): ZendeskComplaintFieldIds {
  return {
    onHoldReasonFieldId:
      positiveFieldId(setup?.zendesk_on_hold_reason_field_id) ?? ZENDESK_ON_HOLD_REASON_FIELD_ID,
    complaintDescriptionFieldId:
      positiveFieldId(setup?.zendesk_complaint_description_field_id)
      ?? ZENDESK_COMPLAINT_DESCRIPTION_FIELD_ID,
    complaintSolutionFieldId:
      positiveFieldId(setup?.zendesk_complaint_solution_field_id) ?? ZENDESK_COMPLAINT_SOLUTION_FIELD_ID,
  };
}

export function zendeskOnHoldReasonFieldConfigured(setup?: FrontendSetup | null): boolean {
  return resolveZendeskComplaintFieldIds(setup).onHoldReasonFieldId > 0;
}

export function resolveZendeskCancellationFieldIds(setup?: FrontendSetup | null): ZendeskCancellationFieldIds {
  return {
    cancellationReasonFieldId:
      positiveFieldId(setup?.zendesk_cancellation_reason_field_id) ?? ZENDESK_CANCELLATION_REASON_FIELD_ID,
    cancellationNotesFieldId:
      positiveFieldId(setup?.zendesk_cancellation_notes_field_id) ?? ZENDESK_CANCELLATION_NOTES_FIELD_ID,
  };
}

export function zendeskCancellationReasonFieldConfigured(setup?: FrontendSetup | null): boolean {
  return resolveZendeskCancellationFieldIds(setup).cancellationReasonFieldId > 0;
}
