/** Turn stored text into a safe external href (add https when scheme missing). */
export function jobReportLinkHref(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t) return null;
  if (/^https?:\/\//i.test(t)) return t;
  if (/^www\./i.test(t)) return `https://${t}`;
  if (t.includes(".") && !/\s/.test(t)) return `https://${t}`;
  return t;
}
