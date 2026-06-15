/** Clamp fixed drawer widths to the viewport on mobile. */
export function responsiveDrawerWidthClass(width: string): string {
  if (width.includes("100vw") || width.includes("min(")) {
    return width;
  }
  const pxMatch = width.match(/w-\[(\d+)px\]/);
  if (pxMatch) {
    return `w-full max-w-[min(100vw,${pxMatch[1]}px)]`;
  }
  const remMatch = width.match(/w-\[([\d.]+)rem\]/);
  if (remMatch) {
    return `w-full max-w-[min(100vw,${remMatch[1]}rem)]`;
  }
  return `w-full ${width}`;
}
