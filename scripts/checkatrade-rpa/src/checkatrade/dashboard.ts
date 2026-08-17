import type { Locator, Page } from "playwright";
import type { CheckatradeOpportunity } from "./types.js";
import { SessionExpiredError } from "./auth.js";
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
/** Thrown when Cloudflare serves its bot-detection block page instead of the app. */
export class CloudflareBlockedError extends Error {
  constructor() {
    super("Cloudflare bloqueou o acesso (bot-detection). O browser precisa rodar headed (xvfb no Docker).");
  }
}

/**
 * BOTH boards have to be read.
 *
 * "My jobs" (/jobs/all) and "Express jobs" (/jobs/business) are separate tabs
 * and their contents have diverged: verified live 2026-07-29, /jobs/all
 * returned 196 cards, ALL leads and not one Express job, while /jobs/business
 * held the jobs — including the New ones. Polling /jobs/all alone (which is
 * what this did) meant Express jobs were structurally invisible, no matter how
 * well the scroll worked.
 *
 * The third tab, /jobs/opportunities-board, is deliberately left alone.
 */
const JOBS_BOARD = "https://membersapp.checkatrade.com/jobs/business"; // Express jobs — contested
const LEADS_BOARD = "https://membersapp.checkatrade.com/jobs/all"; // My jobs — leads

/**
 * How often the LEADS board is read, in cycles.
 *
 * Reading both boards every cycle cost ~152s, of which ~76s was the leads
 * board returning "0 actionable" — it had done so for days, since every lead
 * has been responded to. Meanwhile an Express certificate is gone in about two
 * minutes: measured 2026-08-04, all 42 certificates on the board were already
 * Taken, up to £203.50, and we had won two. Half the cycle was being spent
 * where nothing was contested, on the one job type where speed decides.
 *
 * A lead can't be taken from us by responding faster, so checking it every
 * tenth cycle loses nothing and roughly halves time-to-first-look at a job.
 */
// Desde 17/08/2026 a varredura COMPLETA é o deep scan (rara — o ciclo
// rápido é o scrapeNewOnly abaixo), então ela lê os dois boards sempre:
// é ela que alimenta o placar e o dedupe, e cobertura vale mais que os
// ~76s do board de leads.
const LEADS_BOARD_EVERY = 1;
let cycleCount = 0;
const CARD_SELECTOR = '[data-testid^="job-card-v2-"]';
const CARD_LABEL_TESTID = "job-card-v2-job-source-label"; // not a real card, filter out
const STATUS_SELECTOR = '[data-testid="toolshed-native-status-pill-label"]';
const LEAF_TEXT_SELECTOR = '[data-testid="toolshed-native-typography"]';

/**
 * The board is INFINITE-SCROLL and lands with only the first ~10 cards in the
 * DOM. Verified live 2026-07-28: /jobs/all held 36 cards, but the first batch
 * was all "Interested" leads — two genuinely-New Express jobs sat further down
 * and were invisible to a no-scroll read. That is why the loop reported
 * "0 opportunities" while work was sitting in the feed.
 *
 * The list has its own scroll container, so a wheel event only advances it
 * with the cursor parked OVER the cards; scrollIntoViewIfNeeded on the last
 * card is the container-agnostic belt-and-braces. Bounded so one cycle can't
 * run away on a huge board.
 */
const MAX_SCROLL_ROUNDS = 120;
const SCROLL_SETTLE_ROUNDS = 6;
/** Small steps: a big jump scrolls past recycled rows before they ever render. */
const SCROLL_STEP_PX = 1200;

/** One card's data, captured while it was in the DOM. */
type RawCard = { testid: string; status: string; fields: string[] };

/**
 * Collect every card by reading DURING the scroll, not after it.
 *
 * The list is VIRTUALISED: only ~12 cards exist in the DOM at any moment and
 * they are recycled as the list scrolls. Scrolling to the bottom and then
 * reading therefore captures only the final window — verified live 2026-07-29,
 * where two reads six minutes apart returned twelve completely DIFFERENT jobs,
 * and reading incrementally instead surfaced 200. The bot had been deciding
 * against roughly 6% of the board, which is why "New" jobs so rarely appeared.
 *
 * Capturing the text as we go (rather than holding Locators) matters too: a
 * recycled node still matches the selector but now describes a different job.
 */
