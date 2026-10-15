/** Known former defaults only. User-defined navigation labels are preserved. */
const LEGACY_LABELS: Readonly<Record<string, readonly string[]>> = {
  "/": ["Pulse"],
  "/schedule": ["Live view", "Live View"],
  "/leads": ["Leads"],
  "/school": ["Fixfy School"],
};

export function updatedNavigationLabel(href: string, storedLabel: string, canonicalLabel: string): string {
  return LEGACY_LABELS[href]?.includes(storedLabel) ? canonicalLabel : storedLabel;
}
