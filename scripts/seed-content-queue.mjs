/**
 * Seeds the 10-week social backlog into the Fixfy content queue.
 * Each post lands as a DRAFT (you still approve each via the 1-tap email) and is
 * scheduled for its Monday 9am — the Publisher posts it once approved + due.
 *
 * The 30 blogs are NOT seeded here: the Blog Writer agent produces them 3×/week,
 * following docs/social-media-agent/10-week-content-calendar.md.
 *
 * Prereqs (your activation steps): branch deployed, migrations 243 + 244 applied,
 * `social-media` bucket created, env MASTER_OS_CONTENT_API_KEY set (+ PEXELS for photos).
 *
 * Run:  MASTER_OS_CONTENT_API_KEY=xxx APP_URL=https://app.getfixfy.com node scripts/seed-content-queue.mjs
 *       (APP_URL defaults to https://app.getfixfy.com; falls back to NEXT_PUBLIC_APP_URL)
 *       Add --dry to preview without posting.
 */

const APP_URL = (process.env.APP_URL || process.env.NEXT_PUBLIC_APP_URL || "https://app.getfixfy.com").replace(/\/$/, "");
const KEY = process.env.MASTER_OS_CONTENT_API_KEY;
const DRY = process.argv.includes("--dry");

const PLATFORMS = ["linkedin", "instagram"];
const at9 = (date) => `${date}T09:00:00+01:00`; // UK BST

