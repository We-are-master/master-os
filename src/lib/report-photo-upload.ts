/**
 * Browser-side photo prep for report submission, shared by the public partner
 * form and the office modal. Phone photos are 4–8 MB each and a cleaner report
 * carries a dozen of them, so they get downscaled before they ever hit the
 * network. PDFs (certificates) pass through untouched.
 */

const MAX_PHOTO_LONG_EDGE = 1600;
const PHOTO_JPEG_QUALITY = 0.75;

export function isPdfFile(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export async function downscaleImage(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const longest = Math.max(bitmap.width, bitmap.height);
  const scale = longest > MAX_PHOTO_LONG_EDGE ? MAX_PHOTO_LONG_EDGE / longest : 1;
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Could not get canvas context.");
  ctx.drawImage(bitmap, 0, 0, w, h);
  const blob: Blob = await new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error("Image encode failed."))),
      "image/jpeg",
      PHOTO_JPEG_QUALITY,
    );
  });
  bitmap.close();
  return blob;
}

export async function prepareUploadFile(file: File, slotKey: string, index: number): Promise<File> {
  if (isPdfFile(file)) return file;
  const blob = await downscaleImage(file);
  return new File([blob], `${slotKey}-${index}.jpg`, { type: "image/jpeg" });
}

/**
 * Splits the typed field map into the start and final halves the API expects,
 * dropping blanks and fields whose `showIf` gate is closed. Same rule on both
 * forms: a field you cannot see is a field you did not answer.
 */
export function splitReportFields(
  spec: {
    start: Array<{ key: string; showIf?: { key: string; equals: unknown } }>;
    final: Array<{ key: string; showIf?: { key: string; equals: unknown } }>;
  },
  data: Record<string, unknown>,
): { startFields: Record<string, unknown>; finalFields: Record<string, unknown> } {
  const collect = (fields: Array<{ key: string; showIf?: { key: string; equals: unknown } }>) => {
    const out: Record<string, unknown> = {};
    for (const f of fields) {
      if (f.showIf && data[f.showIf.key] !== f.showIf.equals) continue;
      const v = data[f.key];
      if (v === undefined || v === null || v === "") continue;
      out[f.key] = v;
    }
    return out;
  };
  return { startFields: collect(spec.start), finalFields: collect(spec.final) };
}
