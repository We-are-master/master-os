import type { CSSProperties } from "react";

/**
 * Fixed drawer widths, clamped to the viewport.
 *
 * The max-width goes out as an inline style, not a Tailwind class. The previous
 * version built the class with a template string — `max-w-[min(100vw,${n}px)]`
 * — and Tailwind only generates classes it can literally read in the source.
 * That class never existed in the stylesheet, so every drawer fell back to the
 * `w-full` beside it and opened full-screen: Quotes, Invoices, and each of the
 * five widths the OS asks for.
 */
export function drawerWidth(width: string): { className: string; style?: CSSProperties } {
  // Callers that already clamp themselves (they pass a literal class) pass through.
  if (width.includes("100vw") || width.includes("min(")) {
    return { className: width };
  }
  const px = width.match(/w-\[(\d+)px\]/);
  if (px) {
    return { className: "w-full", style: { maxWidth: `min(100vw, ${px[1]}px)` } };
  }
  const rem = width.match(/w-\[([\d.]+)rem\]/);
  if (rem) {
    return { className: "w-full", style: { maxWidth: `min(100vw, ${rem[1]}rem)` } };
  }
  return { className: `w-full ${width}` };
}