const POSTS = [
  { week: 1, scheduled_for: at9("2026-06-22"), product: "fixfy", bg: "navy", format: "square",
    eyebrow: "SUMMER, SORTED", title: "Long days. Short to-do list.",
    sub: "Summer maintenance, handed over before it piles up.",
    caption: "Summer's when the small jobs stack up — and the good tradespeople get booked out. Get ahead: forward your list to Fixfy and we'll bring vetted local pros, clear £ prices, and proof it's done. Maintenance, handled.",
    hashtags: ["propertymaintenance", "ukbusiness", "facilitiesmanagement", "landlords"],
    use_photo: true, photo_query: "summer uk house exterior" },

  { week: 2, scheduled_for: at9("2026-06-29"), product: "trades", bg: "navy", format: "square",
    eyebrow: "PEAK SEASON", title: "Busy summer?\nKeep the jobs straight.",
    sub: "Quote, schedule the crew and get paid — one app.",
    caption: "Summer is feast season for trades — until the admin buries you. Run the whole job from one place: quote on site, schedule the lads, get paid without chasing. Your trade, handled.",
    hashtags: ["tradesperson", "smallbusinessuk", "gardening", "fieldservice"],
    use_photo: true, photo_query: "gardener landscaper working uk" },

  { week: 3, scheduled_for: at9("2026-07-06"), product: "fixfy", bg: "light", format: "square",
    eyebrow: "NO SURPRISES", title: "The cheapest quote\nusually costs the most.",
    sub: "Vetted, insured pros and a price agreed up front.",
    caption: "We get it — three quotes in, you take the lowest. Then the job's done twice. Fixfy only sends vetted, insured pros, with the price agreed before anyone starts. Maintenance, handled.",
    hashtags: ["propertymanagement", "trust", "maintenance", "landlords"],
    use_photo: false, photo_query: "" },

  { week: 4, scheduled_for: at9("2026-07-13"), product: "trades", bg: "navy", format: "square",
    eyebrow: "VOID TURNAROUND", title: "Turnaround in days,\nnot weeks.",
    sub: "Quote, book and invoice the whole void from your phone.",
    caption: "Void turnarounds live or die on speed. Keep every job, quote and invoice in one place so nothing slips between tenancies. Your trade, handled.",
    hashtags: ["lettings", "tradesperson", "propertymaintenance", "voids"],
    use_photo: true, photo_query: "painter decorator empty flat uk" },

  { week: 5, scheduled_for: at9("2026-07-20"), product: "fixfy", bg: "navy", format: "square",
    eyebrow: "HEATWAVE READY", title: "Stuffy offices?\nSorted before the heat hits.",
    sub: "Ventilation, AC and cooling checks, handed over.",
    caption: "When the heat lands, a stuffy office or a broken AC becomes everyone's problem — and yours. Get it checked before the spike. Forward it to Fixfy. Maintenance, handled.",
    hashtags: ["facilitiesmanagement", "officemanagement", "maintenance", "ukbusiness"],
    use_photo: true, photo_query: "air conditioning office uk" },

  { week: 6, scheduled_for: at9("2026-07-27"), product: "trades", bg: "orange", format: "square",
    eyebrow: "GET PAID", title: "Done the job.\nNow get paid for it.",
    sub: "Quote → invoice → payment, no chasing.",
    caption: "Chasing invoices is the worst part of the week — and it's unpaid. Send the quote, raise the invoice and take payment from the same app. Your trade, handled.",
    hashtags: ["cashflow", "smallbusinessuk", "tradesperson", "getpaid"],
    use_photo: false, photo_query: "" },

  { week: 7, scheduled_for: at9("2026-08-03"), product: "fixfy", bg: "navy", format: "square",
    eyebrow: "STAY COMPLIANT", title: "EICR. Gas. EPC.\nAll in hand.",
    sub: "Certified pros and your certificates, tracked.",
    caption: "Compliance dates don't wait for a quiet week. Keep your gas, electrical and EPC checks booked with certified pros — and the certificates in one place. Maintenance, handled.",
    hashtags: ["compliance", "landlords", "propertymanagement", "gassafety"],
    use_photo: true, photo_query: "electrician testing consumer unit uk" },

  { week: 8, scheduled_for: at9("2026-08-10"), product: "trades", bg: "navy", format: "square",
    eyebrow: "SEPTEMBER RUSH", title: "Student season's coming.\nBe the firm they call.",
    sub: "A profile and reviews that win the work.",
    caption: "September fills the diary — if landlords can find and trust you. Build a profile and reviews that win the job, and run it all from one app. Your trade, handled.",
    hashtags: ["tradesperson", "lettings", "reviews", "smallbusinessuk"],
    use_photo: true, photo_query: "handyman toolbox uk doorway" },

  { week: 9, scheduled_for: at9("2026-08-17"), product: "trades", bg: "navy", format: "square",
    eyebrow: "GROW THE FIRM", title: "From sole trader\nto a team that runs itself.",
    sub: "Jobs, crew, quotes and payments in one place.",
    caption: "Growing a trade firm isn't more hours — it's less faff. Put jobs, crew, quotes and payments in one place so the business runs without living in your head. Your trade, handled.",
    hashtags: ["smallbusinessuk", "tradesperson", "growth", "fieldservice"],
    use_photo: false, photo_query: "" },

  { week: 10, scheduled_for: at9("2026-08-24"), product: "fixfy", bg: "navy", format: "square",
    eyebrow: "ONE PLATFORM", title: "Autumn's coming.\nYour properties are ready.",
    sub: "Every trade, every property, one partner.",
    caption: "Get ahead of the autumn list — heating, gutters, damp, the lot. One message, vetted pros, proof on completion, across every property. Maintenance, handled.",
    hashtags: ["facilitiesmanagement", "propertymanagement", "maintenance", "landlords"],
    use_photo: true, photo_query: "autumn uk house gutters roof" },
];

if (!KEY && !DRY) {
  console.error("Missing MASTER_OS_CONTENT_API_KEY. Set it, or run with --dry to preview.");
  process.exit(1);
}

console.log(`${DRY ? "[DRY RUN] " : ""}Seeding ${POSTS.length} social posts → ${APP_URL}/api/social/ingest\n`);

let ok = 0;
for (const p of POSTS) {
  const { week, ...payload } = p;
  payload.platforms = PLATFORMS;
  if (DRY) {
    console.log(`W${week} · ${payload.product} · "${payload.title.replace(/\n/g, " ")}" · photo=${payload.use_photo}`);
    continue;
  }
  try {
    const res = await fetch(`${APP_URL}/api/social/ingest`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": KEY },
      body: JSON.stringify(payload),
    });
    const json = await res.json().catch(() => ({}));
    if (res.ok) {
      ok++;
      console.log(`✓ W${week} queued (id ${json.id})`);
    } else {
      console.error(`✗ W${week} failed (${res.status}): ${json.error || "unknown"}`);
    }
  } catch (e) {
    console.error(`✗ W${week} error: ${e.message}`);
  }
}

if (!DRY) console.log(`\nDone. ${ok}/${POSTS.length} queued. Check your approver inbox for the 1-tap approvals.`);
