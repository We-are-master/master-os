/**
 * The expiry date on a compliance certificate: reading it, judging it, showing it.
 *
 * This is the pure half — no network, no Supabase — so the API route, the
 * dashboard card and the tests all import the same rules. The half that talks
 * to OpenAI and writes to the job lives in `certificate-reader.ts`.
 *
 * Why it exists: a CP12 lasts 12 months, an EICR 5 years, an EPC 10. The date
 * that starts that clock is printed on the PDF the partner attaches, and until
 * now nobody transcribed it, so the renewal was never scheduled and the job
 * came back only when the landlord remembered.
 */

/** Envelope key on `final_report` holding what the model read. Never a field. */
export const CERTIFICATE_AI_KEY = "certificate_ai";

/** What the model is asked to return. Every field may come back null. */
export interface CertificateReading {
  document_type?: string | null;
  certificate_number?: string | null;
  /** ISO YYYY-MM-DD. */
  issued_date?: string | null;
  /** ISO YYYY-MM-DD. */
  expiry_date?: string | null;
  outcome?: string | null;
  confidence?: "high" | "medium" | "low" | null;
}

/** What gets stored on the report, reading plus the audit trail around it. */
export interface CertificateAiEnvelope extends CertificateReading {
  /** True when we wrote `expiry_date` into the report field ourselves. */
  applied?: boolean;
  read_at?: string;
  model?: string;
  /** Set instead of a reading when it could not be read. Stops the retry loop. */
  error?: string;
}

// ─── Dates ───────────────────────────────────────────────────────────────────

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * `08/07/2027` or `2027-07-08` → `2027-07-08`. Anything else → null.
 *
 * Day-first, always: the field hint says DD/MM/YYYY and every certificate here
 * is British. Reading `08/07` as 7 August would move a renewal by a month.
 */
export function toIsoDate(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;

  let y: number, m: number, d: number;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/);
  const uk = s.match(/^(\d{1,2})[/.\-](\d{1,2})[/.\-](\d{4})$/);
  if (iso) {
    [y, m, d] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  } else if (uk) {
    [d, m, y] = [Number(uk[1]), Number(uk[2]), Number(uk[3])];
  } else {
    return null;
  }

  // Round-trip through UTC so 31/02 and 30/02 are rejected rather than rolled.
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) {
    return null;
  }
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** `2027-07-08` → `08/07/2027`, the shape the office types into the field. */
export function toUkDate(iso: string): string | null {
  const norm = toIsoDate(iso);
  if (!norm) return null;
  const [y, m, d] = norm.split("-");
  return `${d}/${m}/${y}`;
}

