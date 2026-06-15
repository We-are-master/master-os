const LOGO_FETCH_TIMEOUT_MS = 4000;
const logoDataUriCache = new Map<string, string | undefined>();

function isHttpsUrl(url: string): boolean {
  try {
    return new URL(url).protocol === "https:";
  } catch {
    return false;
  }
}

/** Prefetch a remote logo for @react-pdf/renderer (needs data URI or absolute https). */
export async function resolveLogoDataUri(logoUrl: string | undefined): Promise<string | undefined> {
  if (!logoUrl?.trim() || !isHttpsUrl(logoUrl)) return undefined;
  const key = logoUrl.trim();
  if (logoDataUriCache.has(key)) return logoDataUriCache.get(key);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), LOGO_FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(key, { signal: controller.signal });
    if (!r.ok) {
      logoDataUriCache.set(key, undefined);
      return undefined;
    }
    const buf = Buffer.from(await r.arrayBuffer());
    if (buf.length > 4 * 1024 * 1024) {
      logoDataUriCache.set(key, undefined);
      return undefined;
    }
    const ct = (r.headers.get("content-type") || "image/png").split(";")[0].trim() || "image/png";
    const dataUri = `data:${ct};base64,${buf.toString("base64")}`;
    logoDataUriCache.set(key, dataUri);
    return dataUri;
  } catch {
    logoDataUriCache.set(key, undefined);
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export const DEFAULT_INVOICE_PDF_LOGO_URL = "https://www.getfixfy.com/brand/fixfy-primary-white.png";
