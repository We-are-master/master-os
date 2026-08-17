import type { Page } from "playwright";
import type { AcceptedSlot, CheckatradeOpportunity } from "./types.js";
import type { SlotSelectionStrategy } from "../config.js";
import { daysBetweenYmd, tzNow, ymdWeekday } from "../time.js";
import { parseLeadContact, parseLeadIdentity, readLeafFields } from "./leadResponse.js";
import { evaluateJob } from "../jobRules.js";

export type AcceptOptions = {
  strategy: SlotSelectionStrategy;
  /** When false, a valid slot is identified but "Accept Job" is NOT clicked (dry run / notify-only). */
  autoAccept: boolean;
  /** Floor that applies to day bookings only — see jobRules.evaluateJob. */
  nonCertMinValue: number;
  /** At or above this a job is chased as PRIORITY: taken first, slot rules relaxed. */
  highValueMin: number;
  /** The card's "Earnings £X", used by the worth-taking rules. */
  priceHint?: number;
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
  | { status: "no_valid_slot"; reason: string }
  /** Failed the worth-taking rules once the detail page revealed what it really is. */
  | { status: "not_worth_taking"; bucket: string; reason: string }
  /** Clicamos aceitar, mas outro trade chegou primeiro. Nada a criar no OS. */
  | { status: "lost_race"; reason: string };

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
/** O selo de status do job. Fora do fluxo de texto, com testid próprio (igual ao do board). */
const STATUS_PILL_SELECTOR = '[data-testid="toolshed-native-status-pill-label"]';

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

  // ── Worth taking? Decide HERE, before the binding click ─────────────────
  // The list card is too thin to tell a day booking ("Handyperson: Full Day
  // (7 Hrs)") from a one-off task ("Curtain Rod Installation") — both are
  // General Maintenance and neither says "handyman". The detail page's title
  // and brief do say it, and this runs before "Accept Job" is ever clicked.
  const detailTitle = await scrapeDetailTitle(page);
  const verdict = evaluateJob(
    [detailTitle, opportunity.category, richDescription, opportunity.description].filter(Boolean).join(" \n "),
    opts.priceHint,
    opts.nonCertMinValue,
    opts.highValueMin,
    undefined,
    undefined,
    // Só os títulos, sem o brief: o gate de elétrica lê isto. Um brief que
    // menciona "socket behind the TV" não pode derrubar um TV mount bom.
    [detailTitle, opportunity.category].filter(Boolean).join(" \n "),
  );
  if (!verdict.ok) {
    return { status: "not_worth_taking", bucket: verdict.bucket, reason: verdict.reason };
  }

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
  //
  // PRIORITY jobs (EICR, and anything at or above the high-value mark) get the
  // restrictions lifted: any weekday, one day's notice. The Tue-Fri /
  // two-days-ahead rule exists to protect a full-day handyperson booking's
  // schedule; a certificate is a short visit and is easy to slot in. Holding
  // EICRs to the day-booking rule dropped them SILENTLY — the job simply never
  // appeared as accepted — on the single most contested thing we want.
  const minDays = verdict.priority ? 1 : opts.minDateDaysAhead;
  const allowedDays = verdict.priority ? [0, 1, 2, 3, 4, 5, 6] : opts.slotDays;

  const todayYmd = tzNow(opts.timezone).ymd;
  const validSlots = allSlots.filter((s) => {
    const daysAhead = daysBetweenYmd(todayYmd, s.date);
    if (!Number.isFinite(daysAhead) || daysAhead < minDays) return false;
    return allowedDays.includes(ymdWeekday(s.date));
  });

  if (validSlots.length === 0) {
    const offered = allSlots.map((s) => s.date).join(", ");
    return {
      status: "no_valid_slot",
      reason:
        `no slot >= ${minDays}d ahead on allowed weekdays [${allowedDays.join(",")}]` +
        `${verdict.priority ? " (PRIORITY, rules already relaxed)" : ""}; offered: ${offered}`,
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

  // ── Ganhamos mesmo? ─────────────────────────────────────────────────────
  // Clicar "Accept Job" não é ganhar: o Express é disputado e outro trade pode
  // ter fechado antes. Quando isso acontece o Checkatrade não recusa nada de
  // forma visível — ele só deixa de revelar o cliente, e o selo do job vira
  // "Taken". O RPA não conferia, então criava no OS um job que nunca foi nosso,
  // sem nome e sem rua (JOB-9440, 15/08/2026, e JOB-9343 antes dele).
  //
  // VERIFICADO 2026-08-17 na mesma sessão, lado a lado:
  //   perdido: selo "Taken - Express Booking" · sidebar ["CE","Checkatrade Express","W10 4BQ"]
  //   ganho:   selo "In progress - Express Booking" · sidebar ["HS","Hind Sebti","SW15 2DX","+44 78735 82089"]
  const selo = (await page.locator(STATUS_PILL_SELECTOR).first().textContent().catch(() => null))?.trim() ?? "";
  if (/^taken\b/i.test(selo)) {
    return { status: "lost_race", reason: `selo do job: "${selo}" — outro trade fechou antes` };
  }

  const fullAddress = await scrapeRevealedAddress(page);
  // Contact is revealed in the sidebar only once the job is accepted. Read it
  // from the app's own leaf nodes (VERIFIED 2026-07-28 on a real accepted job:
  // "TR", "tommy  redhead", "NW3 3QX", "+44 79736 54911", "tommy…@gmail.com"),
  // the same anchor the lead pages use.
  const revealed = await scrapeRevealedContact(page);

  // Segunda trava, para quando o selo não renderiza a tempo: num job nosso o
  // Checkatrade entrega o cliente. Sem nome de gente E sem telefone, não
  // ganhamos — o "Checkatrade Express" da sidebar é o rótulo da plataforma
  // ocupando o lugar do nome, não um cliente chamado assim.
  const nomeEhRotulo = !revealed.name || /^checkatrade\b/i.test(revealed.name.trim());
  if (nomeEhRotulo && !revealed.phone) {
    return {
      status: "lost_race",
      reason: `cliente nao revelado apos aceitar (nome: ${JSON.stringify(revealed.name ?? null)}, sem telefone)`,
    };
  }

  const details = await scrapeAcceptedJobDetails(page, opportunity.externalId);

  return {
    status: "accepted",
    slot: {
      acceptedDate: chosen.date,
      acceptedTimeWindow: chosen.timeWindow,
      // `/information` é a fonte melhor: traz apartamento e prédio, que o
      // link do Google Maps costuma perder.
      fullAddress: details.fullAddress || fullAddress,
      customerName: revealed.name,
      customerPhone: revealed.phone,
      customerEmail: revealed.email,
      customerPostcode: revealed.postcode,
      richTitle: revealed.title,
      richDescription,
      earnings: details.earnings,
      customerNotes: details.customerNotes,
      duration: details.duration,
      parking: details.parking,
    },
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

/**
 * Customer name / postcode / phone / email + the detail page's real title,
 * read from the app's own leaf text nodes.
 *
 * The previous version split `body.innerText` on newlines and required the
 * caller to already know the postcode. Leaf nodes are both more reliable
 * (innerText is outright blind to the equivalent panel on LEAD pages) and
 * self-sufficient — the postcode is discovered rather than passed in.
 *
 * Best-effort throughout: a missing field must never block job creation.
 */
/**
 * The job's real title, e.g. "Handyperson: Full Day (7 Hrs) General Repairs".
 * It sits immediately before the "Message" label. Available BEFORE accepting,
 * unlike the customer contact — which is why the worth-taking rules can run
 * ahead of the binding click.
 */
async function scrapeDetailTitle(page: Page): Promise<string | undefined> {
  try {
    const fields = await readLeafFields(page);
    const i = fields.indexOf("Message");
    return i > 0 ? fields[i - 1] : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Reads the ACCEPTED job's own page, which is a different, richer document
 * from the one the worth-taking rules ran against.
 *
 * Before accepting, Checkatrade shows a teaser: postcode only, boilerplate
 * message, a price hint on the card. Once accepted the page becomes
 * "In progress - Express Booking" and finally states the things the job
 * actually needs (verified against a real accepted job on 2026-08-12,
 * "Half Day Handyperson Time (3.5 Hrs)", 25 Kent Gardens W13 8BU):
 *
 *   Your Earnings          £149.50   exact, Checkatrade's fee already removed
 *   Customer notes         the real brief, not the boilerplate
 *   How much help...       "Up to half a day (3.5 hours)" — the band, stated
 *   Is parking available?  Yes/No — the partner needs to know before leaving
 *
 * Everything here is best-effort. A missing field must never block job
 * creation: the accept already happened and is financially binding, so a
 * failed scrape can only be allowed to cost us data, never the job.
 */
async function scrapeAcceptedJobDetails(page: Page, externalId: string): Promise<{
  earnings?: number;
  customerNotes?: string;
  duration?: string;
  parking?: boolean;
  fullAddress?: string;
}> {
  try {
    // `/information` é a página por trás do link "View all job information", e
    // é o ÚNICO lugar onde o endereço completo aparece. A barra lateral do job
    // aceito mostra só o postcode ("N5 1PZ"); aqui vem "Flat 5, Manning House,
    // Fieldway Crescent, London, N5 1PZ". Navegar direto em vez de clicar
    // porque o link não tem testid e o texto do botão é só "View".
    await page.goto(`https://membersapp.checkatrade.com/business-jobs/${externalId}/information`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});

    const campos = await readLeafFields(page);
    // O endereço é a linha que tem vírgula E postcode. O postcode sozinho
    // aparece em outros lugares da página, a vírgula é o que separa.
    const fullAddress = campos.find(
      (f) => /,/.test(f) && /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.test(f),
    );

    const text = await page.locator("body").innerText();

    // Ancorado na etiqueta "Your Earnings" porque a página carrega outros
    // valores em libras, e pegar o número errado despreçaria o job em silêncio.
    const earningsRaw = text.match(/Your Earnings\s*\n?\s*£\s*([\d,]+(?:\.\d{2})?)/i)?.[1];
    const earnings = earningsRaw ? Number(earningsRaw.replace(/,/g, "")) : undefined;

    const customerNotes = text
      .match(/Customer notes(?:\s*\n.*?)?\n([\s\S]+?)\n(?:How much help|Is parking|Your Earnings)/i)?.[1]
      ?.trim();

    const duration = text.match(/How much help do you need\?\s*\n(.+)/i)?.[1]?.trim();

    const parkingRaw = text.match(/Is parking available\?\s*\n(\w+)/i)?.[1];
    const parking = parkingRaw ? /^yes$/i.test(parkingRaw) : undefined;

    return { earnings, customerNotes, duration, parking, fullAddress };
  } catch {
    return {};
  }
}

async function scrapeRevealedContact(page: Page): Promise<{
  name?: string;
  postcode?: string;
  phone?: string;
  email?: string;
  title?: string;
}> {
  try {
    const fields = await readLeafFields(page);
    const { name, postcode } = parseLeadIdentity(fields);
    const { phone, email } = parseLeadContact(fields);
    // The title sits immediately before the "Message" label, after the page
    // heading and (on an accepted job) the "Mark job as complete" action.
    const msgIdx = fields.indexOf("Message");
    const title = msgIdx > 0 ? fields[msgIdx - 1] : undefined;
    return { name, postcode, phone, email, title };
  } catch {
    return {};
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
