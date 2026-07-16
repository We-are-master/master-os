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

  // innerText() (not textContent()) — it mirrors what's actually rendered,
  // inserting line breaks between block-level elements the same way a
  // human reading the page would see them. textContent() concatenates
  // every text node with NO separator at all, which silently corrupted
  // every regex here (e.g. an email glued directly to the following "Show
  // more" link's text with zero characters between them).
  const beforeText = await page.locator("body").innerText();
  const message = beforeText.match(/^Message\n.*\n([\s\S]+?)\n\nAppointments/m)?.[1]?.trim();
  const appointmentNote = beforeText.match(/^Appointments\n(?:Create\n)?([\s\S]+?)\n\n/m)?.[1]?.trim();

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

  const afterText = await page.locator("body").innerText();
  const phone = afterText.match(/\+44\s?\d[\d\s]{8,}\d/)?.[0]?.trim();
  // Bounded TLD (2-24 letters) so a following line ("Show more") never
  // bleeds into the match — the innerText() switch above already fixes the
  // root cause (real line breaks), this bound is defense in depth.
  const email = afterText.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,24}/)?.[0];

  return { message, appointmentNote, phone, email };
}
