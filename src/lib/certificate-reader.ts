/**
 * Reads the expiry date off the certificate the partner attached.
 *
 * Server-only: signs the attachment, sends it to OpenAI, and writes the date
 * back onto the report so nobody has to transcribe it. The rules for judging
 * what comes back live in `certificate-expiry.ts`, which this file imports.
 *
 * Two things learned from the two real certificates in the system, both PDFs:
 *
 *   1. The date only comes out right when the model sees the *pages*. Sent as
 *      text alone (Chat Completions `type: "file"`), the same CP12 produced a
 *      confident expiry three years off. The Responses API renders each page as
 *      an image, and both models then matched the date a person had typed by
 *      hand. Hence `/v1/responses` here rather than the chat endpoint the rest
 *      of the app uses.
 *   2. The certificate *number* is not safe to auto-fill. On those same two
 *      documents the readings included `CR0 6PQ` and `24373500 W6 OAG` — a
 *      postcode, and a serial with the postcode glued on. That field goes in
 *      front of the client, so the number is stored for reference and never
 *      written. The date is the ask; the date is what we write.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CERTIFICATE_AI_KEY,
  certificateAttachmentUrls,
  isPlausibleExpiry,
  toIsoDate,
  toUkDate,
  type CertificateAiEnvelope,
  type CertificateReading,
} from "@/lib/certificate-expiry";

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses";
const BUCKET = "job-reports";

/**
 * Defaults to the full model, not mini. Same cost per certificate at these
 * sizes (both land around half a penny) and it kept the postcode out of the
 * reference field where mini did not.
 */
const MODEL = () => process.env.OPENAI_CERTIFICATE_MODEL?.trim() || "gpt-4o";

/** Big enough for a scanned multi-page EICR, small enough to stay in one request. */
const MAX_BYTES = 8 * 1024 * 1024;

const SYSTEM = `You read UK property compliance certificates: Gas Safety Record (CP12), EICR / Electrical Installation Condition Report, EPC, PAT, Fire Risk Assessment, Legionella.

Reply with JSON only, exactly these keys:
{"document_type":string|null,"certificate_number":string|null,"issued_date":"YYYY-MM-DD"|null,"expiry_date":"YYYY-MM-DD"|null,"outcome":"satisfactory"|"satisfactory_with_recommendations"|"unsatisfactory"|null,"confidence":"high"|"medium"|"low"}

Rules:
- Dates on the document are British, DD/MM/YYYY. Never swap the day and the month.
- When the document prints an expiry, a "valid until", a "next inspection due" or a "next service due" date, return it and use confidence "high".
- When only an issue or inspection date is printed, compute the expiry from the standard validity for that document type (CP12 gas = 12 months, EICR = 5 years, EPC = 10 years, PAT = 12 months, Fire Risk Assessment = 12 months, Legionella = 24 months) and use confidence "medium".
- certificate_number is the serial or reference of the document itself. It is never a postcode, an address, a phone number or an engineer registration number. Return null rather than a guess.
- Anything you cannot actually read on the document: null. Do not infer, do not invent.`;

export type CertificateFillOutcome =
  | { ok: true; applied: boolean; reading: CertificateReading }
  | { ok: false; reason: string };

// ─── Reading one document ────────────────────────────────────────────────────

interface DocumentBytes {
  bytes: Uint8Array;
  filename: string;
  isPdf: boolean;
  mime: string;
}