async function collectCards(page: Page): Promise<RawCard[]> {
  const found = new Map<string, RawCard>();
  const cards = page.locator(CARD_SELECTOR);
  let roundsWithoutNew = 0;

  for (let round = 0; round < MAX_SCROLL_ROUNDS && roundsWithoutNew < SCROLL_SETTLE_ROUNDS; round++) {
    const before = found.size;
    const count = await cards.count();

    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const testid = await card.getAttribute("data-testid").catch(() => null);
      if (!testid || !isRealCardTestid(testid) || found.has(testid)) continue;

      const status =
        (await card.locator(STATUS_SELECTOR).first().textContent().catch(() => null))?.trim() || "";
      const fields = (await card.locator(LEAF_TEXT_SELECTOR).allTextContents().catch(() => []))
        .map((t) => t.trim())
        .filter(Boolean);
      found.set(testid, { testid, status, fields });
    }

    roundsWithoutNew = found.size === before ? roundsWithoutNew + 1 : 0;

    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, SCROLL_STEP_PX);
    await page.waitForTimeout(450);
  }

  return [...found.values()];
}

/**
 * Positive proof we're logged in, for the "zero cards" case. An expired
 * session does NOT always redirect to /login — sometimes the app renders an
 * empty shell on the same URL, which reads as a legitimately quiet feed and
 * kept the bot silently blind for days. When there are no cards, look for the
 * login form instead of assuming the feed is simply empty.
 */
async function looksLoggedOut(page: Page): Promise<boolean> {
  if (page.url().includes("/login")) return true;
  const markers = ["Trade log in", "Log in to your account", "Enter your email"];
  for (const text of markers) {
    if (await page.getByText(text, { exact: false }).first().isVisible({ timeout: 1_500 }).catch(() => false)) {
      return true;
    }
  }
  return false;
}

export async function scrapeOpportunities(page: Page): Promise<CheckatradeOpportunity[]> {
  const all: CheckatradeOpportunity[] = [];
  const seen = new Set<string>();
  const tally: Record<string, number> = {};

  // Jobs board every cycle; leads board occasionally (see LEADS_BOARD_EVERY).
  const readLeads = cycleCount++ % LEADS_BOARD_EVERY === 0;
  const boards = readLeads ? [JOBS_BOARD, LEADS_BOARD] : [JOBS_BOARD];

  for (const url of boards) {
    const { opportunities, statusTally } = await scrapeBoard(page, url);
    for (const [status, n] of Object.entries(statusTally)) tally[status] = (tally[status] ?? 0) + n;
    // A card can legitimately appear on both tabs — dedupe on Checkatrade's id.
    for (const o of opportunities) {
      if (seen.has(o.externalId)) continue;
      seen.add(o.externalId);
      all.push(o);
    }
  }

  // "0 opportunities" alone is the line that hid the blindness for nine days:
  // it looks identical whether the feed is quiet or the scraper can't see. The
  // status tally makes the difference obvious at a glance.
  logger.info(
    `Boards read: ${Object.values(tally).reduce((a, b) => a + b, 0)} cards${readLeads ? " (jobs+leads)" : " (jobs only)"}`,
    tally,
  );

  return all;
}

/**
 * Passada RÁPIDA: só o que ACABOU de chegar, sem varrer o board inteiro.
 *
 * A varredura completa custa 6–7 minutos em ~600 cards, e um Express "New"
 * evapora em ~2. Card novo nasce no TOPO da lista, então ler a primeira
 * janela (com três rolagens curtas, ~40 cards) a cada poucos segundos acha o
 * recém-chegado em segundos. O que esta passada NÃO faz de propósito: placar
 * de status, dedupe de board inteiro, conclusões — isso é papel do deep scan
 * (scrapeOpportunities), que continua rodando de tempo em tempo.
 */
const FAST_SCROLL_ROUNDS = 3;

export async function scrapeNewOnly(page: Page, board: "jobs" | "leads"): Promise<CheckatradeOpportunity[]> {
  const url = board === "jobs" ? JOBS_BOARD : LEADS_BOARD;
  await page.goto(url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 8_000 }).catch(() => {});

  if (page.url().includes("/login")) throw new SessionExpiredError();
  const title = await page.title().catch(() => "");
  if (title.includes("Attention Required") || title.includes("Just a moment")) {
    throw new CloudflareBlockedError();
  }
  const corpo = await page.locator("body").innerText().catch(() => "");
  if (/Sorry, you have been blocked|unable to access checkatrade\.com|Cloudflare Ray ID/i.test(corpo)) {
    throw new CloudflareBlockedError();
  }

  const found = new Map<string, RawCard>();
  const cards = page.locator(CARD_SELECTOR);
  for (let round = 0; round < FAST_SCROLL_ROUNDS; round++) {
    const count = await cards.count();
    for (let i = 0; i < count; i++) {
      const card = cards.nth(i);
      const testid = await card.getAttribute("data-testid").catch(() => null);
      if (!testid || !isRealCardTestid(testid) || found.has(testid)) continue;
      const status =
        (await card.locator(STATUS_SELECTOR).first().textContent().catch(() => null))?.trim() || "";
      const fields = (await card.locator(LEAF_TEXT_SELECTOR).allTextContents().catch(() => []))
        .map((t) => t.trim())
        .filter(Boolean);
      found.set(testid, { testid, status, fields });
    }
    await page.mouse.move(900, 500).catch(() => {});
    await page.mouse.wheel(0, SCROLL_STEP_PX);
    await page.waitForTimeout(350);
  }

  if (found.size === 0 && (await looksLoggedOut(page))) throw new SessionExpiredError();

  const out: CheckatradeOpportunity[] = [];
  for (const c of [...found.values()].filter((c) => c.status === "New")) {
    try {
      const o = scrapeCard(c);
      if (o) out.push(o);
    } catch (err) {
      logger.error(`Failed to scrape opportunity card ${c.testid}`, err);
    }
  }
  // Só loga quando ACHOU: uma linha a cada 10s sem nada é como o log morre.
  if (out.length > 0) {
    logger.info(`  fast ${board}: ${out.length} New na janela de ${found.size} cards`);
  }
  return out;
}

