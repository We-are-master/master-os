/**
 * Normalize storage/CDN URLs for HTML email (img src / href).
 * Protocol-relative `//...` and stray spaces break clients; relative URLs are invalid in email.
 */
export function normalizeEmailAssetUrl(raw: string): string | null {
  let u = typeof raw === "string" ? raw.trim() : "";
  if (!u) return null;
  if (u.startsWith("//")) u = `https:${u}`;
  try {
    const parsed = new URL(u);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.href;
  } catch {
    return null;
  }
}

export function escapeHtmlAttr(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
