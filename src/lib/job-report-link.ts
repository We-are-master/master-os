/**
 * Turn stored text into a safe external href, or null when there is no link.
 *
 * `jobs.report_link` is a free-text field: the RPA writes a platform URL, Alex
 * writes the respond.io conversation, and people type whatever they have at
 * hand. Rendering all of it as an anchor is what produced the complaint that
 * "none of the links work" — the field held `respondio:lead:<uuid>`, `Test`
 * and `checkatrade-manual:48759`, and each of those became a link that goes
 * nowhere. A dead link is worse than plain text: it promises a destination.
 *
 * So the rule is the reverse of what it was. We return an href only when the
 * text is addressable:
 *
 *   https://…  ·  http://…     already a URL, kept as it is
 *   www.foo.com                missing scheme, https added
 *   foo.co.uk/bar              a hostname with a real TLD, https added
 *
 * Everything else returns null, and the caller shows the raw text instead.
 * `respondio:lead:…` and `checkatrade-manual:…` are internal keys, not
 * addresses, and no URL can be derived from them without an API lookup.
 *
 * Non-http schemes are refused too (`javascript:` is the reason to be strict
 * here, and no other scheme has a reason to live in this field).
 */

/** A last label that looks like a real TLD: letters only, at least two. */
const TEM_TLD = /\.[a-z]{2,}(?:[/:?#]|$)/i;

export function jobReportLinkHref(raw: string | null | undefined): string | null {
  const t = (raw ?? "").trim();
  if (!t || /\s/.test(t)) return null;
  if (/^https?:\/\//i.test(t)) return t;
  // Qualquer outro esquema (`respondio:`, `checkatrade-manual:`, `javascript:`)
  // não é endereço que o navegador abra: vira texto.
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return null;
  if (/^www\./i.test(t)) return `https://${t}`;
  return TEM_TLD.test(t.split(/[/?#]/)[0] ?? "") ? `https://${t}` : null;
}
