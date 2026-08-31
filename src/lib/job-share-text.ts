/**
 * O resumo do job que se cola no WhatsApp quando alguém pergunta "e esse job?".
 *
 * Nasceu do hover da lista de Jobs (dono, 30/08): em vez de digitar as infos
 * de novo a cada pergunta, um clique copia o bloco pronto. Duas regras de
 * casa moram aqui de propósito:
 *
 *   - O valor é o PAY DO PARCEIRO, com o rótulo do acordo na frente ("Fixed ·
 *     £57.30", "Hourly · £45.00/hr"). Quem pergunta de job no WhatsApp é
 *     parceiro — mostrar o preço do cliente vazaria a margem.
 *   - Localização é SÓ o postcode. Endereço completo é de quem aceitou o job,
 *     não de quem está sondando.
 *
 * Os asteriscos são negrito do WhatsApp, o destino declarado do texto.
 */
import type { Job } from "@/types/database";
import { formatPartnerJobPriceDisplay } from "@/lib/job-pricing-resolver";
import { normalizeTypeOfWork } from "@/lib/type-of-work";

/** Último token com cara de postcode UK; null quando o endereço não tem. */
export function postcodeFromAddress(address: string | null | undefined): string | null {
  const m = /([A-Z]{1,2}\d[A-Z\d]?\s*\d[A-Z]{2})\s*,?\s*$/i.exec(String(address ?? "").trim());
  return m ? m[1].toUpperCase().replace(/\s+/g, " ") : null;
}

function londonDateLabel(ymd: string | null | undefined): string | null {
  const t = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, mo, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, mo - 1, d, 12));
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "short", day: "numeric", month: "short", timeZone: "UTC",
  }).format(dt);
}

function londonTime(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    hour: "numeric", minute: "2-digit", hour12: true, timeZone: "Europe/London",
  }).format(d).toUpperCase().replace(/\s/g, "");
}

export function buildJobShareText(job: Job): string {
  const linhas: string[] = [];
  const tow = normalizeTypeOfWork(job.title ?? "") || job.title?.trim() || "Job";
  linhas.push(`*Type of work:* ${tow}`);

  const pc = postcodeFromAddress(job.property_address);
  if (pc) linhas.push(`*Postcode:* ${pc}`);

  const data = londonDateLabel(job.scheduled_date);
  const ini = londonTime(job.scheduled_start_at);
  const fim = londonTime(job.scheduled_end_at);
  const janela = ini ? ` · Arrival ${ini}${fim ? `–${fim}` : ""}` : "";
  linhas.push(`*Date:* ${data ? `${data}${janela}` : "To be confirmed"}`);

  linhas.push(
    `*Pay:* ${formatPartnerJobPriceDisplay(
      job.job_type ?? null,
      job.hourly_partner_rate,
      job.partner_cost,
      null,
      job.rate_basis ?? null,
    )}`,
  );

  const scope = String(job.scope ?? "").trim();
  if (scope) linhas.push(`*Scope:*\n${scope}`);

  return linhas.join("\n");
}
