import { extractUkPostcode } from "@/lib/uk-postcode";

/**
 * Subject for Zendesk tickets opened from Create Job / Create Quote ("No ticket").
 *
 * Sem postcode o assunto termina no serviço. Antes saía "Job Scheduled: Carpenter - —",
 * e o assunto vira o do e-mail ao cliente quando o solicitante passa a ser ele
 * (#51316 e #51317, 13/10/2026): travessão em texto de cliente, nunca.
 */
export function osZendeskCreateTicketSubject(
  entityType: "job" | "quote",
  typeOfWork: string | null | undefined,
  propertyAddress: string | null | undefined,
): string {
  const prefix = entityType === "quote" ? "Quote Request:" : "Job Scheduled:";
  const work = typeOfWork?.trim() || (entityType === "quote" ? "Quote" : "Job");
  const postcode = extractUkPostcode(propertyAddress ?? "");
  return postcode ? `${prefix} ${work} - ${postcode}` : `${prefix} ${work}`;
}
