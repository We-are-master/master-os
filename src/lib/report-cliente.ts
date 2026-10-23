/**
 * O que do report vai ao cliente, igual no PDF e no portal web (/report/[token]).
 *
 * Sai tudo que é interno: tempo no local, custo de material, horas cobráveis,
 * "No" de campo vazio e nota de bastidor (ticket, "from the partner").
 */
import { labelForReportField, type NormalizedReport } from "@/lib/job-report-v2";

const MESES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "12 Sep 2026" (o en-GB do Intl escreve "Sept"). */
export function dataCurta(d: Date | null | undefined): string | null {
  if (!d || Number.isNaN(d.getTime())) return null;
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", day: "numeric", month: "numeric", year: "numeric" }).formatToParts(d);
  const v = (t: string) => Number(p.find((x) => x.type === t)?.value);
  return `${v("day")} ${MESES[v("month") - 1]} ${v("year")}`;
}

/** Nota de bastidor (ticket, "from the partner") não é descrição para o cliente. */
function textoInterno(t: string): boolean {
  return /ticket\s*#?\d+|from the partner|zendesk|\bpartner\b/i.test(t);
}

function duracao(ms: number): string {
  const min = Math.round(ms / 60_000);
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

function titulo(v: string): string {
  return v.replace(/_/g, " ").replace(/\s+/g, " ").trim().replace(/^\w/, (c) => c.toUpperCase());
}

/** Nunca vai ao cliente: interno, custo nosso, ou já mostrado em outro lugar. */
const OCULTOS = new Set([
  "photos",
  // Tempo no local não vai para o cliente (dono, 22/10/2026).
  "duration_ms",
  "recommend_additional_services",
  "materials_extra_cost",
  "materials_receipt",
  "materials_bought",
  "additional_charges",
  "chargeable_hours",
  "photos_refused",
  "description",
  "completion_status",
  "job_complete",
  "all_tasks_done",
  "site_access_obtained",
  "customer_inspected",
]);

/** Rótulo para o cliente quando o do OS é técnico demais. */
const ROTULO_CLIENTE: Record<string, string> = {
  duration_ms: "Time on site",
  materials_extra_charge: "Materials",
  materials_by_visit: "Materials by visit",
  what_needs_completing: "Still to do",
  follow_up_required: "Follow-up visit",
  additional_charges_note: "Extra charges",
  pre_existing_damage: "Existing damage noted",
  access_issues_note: "Access",
  inspection_summary: "Inspection summary",
};

export type Linha = { rotulo: string; valor: string };

/** Campos que valem para o cliente: some "No", vazio e o que é interno. */
export function linhasDoCliente(report: NormalizedReport | undefined): Linha[] {
  if (!report) return [];
  const out: Linha[] = [];
  for (const [k, v] of Object.entries(report.fields)) {
    if (OCULTOS.has(k) || v === null || v === undefined || v === "") continue;
    if (typeof v === "boolean" && !v) continue;
    let valor: string;
    if (k === "duration_ms" && typeof v === "number") valor = duracao(v);
    else if (k === "materials_extra_charge" && Number.isFinite(Number(v))) valor = `£${Number(v).toFixed(2)}`;
    else if (typeof v === "boolean") valor = "Yes";
    else if (k === "certificate_outcome" && typeof v === "string") valor = titulo(v);
    else if (typeof v === "string") { if (textoInterno(v)) continue; valor = v.trim(); }
    else if (typeof v === "number") valor = String(v);
    else if (Array.isArray(v)) valor = v.map(String).join(", ");
    else continue;
    if (!valor) continue;
    out.push({ rotulo: ROTULO_CLIENTE[k] ?? labelForReportField(k), valor });
  }
  return out;
}

export function textoDe(report: NormalizedReport | undefined, chave: string): string | null {
  const v = report?.fields?.[chave];
  return typeof v === "string" && v.trim() && !textoInterno(v) ? v.trim() : null;
}

