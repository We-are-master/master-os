import type { Page } from "playwright";
import type { AcceptedSlot, CheckatradeOpportunity } from "./types.js";
import type { SlotSelectionStrategy } from "../config.js";
import { daysBetweenYmd, tzNow, ymdWeekday } from "../time.js";

export type AcceptOptions = {
  strategy: SlotSelectionStrategy;
  /** When false, a valid slot is identified but "Accept Job" is NOT clicked (dry run / notify-only). */
  autoAccept: boolean;
  /** Accepted slot must be at least this many calendar days from today (UK tz). */
  minDateDaysAhead: number;
  /** Accepted slot's weekday (Sun=0..Sat=6, UK tz) must be one of these. */
  slotDays: number[];
  /** Timezone all the date rules are evaluated in. */
  timezone: string;
};

export type AcceptOutcome =
  | { status: "accepted"; slot: AcceptedSlot }
  | { status: "would_accept"; date: string; timeWindow?: string }
  | { status: "no_valid_slot"; reason: string };

// ─── Checkatrade selectors — verified live on 2026-07-06 ────────────────
// A "job" (Checkatrade Express) opportunity's detail page is
// /business-jobs/{externalId}?source=express. It shows:
//   - A "Select a date and time" dropdown. Opening it reveals options at
//     [data-testid^="toolshed-native-dropdown-menu-item-"], one per
//     available slot, each with text like
//     "Wednesday 8, July 2026, 12:00 - 16:00".
//   - Once a slot is picked, a button becomes enabled:
//     button[aria-label="Accept Job (at set price)"] — this is the
//     REAL, FINANCIALLY-BINDING accept action. There's also a "Not for
//     me" decline button with the same lack of a stable testid — only
//     use text matching for it.
//
// VERIFIED (2026-07-06, on an already-accepted job): the full street
// address is never rendered as page text — before acceptance the page
// shows only a postcode, and even after acceptance the customer sidebar
// card (name/phone/email) still only shows the postcode as text. The full
// address DOES exist in the app's data though — it's used to build the
// "Open in Google Maps" action's target. Clicking:
//   button[aria-label="Additional options"]  (the "..." next to Call/Chat,
//                                              only present once accepted)
//   → text "Open in Google Maps"
// opens a new tab at https://www.google.com/maps/place/{encoded address}/...
// — parse the address out of that URL, then close the popup tab.
const SLOT_OPTION_SELECTOR = '[data-testid^="toolshed-native-dropdown-menu-item-"]';
const ACCEPT_BUTTON_SELECTOR = 'button[aria-label="Accept Job (at set price)"]';
const ADDITIONAL_OPTIONS_SELECTOR = 'button[aria-label="Additional options"]';

/** Exported so classify.ts can put this in Master OS's report_link field. */
export function detailUrl(externalId: string): string {
  return `https://membersapp.checkatrade.com/business-jobs/${externalId}?source=express`;
}

