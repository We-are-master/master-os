import { getSupabase, type ListParams, type ListResult } from "./base";
import { sanitizePostgrestValue } from "@/lib/supabase/sanitize";
import type {
  AccountComplianceCertificate,
  ComplianceCertificateStatus,
  ComplianceCertificateType,
} from "@/types/database";

const BUCKET = "compliance-certificates";
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED_MIME = new Set([
  "application/pdf",
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
]);

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "image/jpg" || m === "image/jpeg") return "jpg";
  if (m === "image/png") return "png";
  if (m === "image/webp") return "webp";
  if (m === "image/heic") return "heic";
  if (m === "image/heif") return "heif";
  return "bin";
}

export async function listAccountComplianceCertificates(
  params: ListParams & {
    accountId?: string;
    propertyId?: string;
    status?: ComplianceCertificateStatus;
  },
): Promise<ListResult<AccountComplianceCertificate>> {
  const supabase = getSupabase();
  const page = params.page ?? 1;
  const pageSize = params.pageSize ?? 50;
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  let query = supabase
    .from("account_compliance_certificates")
    .select("*", { count: "exact" })
    .is("deleted_at", null);

  const aid = params.accountId?.trim();
  if (aid) query = query.eq("account_id", aid);
  const pid = params.propertyId?.trim();
  if (pid) query = query.eq("property_id", pid);
  if (params.status) query = query.eq("status", params.status);

  if (params.search) {
    const safeSearch = sanitizePostgrestValue(params.search);
    if (safeSearch) {
      query = query.or(
        `notes.ilike.%${safeSearch}%,certificate_type.ilike.%${safeSearch}%`,
      );
    }
  }

  const sortCol = params.sortBy ?? "expiry_date";
  const sortDir = params.sortDir ?? "asc";
  query = query.order(sortCol, { ascending: sortDir === "asc" });
  query = query.range(from, to);

  const { data, error, count } = await query;
  if (error) throw error;

  return {
    data: (data ?? []) as AccountComplianceCertificate[],
    count: count ?? 0,
    page,
    pageSize,
    totalPages: Math.ceil((count ?? 0) / pageSize),
  };
}

export async function getAccountComplianceCertificate(
  id: string,
): Promise<AccountComplianceCertificate | null> {
  if (!id?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("account_compliance_certificates")
    .select("*")
    .eq("id", id.trim())
    .is("deleted_at", null)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data as AccountComplianceCertificate | null;
}

export interface ComplianceCertInsert {
  account_id: string;
  property_id?: string | null;
  certificate_type: ComplianceCertificateType;
  issued_date?: string | null;
  expiry_date: string;
  notes?: string | null;
  document_path?: string | null;
}

/** Compute initial status from expiry_date. The trigger in mig 159
 *  fires on status changes — passing the right status here means the
 *  portal user gets a notif if the cert is already expiring/expired. */
function statusFromExpiry(expiryDate: string): ComplianceCertificateStatus {
  const expiry = new Date(`${expiryDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const days = Math.round((expiry.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
  if (days < 0) return "expired";
  if (days <= 30) return "expiring";
  return "ok";
}

export async function createAccountComplianceCertificate(
  input: ComplianceCertInsert,
): Promise<AccountComplianceCertificate> {
  const supabase = getSupabase();
  const status = statusFromExpiry(input.expiry_date);
  const { data, error } = await supabase
    .from("account_compliance_certificates")
    .insert({
      account_id: input.account_id,
      property_id: input.property_id ?? null,
      certificate_type: input.certificate_type,
      issued_date: input.issued_date ?? null,
      expiry_date: input.expiry_date,
      status,
      document_path: input.document_path ?? null,
      notes: input.notes?.trim() || null,
      last_checked_at: new Date().toISOString(),
    })
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AccountComplianceCertificate;
}

export async function updateAccountComplianceCertificate(
  id: string,
  patch: Partial<ComplianceCertInsert> & { status?: ComplianceCertificateStatus },
): Promise<AccountComplianceCertificate> {
  const supabase = getSupabase();
  const next: Record<string, unknown> = { ...patch, updated_at: new Date().toISOString() };
  if (patch.expiry_date && !patch.status) {
    next.status = statusFromExpiry(patch.expiry_date);
  }
  if (patch.notes !== undefined) {
    next.notes = patch.notes?.trim() || null;
  }
  const { data, error } = await supabase
    .from("account_compliance_certificates")
    .update(next)
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw new Error(error.message);
  return data as AccountComplianceCertificate;
}

export async function deleteAccountComplianceCertificate(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase
    .from("account_compliance_certificates")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw new Error(error.message);
}

/** Uploads to compliance-certificates/{accountId}/{certId}.{ext}.
 *  Returns the storage path (not a URL) — callers mint signed URLs
 *  on render via getSignedUrl below. */
export async function uploadComplianceCertDoc(
  accountId: string,
  certId: string,
  file: File,
): Promise<string> {
  const type = file.type.toLowerCase() || "application/octet-stream";
  if (!ALLOWED_MIME.has(type)) {
    throw new Error("Use a PDF or an image (JPG, PNG, WEBP, HEIC).");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("File must be 20 MB or less.");
  }
  const supabase = getSupabase();
  const folder = `${accountId}`;

  // Remove any existing object for this cert id (keep one per cert).
  const { data: existing } = await supabase.storage.from(BUCKET).list(folder);
  const stale = (existing ?? [])
    .filter((f) => f.name.startsWith(`${certId}.`))
    .map((f) => `${folder}/${f.name}`);
  if (stale.length > 0) {
    await supabase.storage.from(BUCKET).remove(stale);
  }

  const path = `${folder}/${certId}.${extFromMime(type)}`;
  const buf = new Uint8Array(await file.arrayBuffer());
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buf, {
    contentType: type,
    cacheControl: "3600",
    upsert: true,
  });
  if (upErr) throw new Error(upErr.message);
  return path;
}

export async function getComplianceCertSignedUrl(
  storagePath: string,
  ttlSec = 60 * 60,
): Promise<string | null> {
  if (!storagePath?.trim()) return null;
  const supabase = getSupabase();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(storagePath, ttlSec);
  if (error || !data?.signedUrl) return null;
  return data.signedUrl;
}
