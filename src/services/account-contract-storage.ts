import { getSupabase } from "./base";

const BUCKET = "company-assets";
const MAX_BYTES = 10 * 1024 * 1024;

const ALLOWED_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

function extFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m === "application/pdf") return "pdf";
  if (m === "application/msword") return "doc";
  if (m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") return "docx";
  return "pdf";
}

/** Uploads to `company-assets/accounts/{accountId}/contract.{ext}` and returns the public URL. */
export async function uploadAccountContract(accountId: string, file: File): Promise<string> {
  const type = file.type.toLowerCase() || "application/octet-stream";
  if (!ALLOWED_TYPES.has(type)) {
    throw new Error("Use PDF, DOC ou DOCX.");
  }
  if (file.size > MAX_BYTES) {
    throw new Error("Contract file must be 10 MB or less.");
  }

  const supabase = getSupabase();
  const folder = `accounts/${accountId}`;

  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list(folder);
  if (listErr) throw new Error(listErr.message);

  const toRemove = (existing ?? [])
    .filter((f) => f.name.startsWith("contract."))
    .map((f) => `${folder}/${f.name}`);
  if (toRemove.length > 0) {
    const { error: rmErr } = await supabase.storage.from(BUCKET).remove(toRemove);
    if (rmErr) throw new Error(rmErr.message);
  }

  const ext = extFromMime(type);
  const path = `${folder}/contract.${ext}`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, file, {
    upsert: true,
    contentType: type,
    cacheControl: "3600",
  });
  if (upErr) throw new Error(upErr.message);

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  return pub.publicUrl;
}

/** Removes existing account contract object under `accounts/{accountId}/contract.*`. */
export async function removeAccountContractFromStorage(accountId: string): Promise<void> {
  const supabase = getSupabase();
  const folder = `accounts/${accountId}`;
  const { data: existing, error: listErr } = await supabase.storage.from(BUCKET).list(folder);
  if (listErr) throw new Error(listErr.message);
  const toRemove = (existing ?? [])
    .filter((f) => f.name.startsWith("contract."))
    .map((f) => `${folder}/${f.name}`);
  if (toRemove.length === 0) return;
  const { error: rmErr } = await supabase.storage.from(BUCKET).remove(toRemove);
  if (rmErr) throw new Error(rmErr.message);
}
