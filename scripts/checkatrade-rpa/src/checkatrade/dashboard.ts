import type { Locator, Page } from "playwright";
import type { CheckatradeOpportunity } from "./types.js";
import { logger } from "../logger.js";

// ─── Checkatrade selectors — verified live on 2026-07-06 ────────────────
// The "My jobs" → "All" tab (/jobs/all) lists BOTH kinds of opportunity in
// one feed. Each card is `[data-testid^="job-card-v2-"]` where the suffix is
// the real Checkatrade job id — except one reused sub-element that always
// carries the literal testid "job-card-v2-job-source-label" ("Direct
// booking"), which is NOT a card and must be filtered out.
//
// Every field inside a card is a leaf text node with the SAME generic
// testid ("toolshed-native-typography"), EXCEPT the status pill, which has
// its own stable testid. So instead of regexing the card's flattened text
// (ambiguous — a job title can itself contain the word "New"), read the
// ordered array of leaf text nodes and index into it. Verified structure:
//
//   Job   (Checkatrade Express): [title, "Checkatrade Express", postcode,
//                                 "£price", "Description", descriptionText,
//                                 "Respond now", "Created ..."]
//   Lead  (chat enquiry):        [category, customerName, "City, POSTCODE",
//                                 "New message", unreadCount, messageText,
//                                 "Respond now", "Created ..."]
//
// The status word itself lives in a SEPARATE element:
//   [data-testid="toolshed-native-status-pill-label"] — only "New" is
//   untouched-and-available; skip Cancelled/Accepted/Completed/Booked/etc.
const LIVE_OPPORTUNITIES_URL = "https://membersapp.checkatrade.com/jobs/all";
const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const CARD_LABEL_TESTID = "job-card-v2-job-source-label"; // not a real card, filter out
const STATUS_SELECTOR = '[data-testid="toolshed-native-status-pill-label"]';
const LEAF_TEXT_SELECTOR = '[data-testid="toolshed-native-typography"]';

export async function scrapeOpportunities(page: Page): Promise<CheckatradeOpportunity[]> {
  await page.goto(LIVE_OPPORTUNITIES_URL, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  const cards = page.locator(CARD_SELECTOR);
  const count = await cards.count();
  const results: CheckatradeOpportunity[] = [];

  for (let i = 0; i < count; i++) {
    const card = cards.nth(i);
    const testid = await card.getAttribute("data-testid");
    if (!testid || testid === CARD_LABEL_TESTID) continue;

    try {
      const opportunity = await scrapeCard(card, testid);
      if (opportunity) results.push(opportunity);
    } catch (err) {
      // One bad card must never abort the whole scrape — log and move on.
      logger.error(`Failed to scrape opportunity card ${testid}`, err);
    }
  }

  return results;
}

const CARD_TESTID_PREFIX = "job-card-v2-";

async function scrapeCard(card: Locator, testid: string): Promise<CheckatradeOpportunity | null> {
  const externalId = testid.slice(CARD_TESTID_PREFIX.length);
  if (!externalId) return null; // Can't dedupe without an id — skip rather than guess.

  const status = (await card.locator(STATUS_SELECTOR).first().textContent().catch(() => null))?.trim();
  if (status !== "New") return null; // Only untouched-and-available opportunities.

  const leaves = await card.locator(LEAF_TEXT_SELECTOR).allTextContents();
  const fields = leaves.map((t) => t.trim()).filter(Boolean);
  if (fields.length < 2) return null;

  const category = fields[0];
  const isJob = fields.includes("Checkatrade Express");

  if (isJob) {
    // Anchor-based, not fixed-index: a card can carry an extra leaf node we
    // haven't catalogued (e.g. an "expiring soon" badge) that shifts every
    // fixed index after it. Verified live (2026-07-06) this happened on a
    // real job — fixed-index reads silently pulled the "Description" LABEL
    // itself instead of the text that follows it. Searching for known
    // anchors instead of trusting position is immune to that.
    const postcode = fields.find((f) => /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(f));
    const priceField = fields.find((f) => /£\s*[\d,.]+/.test(f));
    const priceMatch = priceField?.match(/([\d,.]+)/);
    const priceHint = priceMatch ? Number(priceMatch[1].replace(/,/g, "")) : undefined;
    const descriptionLabelIdx = fields.indexOf("Description");
    const description = descriptionLabelIdx >= 0 ? fields[descriptionLabelIdx + 1] : undefined;

    return {
      externalId,
      kind: "job",
      category,
      // NOTE: the list card never shows the full street address — only a
      // postcode. property_address is a REQUIRED field on POST /api/jobs.
      // The full address is only revealed by Checkatrade AFTER accepting
      // (see booking.ts's scrapeRevealedAddress) — classify.ts falls back
      // to a postcode-only placeholder if that comes back empty.
      address: undefined,
      postcode,
      description,
      priceHint,
      raw: { testid, fields },
    };
  }

  // Lead (chat enquiry) card. Anchor on the location field (matches a UK
  // postcode) rather than a fixed index for the same reason as the job
  // branch above — the customer name is whatever comes right before it,
  // and the message preview is whatever comes right after the unread-count
  // digit that follows the location.
  const locationIdx = fields.findIndex((f) => /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(f));
  const location = locationIdx >= 0 ? fields[locationIdx] : undefined;
  const customerName = locationIdx > 0 ? fields[locationIdx - 1] : undefined;
  const unreadCountIdx = fields.findIndex((f, i) => i > locationIdx && /^\d+$/.test(f));
  const description = unreadCountIdx >= 0 ? fields[unreadCountIdx + 1] : undefined;
  const postcode = location?.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)?.[0];

  return {
    externalId,
    kind: "lead",
    category,
    customerName,
    // No street address on the card for leads either — this is a pre-quote
    // enquiry, so "City, POSTCODE" is what Checkatrade gives before a trade
    // is actually chosen. Good enough for the Lead record (it's refined
    // later in the OS once the job is actually scoped/won).
    address: location,
    postcode,
    description,
    raw: { testid, fields },
  };
}
