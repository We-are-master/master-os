import { extractUkPostcode } from "@/lib/uk-postcode";

/** Subject for Zendesk tickets opened from Create Job / Create Quote ("No ticket"). */
export function osZendeskCreateTicketSubject(
  entityType: "job" | "quote",
  typeOfWork: string | null | undefined,
  propertyAddress: string | null | undefined,
): string {
  const prefix = entityType === "quote" ? "Quote Request:" : "Job Scheduled:";
  const work = typeOfWork?.trim() || (entityType === "quote" ? "Quote" : "Job");
  const postcode = extractUkPostcode(propertyAddress ?? "") || "—";
  return `${prefix} ${work} - ${postcode}`;
}