/** "Wednesday 8, July 2026, 12:00 - 16:00" → { date: "2026-07-08", timeWindow: "12:00 - 16:00" }. */
function parseSlotLabel(label: string): { date: string; timeWindow: string } | null {
  const m = label.match(/(\d{1,2}),\s*([A-Za-z]+)\s*(\d{4}),\s*(\d{2}:\d{2})\s*-\s*(\d{2}:\d{2})/);
  if (!m) return null;
  const [, day, monthName, year, start, end] = m;
  const monthIndex = new Date(`${monthName} 1, 2000`).getMonth();
  if (Number.isNaN(monthIndex)) return null;
  const date = `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  return { date, timeWindow: `${start} - ${end}` };
}

/**
 * Opens the "job" opportunity's detail page, reads the calendar's available
 * slots, and — only among slots that satisfy the date rules (>= minDateDaysAhead
 * and on an allowed weekday) — picks one per `strategy`. Clicking "Accept Job"
 * is REAL and FINANCIALLY BINDING, so it happens ONLY when `autoAccept` is true
 * AND a valid slot exists. Returns a discriminated outcome so the caller knows
 * whether a job was actually won (and should be created in Master OS), was
 * merely a match (dry run), or had no acceptable slot (skip). Must run BEFORE
 * creating the job in Master OS — never record a win the RPA didn't actually make.
 */
export async function acceptJobAndPickSlot(
  page: Page,
  opportunity: CheckatradeOpportunity,
  opts: AcceptOptions,
): Promise<AcceptOutcome> {
  await page.goto(detailUrl(opportunity.externalId), { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
  const richDescription = await scrapeRichDescription(page);

  await page.getByText("Select a date and time", { exact: true }).click();

  const slotOptions = page.locator(SLOT_OPTION_SELECTOR);
  const count = await slotOptions.count();
  if (count === 0) {
    return { status: "no_valid_slot", reason: "Checkatrade offered no slots" };
  }

  const allSlots: { index: number; date: string; timeWindow: string }[] = [];
  for (let i = 0; i < count; i++) {
    const label = (await slotOptions.nth(i).textContent())?.trim() ?? "";
    const parsed = parseSlotLabel(label);
    if (parsed) allSlots.push({ index: i, ...parsed });
  }
  if (allSlots.length === 0) {
    return { status: "no_valid_slot", reason: "no slot label parsed as a date" };
  }

  // Keep only slots that satisfy the date rules (min days ahead + allowed weekday).
  const todayYmd = tzNow(opts.timezone).ymd;
  const validSlots = allSlots.filter((s) => {
    const daysAhead = daysBetweenYmd(todayYmd, s.date);
    if (!Number.isFinite(daysAhead) || daysAhead < opts.minDateDaysAhead) return false;
    return opts.slotDays.includes(ymdWeekday(s.date));
  });

  if (validSlots.length === 0) {
    const offered = allSlots.map((s) => s.date).join(", ");
    return {
      status: "no_valid_slot",
      reason: `no slot >= ${opts.minDateDaysAhead}d ahead on allowed weekdays [${opts.slotDays.join(",")}]; offered: ${offered}`,
    };
  }

  validSlots.sort((a, b) => a.date.localeCompare(b.date));
  const chosen = opts.strategy === "latest" ? validSlots[validSlots.length - 1] : validSlots[0];

  // Dry run: matched a valid slot but the operator disabled auto-accept.
  if (!opts.autoAccept) {
    return { status: "would_accept", date: chosen.date, timeWindow: chosen.timeWindow };
  }

  await slotOptions.nth(chosen.index).click();
  await page.locator(ACCEPT_BUTTON_SELECTOR).click();
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const fullAddress = await scrapeRevealedAddress(page);
  // VERIFIED (2026-07-06, real accepted job "E McLean"): before acceptance
  // a job card/page never shows a customer name at all (unlike leads) — it
  // only appears in the sidebar once accepted, same postcode-anchored
  // pattern as the lead detail page.
  const customerName = await scrapeRevealedCustomerName(page, opportunity.postcode);

  return {
    status: "accepted",
    slot: { acceptedDate: chosen.date, acceptedTimeWindow: chosen.timeWindow, fullAddress, customerName, richDescription },
  };
}

/**
 * VERIFIED (2026-07-06, real job "Large Window Reseal (Gen-250)"): the
 * detail page's "Message" block has a generic boilerplate first paragraph
 * ("This is a Checkatrade Express job. We told the customer that: A trade
 * will come to work on your request of {category}.") followed by the
 * ACTUAL job-specific brief and a "--- Services Required ---" line. The
 * card's own description (dashboard.ts) only ever has the boilerplate
 * paragraph, truncated — this is the only place the real brief lives.
 * Strips the boilerplate paragraph out; best-effort, returns undefined
 * rather than guessing if the structure doesn't match.
 */
async function scrapeRichDescription(page: Page): Promise<string | undefined> {
  try {
    const text = await page.locator("body").innerText();
    const block = text.match(/^Message\n.*\n([\s\S]+?)\n(?:Select the date|Appointments|Earnings)/m)?.[1]?.trim();
    if (!block) return undefined;
    const paragraphs = block.split(/\n\n+/).filter((p) => !/^This is a Checkatrade Express job/.test(p.trim()));
    const result = paragraphs.join("\n\n").trim();
    return result || undefined;
  } catch {
    return undefined;
  }
}

async function scrapeRevealedCustomerName(page: Page, postcode: string | undefined): Promise<string | undefined> {
  if (!postcode) return undefined;
  try {
    const text = await page.locator("body").innerText();
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    const postcodeIdx = lines.findIndex((l) => l.includes(postcode));
    return postcodeIdx > 0 ? lines[postcodeIdx - 1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Full street address via the "Open in Google Maps" action (verified live —
 * see the module doc comment above). Best-effort: any failure here (menu
 * didn't open, no popup, unparseable URL) returns undefined rather than
 * throwing — callers must have a fallback (see classify.ts) since a missing
 * address must never block job creation in Master OS.
 */
async function scrapeRevealedAddress(page: Page): Promise<string | undefined> {
  try {
    await page.locator(ADDITIONAL_OPTIONS_SELECTOR).click({ timeout: 5_000 });
    const [popup] = await Promise.all([
      page.context().waitForEvent("page", { timeout: 5_000 }),
      page.getByText("Open in Google Maps", { exact: true }).click(),
    ]);
    await popup.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
    const url = popup.url();
    await popup.close();

    // https://www.google.com/maps/place/26+Sherborne+Gardens,+London+NW9+9TE/@...
    const m = url.match(/\/maps\/place\/([^/@]+)/);
    if (!m) return undefined;
    return decodeURIComponent(m[1]).replace(/\+/g, " ");
  } catch {
    return undefined;
  }
}