/** `2027-07-08` → `8 Jul 2027`. */
export function formatExpiryDisplay(iso: string): string | null {
  const norm = toIsoDate(iso);
  if (!norm) return null;
  return new Date(`${norm}T12:00:00Z`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * How far ahead we start calling a certificate "expiring".
 *
 * Sixty days, not the thirty the compliance dashboard uses, because the point
 * of capturing this date is to message the landlord one or two months before
 * the renewal — the reminder has to fire while there is still time to book.
 */
export const EXPIRING_WINDOW_DAYS = 60;

export type ExpiryState = "expired" | "expiring" | "valid";

export interface ExpiryStatus {
  state: ExpiryState;
  /** Whole days from today to the expiry. Negative once it has passed. */
  days: number;
}

export function expiryStatus(iso: string, now: Date = new Date()): ExpiryStatus | null {
  const norm = toIsoDate(iso);
  if (!norm) return null;
  const target = Date.parse(`${norm}T00:00:00Z`);
  // Compare date to date: an expiry today is still valid today.
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const days = Math.round((target - today) / 86_400_000);
  if (days < 0) return { state: "expired", days };
  if (days <= EXPIRING_WINDOW_DAYS) return { state: "expiring", days };
  return { state: "valid", days };
}

/**
 * Would this expiry make sense for a certificate issued on this visit?
 *
 * The guard earns its place: reading the same CP12 without the page images, the
 * model returned an expiry of 2023 for a job done in 2026 — confidently. A date
 * in the past, or further out than the longest UK validity, is a misread and
 * must not be written into the report.
 */
export function isPlausibleExpiry(iso: string, reportedAt: Date): boolean {
  const norm = toIsoDate(iso);
  if (!norm) return false;
  const target = Date.parse(`${norm}T00:00:00Z`);
  const from = reportedAt.getTime();
  if (!Number.isFinite(target) || !Number.isFinite(from)) return false;
  const day = 86_400_000;
  // A week of slack: a certificate is sometimes dated the day before the visit.
  if (target < from - 7 * day) return false;
  // The EPC is the longest at 10 years; 11 leaves room without letting a
  // slipped century through.
  if (target > from + 11 * 365 * day) return false;
  return true;
}

// ─── Reading the report ──────────────────────────────────────────────────────

/** The certificate PDFs/photos attached to a final report, in upload order. */
export function certificateAttachmentUrls(finalReport: unknown): string[] {
  const photos = (finalReport as { photos?: unknown } | null)?.photos;
  if (!photos || typeof photos !== "object" || Array.isArray(photos)) return [];
  const slot = (photos as Record<string, unknown>).certificate;
  if (!Array.isArray(slot)) return [];
  return slot.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
}

export function certificateAiEnvelope(finalReport: unknown): CertificateAiEnvelope | null {
  const raw = (finalReport as Record<string, unknown> | null)?.[CERTIFICATE_AI_KEY];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  return raw as CertificateAiEnvelope;
}

export interface CertificateValidity {
  /** ISO YYYY-MM-DD. */
  iso: string;
  /** `8 Jul 2027`. */
  display: string;
  state: ExpiryState;
  days: number;
  /** Whether a person typed the date or the model read it off the document. */
  source: "manual" | "ai";
  /** Only meaningful when `source` is "ai". */
  confidence?: "high" | "medium" | "low" | null;
}

/**
 * The single validity answer for a certificate report, whoever produced it.
 *
 * The typed field wins over the model: someone looking at the paper beats
 * someone looking at a render of it, and this way the strip keeps working on
 * the reports that were filled in before any of this existed.
 */
export function certificateValidity(
  finalReport: unknown,
  now: Date = new Date(),
): CertificateValidity | null {
  if (!finalReport || typeof finalReport !== "object") return null;
  const report = finalReport as Record<string, unknown>;
  if (report.template !== "certificate") return null;

  const typed = toIsoDate(report.expiry_date);
  const ai = certificateAiEnvelope(finalReport);
  const read = toIsoDate(ai?.expiry_date);

  const iso = typed ?? read;
  if (!iso) return null;

  const status = expiryStatus(iso, now);
  const display = formatExpiryDisplay(iso);
  if (!status || !display) return null;

  // `applied` means we wrote the field ourselves, so a typed value that equals
  // the reading is still the model's work and should say so.
  const fromAi = !typed || (ai?.applied === true && read === typed);

  return {
    iso,
    display,
    state: status.state,
    days: status.days,
    source: fromAi ? "ai" : "manual",
    confidence: fromAi ? ai?.confidence ?? null : undefined,
  };
}

// ─── Copy ────────────────────────────────────────────────────────────────────

/** The line that answers "is this certificate still good?" at a glance. */
export function expiryHeadline(v: CertificateValidity): string {
  if (v.state === "expired") {
    const n = Math.abs(v.days);
    if (n === 0) return `Expired today · ${v.display}`;
    if (n === 1) return `Expired yesterday · ${v.display}`;
    return `Expired ${n} days ago · ${v.display}`;
  }
  if (v.state === "expiring") {
    if (v.days === 0) return `Expires today · ${v.display}`;
    if (v.days === 1) return `Expires tomorrow · ${v.display}`;
    return `Expires in ${v.days} days · ${v.display}`;
  }
  return `Valid until ${v.display}`;
}

/** Where the date came from, and whether it deserves a second look. */
export function expirySourceNote(v: CertificateValidity): string {
  if (v.source === "manual") return "Typed in from the certificate.";
  if (v.confidence === "high") return "Read from the attached certificate.";
  if (v.confidence === "medium") {
    return "Read from the attached certificate: worked out from the issue date, worth a check.";
  }
  return "Read from the attached certificate with low confidence: check it against the document.";
}