export async function readCertificateDocument(
  doc: DocumentBytes,
): Promise<{ reading: CertificateReading } | { error: string }> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return { error: "OpenAI is not configured" };
  if (doc.bytes.byteLength > MAX_BYTES) {
    return { error: `document too large (${Math.round(doc.bytes.byteLength / 1024 / 1024)}MB)` };
  }

  const b64 = Buffer.from(doc.bytes).toString("base64");
  const content = doc.isPdf
    ? [
        {
          type: "input_file",
          filename: doc.filename,
          file_data: `data:application/pdf;base64,${b64}`,
        },
        { type: "input_text", text: "Extract the fields from this certificate." },
      ]
    : [
        { type: "input_image", image_url: `data:${doc.mime};base64,${b64}`, detail: "high" },
        { type: "input_text", text: "Extract the fields from this certificate." },
      ];

  let res: Response;
  try {
    res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model: MODEL(),
        temperature: 0,
        max_output_tokens: 400,
        instructions: SYSTEM,
        input: [{ role: "user", content }],
      }),
    });
  } catch (err) {
    return { error: `OpenAI unreachable: ${err instanceof Error ? err.message : String(err)}` };
  }

  const json = (await res.json().catch(() => null)) as {
    error?: { message?: string };
    output?: Array<{ content?: Array<{ text?: string }> }>;
  } | null;

  if (!res.ok) return { error: json?.error?.message || `OpenAI HTTP ${res.status}` };

  const text = (json?.output ?? [])
    .flatMap((o) => o.content ?? [])
    .map((c) => c.text)
    .filter((t): t is string => typeof t === "string")
    .join("")
    .trim();

  if (!text) return { error: "empty response" };

  const parsed = parseJsonObject(text);
  if (!parsed) return { error: "response was not JSON" };

  return { reading: normaliseReading(parsed) };
}