async function scrapeBoard(
  page: Page,
  boardUrl: string,
): Promise<{ opportunities: CheckatradeOpportunity[]; statusTally: Record<string, number> }> {
  await page.goto(boardUrl, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

  // Session death is silent: the redirect lands on /jobs/login, which simply
  // has zero job cards — every cycle would report "0 opportunities" forever.
  // Surface it as a typed error so the main loop can re-login and recover.
  if (page.url().includes("/login")) {
    throw new SessionExpiredError();
  }

  // Cloudflare's block page keeps the /jobs/all URL (no redirect) and just
  // renders zero cards — the other silent-zero trap. There is more than one
  // such page and they don't share a title: the rate-limit one (verified
  // 2026-07-28, triggered by scraping detail pages ~600ms apart) says "Sorry,
  // you have been blocked" in the BODY while the title check sails past.
  // Check both, or a block reads as an empty feed all over again. Runs BEFORE
  // loadAllCards so a block doesn't burn 40 scroll rounds first.
  const title = await page.title().catch(() => "");
  if (title.includes("Attention Required") || title.includes("Just a moment")) {
    throw new CloudflareBlockedError();
  }
  const bodyText = await page.locator("body").innerText().catch(() => "");
  if (/Sorry, you have been blocked|unable to access checkatrade\.com|Cloudflare Ray ID/i.test(bodyText)) {
    throw new CloudflareBlockedError();
  }

  // Read the whole virtualised list, capturing each card as it renders.
  const raw = await collectCards(page);

  // Zero cards is the ambiguous state: genuinely-quiet feed, or a dead session
  // rendering an empty shell. Only the positive check tells them apart.
  if (raw.length === 0 && (await looksLoggedOut(page))) {
    throw new SessionExpiredError();
  }

  const results: CheckatradeOpportunity[] = [];
  const statusTally: Record<string, number> = {};

  for (const card of raw) {
    statusTally[card.status || "(none)"] = (statusTally[card.status || "(none)"] ?? 0) + 1;
    try {
      const opportunity = scrapeCard(card);
      if (opportunity) results.push(opportunity);
    } catch (err) {
      // One bad card must never abort the whole scrape — log and move on.
      logger.error(`Failed to scrape opportunity card ${card.testid}`, err);
    }
  }

  logger.info(
    `  ${boardUrl.split("/").pop()}: ${raw.length} cards, ${results.length} actionable`,
    statusTally,
  );

  return { opportunities: results, statusTally };
}

const CARD_TESTID_PREFIX = "job-card-v2-";

/**
 * `job-card-v2-*` is reused for sub-elements INSIDE a card, not just the card
 * itself — "job-card-v2-job-source-label" and (found 2026-07-28)
 * "job-card-v2-unread-dot". Enumerating them one by one means the next new
 * one silently becomes a phantom opportunity, so test the shape instead: a
 * real card's suffix is an id (uuid/cuid — always contains a digit), while a
 * sub-element's is a lowercase-word slug.
 */
function isRealCardTestid(testid: string): boolean {
  if (!testid.startsWith(CARD_TESTID_PREFIX)) return false;
  const suffix = testid.slice(CARD_TESTID_PREFIX.length);
  if (suffix.length < 10) return false;
  return /\d/.test(suffix) && !/^[a-z]+(-[a-z]+)*$/.test(suffix);
}

/**
 * Parses a card from text CAPTURED EARLIER, not from a live Locator: the list
 * is virtualised, so by the time we get here the node that matched may have
 * been recycled to describe a different job entirely.
 */
function scrapeCard({ testid, status, fields }: RawCard): CheckatradeOpportunity | null {
  const externalId = testid.slice(CARD_TESTID_PREFIX.length);
  if (!externalId) return null; // Can't dedupe without an id — skip rather than guess.

  if (status !== "New") return null; // Only untouched-and-available opportunities.
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
