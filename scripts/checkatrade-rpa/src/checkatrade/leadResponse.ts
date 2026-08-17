import type { Page } from "playwright";
import type { CheckatradeOpportunity } from "./types.js";

// ─── Checkatrade selectors — verified live on 2026-07-06 ────────────────
// A "lead" (chat enquiry) opportunity's detail page is /jobs/{externalId}
// (note: NOT /business-jobs/... — that path is Express jobs only. Lead ids
// are plain UUIDs, distinct from the cuid-style ids Express jobs use, but
// both come from the same job-card-v2-{id} testid on the list, so no extra
// logic is needed to tell them apart before navigating).
//
// The detail page shows the REAL full enquiry message (richer than the
// list card's text, which can show a stale "reminder" message instead of
// the original enquiry) plus an "Appointments" note, and two actions:
//   button[aria-label="I'm interested"]  — expresses interest. NOT a
//     financial commitment (unlike accepting an Express job) — just
//     visibility to the customer, equivalent to placing a bid. Clicking it
//     reveals the customer's phone/email in a sidebar card (previously
//     hidden), confirming this is the "respond" action Checkatrade expects.
//   button[aria-label="Not for me"]      — declines, not used by this RPA.
//
// VERIFIED: even after "I'm interested", the address stays postcode-level
// ("London, W3 6XR") — "Open in Google Maps" from the sidebar's "..." menu
// resolves only to "London W3 6XR, UK", no street. So unlike Express jobs,
// there's no richer address to fetch here — the list card's postcode is
// already the full picture for a lead.
const INTERESTED_BUTTON_SELECTOR = 'button[aria-label="I\'m interested"]';
const LEAF_TEXT_SELECTOR = '[data-testid="toolshed-native-typography"]';
const POSTCODE_RE = /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/;

/**
 * Read the page as the app's own ordered leaf text nodes.
 *
 * VERIFIED 2026-07-28: `body.innerText` on a lead detail page returns the
 * SIDEBAR ONLY (886 chars) while `textContent` has the full 5322 — the detail
 * panel never lands in innerText, so every innerText-based regex here silently
 * matched nothing. textContent isn't usable either: it concatenates with no
 * separator ("…Friday 29 MayTTTeisi TammingLondon, SE12LP…"). The app tags
 * each leaf with the same testid the board scraper already uses, which gives
 * both the text and its boundaries.
 */
export async function readLeafFields(page: Page): Promise<string[]> {
  const leaves = await page.locator(LEAF_TEXT_SELECTOR).allTextContents();
  return leaves.map((t) => t.trim()).filter(Boolean);
}

/**
 * The lead's own fields sit at the END of the leaf list (the app shell's nav
 * occupies the start), laid out as:
 *   … "TT" (initials), "Teisi Tamming", "London, SE12LP", "On Checkatrade
 *   since", "January 2026", "Not for me", "I'm interested"
 * so anchor on the postcode and read the name immediately before it.
 */
export function parseLeadIdentity(fields: string[]): {
  name?: string;
  location?: string;
  postcode?: string;
} {
  const idx = fields.findIndex((f) => POSTCODE_RE.test(f));
  if (idx < 0) return {};
  const location = fields[idx];
  return {
    name: idx > 0 ? fields[idx - 1] : undefined,
    location,
    postcode: location.match(POSTCODE_RE)?.[0],
  };
}

/** Message body is the leaf right after the "Message" label + its timestamp. */
export function parseLeadMessage(fields: string[]): string | undefined {
  const i = fields.indexOf("Message");
  if (i < 0) return undefined;
  // fields[i+1] is the timestamp ("24 May 26 15:48"); the body follows it.
  const candidate = fields[i + 2] ?? fields[i + 1];
  return candidate && candidate !== "Appointments" ? candidate : undefined;
}

/** Contact details only exist AFTER "I'm interested" — absent on a New lead. */
export function parseLeadContact(fields: string[]): { phone?: string; email?: string } {
  const joined = fields.join("\n");
  return {
    phone: joined.match(/\+44\s?\d[\d\s]{8,}\d|\b0\d{9,10}\b/)?.[0]?.trim(),
    email: joined.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,24}/)?.[0],
  };
}

export type LeadDetails = {
  /** The real enquiry message from the detail page — richer than the list card's preview. */
  message?: string;
  /** Free-text scheduling note, e.g. "The customer is flexible on the start date." */
  appointmentNote?: string;
  phone?: string;
  email?: string;
};

function detailUrl(externalId: string): string {
  return `https://membersapp.checkatrade.com/jobs/${externalId}`;
}

/**
 * Opens the lead's detail page, reads the full enquiry (message +
 * appointment note), and clicks "I'm interested" — a low-stakes, non-
 * financial action that reveals the customer's contact details. Returns
 * the richer details for classify.ts to use when creating the Lead in
 * Master OS (falls back to the list card's fields when a field can't be
 * found — see classify.ts).
 */
export async function respondToLead(page: Page, opportunity: CheckatradeOpportunity): Promise<LeadDetails> {
  await page.goto(detailUrl(opportunity.externalId), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Leaf nodes, not innerText — see readLeafFields for why innerText is blind
  // to this panel entirely.
  const before = await readLeafFields(page);
  const message = parseLeadMessage(before);
  const apptIdx = before.indexOf("Appointments");
  const appointmentNote =
    apptIdx >= 0
      ? before
          .slice(apptIdx + 1)
          .filter((f) => !POSTCODE_RE.test(f))
          .slice(0, 8)
          .join(" ")
          .trim() || undefined
      : undefined;

  // Idempotent: a previous run may have already clicked "I'm interested" on
  // this lead (e.g. it then failed to reach Master OS and got retried).
  // Only click if the button is still there — an already-"Interested" lead
  // won't show it, and re-clicking would just error and block re-processing
  // forever.
  const interestedButton = page.locator(INTERESTED_BUTTON_SELECTOR);
  if (await interestedButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await interestedButton.click({ timeout: 10_000 });
    await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
  }

  // Contact details are revealed by the click above, so re-read the leaves.
  const after = await readLeafFields(page);
  const { phone, email } = parseLeadContact(after);

  return { message, appointmentNote, phone, email };
}