/** The model fences its JSON often enough that stripping is not optional. */
function parseJsonObject(text: string): Record<string, unknown> | null {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) return null;
  try {
    const value = JSON.parse(text.slice(start, end + 1)) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

const CONFIDENCES = new Set(["high", "medium", "low"]);

function normaliseReading(raw: Record<string, unknown>): CertificateReading {
  const str = (v: unknown): string | null => {
    if (typeof v !== "string") return null;
    const s = v.trim();
    return s && s.toLowerCase() !== "null" ? s : null;
  };
  const confidence = str(raw.confidence)?.toLowerCase() ?? null;
  return {
    document_type: str(raw.document_type),
    certificate_number: str(raw.certificate_number),
    issued_date: toIsoDate(raw.issued_date),
    expiry_date: toIsoDate(raw.expiry_date),
    outcome: str(raw.outcome),
    confidence: confidence && CONFIDENCES.has(confidence)
      ? (confidence as "high" | "medium" | "low")
      : null,
  };
}

// ─── Filling the report ──────────────────────────────────────────────────────

interface JobRow {
  id: string;
  reference: string | null;
  final_report: Record<string, unknown> | null;
}

/**
 * Reads the certificate on a job and writes the expiry back onto the report.
 *
 * Safe to call on any job: it does nothing unless the final report is a
 * certificate with an attachment and no reading yet. The result is recorded
 * either way, so a document that cannot be read is not retried on every save.
 */
export async function fillCertificateExpiry(
  supabase: SupabaseClient,
  jobId: string,
  options?: { force?: boolean },
): Promise<CertificateFillOutcome> {
  const { data, error } = await supabase
    .from("jobs")
    .select("id, reference, final_report")
    .eq("id", jobId)
    .maybeSingle();

  if (error || !data) return { ok: false, reason: "job not found" };
  const job = data as JobRow;
  const report = job.final_report;
  if (!report || report.template !== "certificate") {
    return { ok: false, reason: "not a certificate report" };
  }
  if (report[CERTIFICATE_AI_KEY] && !options?.force) {
    return { ok: false, reason: "already read" };
  }

  const urls = certificateAttachmentUrls(report);
  if (urls.length === 0) {
    await storeEnvelope(supabase, job, { error: "no certificate attached" });
    return { ok: false, reason: "no certificate attached" };
  }

  const doc = await downloadAttachment(supabase, urls[0]);
  if ("error" in doc) {
    await storeEnvelope(supabase, job, { error: doc.error });
    return { ok: false, reason: doc.error };
  }

  const read = await readCertificateDocument(doc);
  if ("error" in read) {
    await storeEnvelope(supabase, job, { error: read.error });
    return { ok: false, reason: read.error };
  }

  // Only write a date that survives the plausibility guard, and only into a
  // field nobody filled in: a person who typed a date was holding the paper.
  const submittedAt = typeof report.submitted_at === "string" ? new Date(report.submitted_at) : new Date();
  const iso = read.reading.expiry_date;
  const typed = toIsoDate(report.expiry_date);
  const usable = iso ? isPlausibleExpiry(iso, submittedAt) : false;
  const applied = Boolean(iso && usable && !typed);

  await storeEnvelope(
    supabase,
    job,
    { ...read.reading, applied },
    applied && iso ? (toUkDate(iso) ?? undefined) : undefined,
  );

  if (iso && !usable) {
    console.warn(
      `[certificate-reader] ${job.reference ?? job.id}: expiry ${iso} rejected as implausible`,
    );
  }
  return { ok: true, applied, reading: read.reading };
}

/**
 * Writes the reading (and the date, when we are applying one) onto the report.
 *
 * Re-reads `final_report` first so a save that landed while the model was
 * thinking is not overwritten — the whole call takes several seconds, which is
 * long enough for someone to have edited the report in the meantime.
 */
async function storeEnvelope(
  supabase: SupabaseClient,
  job: JobRow,
  envelope: CertificateAiEnvelope,
  expiryFieldValue?: string,
): Promise<void> {
  const { data } = await supabase
    .from("jobs")
    .select("final_report")
    .eq("id", job.id)
    .maybeSingle();

  const fresh = (data as { final_report: Record<string, unknown> | null } | null)?.final_report
    ?? job.final_report
    ?? {};

  const next: Record<string, unknown> = {
    ...fresh,
    [CERTIFICATE_AI_KEY]: {
      ...envelope,
      read_at: new Date().toISOString(),
      model: MODEL(),
    },
  };
  // Never overwrite a date typed between the read starting and finishing.
  if (expiryFieldValue && !toIsoDate(fresh.expiry_date)) {
    next.expiry_date = expiryFieldValue;
  }

  const { error } = await supabase
    .from("jobs")
    .update({ final_report: next, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  if (error) {
    console.error("[certificate-reader] could not store the reading:", error.message);
    return;
  }

  if (!expiryFieldValue) return;
  void supabase
    .from("audit_logs")
    .insert({
      entity_type: "job",
      entity_id: job.id,
      entity_ref: job.reference ?? null,
      // `action` is a constrained vocabulary in the database — anything else
      // is rejected outright — so the event name lives in metadata.
      action: "updated",
      field_name: "final_report.expiry_date",
      old_value: null,
      new_value: expiryFieldValue,
      metadata: {
        event: "certificate_expiry_read",
        model: MODEL(),
        confidence: envelope.confidence ?? null,
      },
    })
    .then(({ error: auditErr }) => {
      if (auditErr) console.error("audit_logs (certificate-reader)", auditErr);
    });
}

/**
 * The report stores a public URL, but `job-reports` is a private bucket, so the
 * stored address answers 400. Sign the path before fetching — the same trap
 * that made Stefane upload zero photos.
 */
async function downloadAttachment(
  supabase: SupabaseClient,
  url: string,
): Promise<DocumentBytes | { error: string }> {
  const marker = `/${BUCKET}/`;
  const at = url.indexOf(marker);
  if (at === -1) return { error: "attachment is not in the reports bucket" };
  const path = decodeURIComponent(url.slice(at + marker.length).split("?")[0]);

  const { data: signed, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, 600);
  if (error || !signed?.signedUrl) return { error: `could not sign the attachment: ${error?.message}` };

  let res: Response;
  try {
    res = await fetch(signed.signedUrl);
  } catch (err) {
    return { error: `download failed: ${err instanceof Error ? err.message : String(err)}` };
  }
  if (!res.ok) return { error: `download failed: HTTP ${res.status}` };

  const bytes = new Uint8Array(await res.arrayBuffer());
  const lower = path.toLowerCase();
  const isPdf = lower.endsWith(".pdf") || res.headers.get("content-type") === "application/pdf";
  return {
    bytes,
    filename: path.split("/").pop() || "certificate",
    isPdf,
    mime: isPdf ? "application/pdf" : res.headers.get("content-type") || "image/jpeg",
  };
}
