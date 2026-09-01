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

/* ------------------------------------------------------------------ */
/* Rota de vários jobs (seleção em lote na lista de Jobs)              */
/* ------------------------------------------------------------------ */

/**
 * A REGRA DE ENDEREÇO INVERTE AQUI, DE PROPÓSITO: o resumo de um job
 * (acima) é para parceiro SONDANDO, então só postcode. A rota em lote é o
 * briefing do dia de quem já ACEITOU os jobs — endereço completo é devido.
 * O guarda continua automático: job ainda SEM parceiro entra na mensagem
 * (e no link do Maps compartilhado) só com o postcode.
 *
 * Dinheiro nunca entra na mensagem de rota: rota + type of work + scope.
 */

function jobHasPartner(job: Job): boolean {
  const j = job as { partner_id?: string | null; partner_name?: string | null };
  return Boolean(j.partner_id || (j.partner_name && j.partner_name.trim()));
}

/** Ordena paradas como se dirige: início agendado, depois data, depois referência. */
export function sortJobsForRoute(jobs: Job[]): Job[] {
  const key = (j: Job): string =>
    `${String(j.scheduled_date ?? "9999-99-99").slice(0, 10)}T${String(j.scheduled_start_at ?? "z")}`;
  return [...jobs].sort((a, b) => key(a).localeCompare(key(b)));
}

/**
 * Ponto de uma parada para o Google Maps.
 * `precise` = uso próprio (botão Route): melhor precisão sempre.
 * Sem `precise` (mensagem compartilhada): precisão total só com parceiro no job.
 */
function jobRoutePoint(job: Job, precise: boolean): string | null {
  if (precise || jobHasPartner(job)) {
    // Number(null) === 0: um lat/lng nulo viraria "0,0" no meio do Atlântico.
    const lat = job.latitude == null ? NaN : Number(job.latitude);
    const lng = job.longitude == null ? NaN : Number(job.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lng)) return `${lat.toFixed(6)},${lng.toFixed(6)}`;
    const addr = String(job.property_address ?? "").trim();
    if (addr) return addr;
  }
  return postcodeFromAddress(job.property_address);
}

/** Link de direções do Google Maps com as paradas na ordem da rota. */
export function buildJobsRouteMapsUrl(
  jobs: Job[],
  opts?: { precise?: boolean },
): string | null {
  const precise = opts?.precise === true;
  const points = sortJobsForRoute(jobs)
    .map((j) => jobRoutePoint(j, precise))
    .filter((p): p is string => p != null);
  if (points.length === 0) return null;

  const destination = points[points.length - 1]!;
  const waypoints = points.slice(0, -1);
  const params = new URLSearchParams({ api: "1", travelmode: "driving", destination });
  if (waypoints.length > 0) params.set("waypoints", waypoints.join("|"));
  return `https://www.google.com/maps/dir/?${params.toString()}`;
}

/** Uma mensagem de WhatsApp só: rota (link do Maps) + type of work + scope de cada parada. */
export function buildJobsRouteShareText(jobs: Job[]): string {
  const stops = sortJobsForRoute(jobs);
  const dates = new Set(
    stops.map((j) => String(j.scheduled_date ?? "").slice(0, 10)).filter(Boolean),
  );
  const sameDay = dates.size === 1 ? londonDateLabel([...dates][0]) : null;

  const linhas: string[] = [];
  linhas.push(`*Route · ${stops.length} stops${sameDay ? ` · ${sameDay}` : ""}*`);
  const mapsUrl = buildJobsRouteMapsUrl(stops);
  if (mapsUrl) linhas.push(`Open route: ${mapsUrl}`);

  stops.forEach((job, i) => {
    linhas.push("");
    const tow = normalizeTypeOfWork(job.title ?? "") || job.title?.trim() || "Job";
    linhas.push(`*${i + 1}) ${tow}*`);

    const partes: string[] = [];
    if (!sameDay) {
      const d = londonDateLabel(job.scheduled_date);
      if (d) partes.push(d);
    }
    const ini = londonTime(job.scheduled_start_at);
    const fim = londonTime(job.scheduled_end_at);
    if (ini) partes.push(`Arrival ${ini}${fim ? `–${fim}` : ""}`);
    if (partes.length > 0) linhas.push(partes.join(" · "));

    const endereco = jobHasPartner(job)
      ? String(job.property_address ?? "").trim() || postcodeFromAddress(job.property_address)
      : postcodeFromAddress(job.property_address);
    if (endereco) linhas.push(endereco);

    const scope = String(job.scope ?? "").trim();
    if (scope) linhas.push(`Scope:\n${scope}`);
  });

  return linhas.join("\n");
}
