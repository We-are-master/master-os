/**
 * One-off backfill: leads that already got "I'm interested" clicked during
 * testing (so they're no longer "New" and the normal poll loop will never
 * revisit them) but never got a Master OS record — or got one with
 * corrupted data from the textContent()-vs-innerText() bug, since deleted.
 *
 * Usage: npx tsx src/backfill.ts
 */
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { MasterOsApiError, createMasterOsClient } from "./masterOs/client.js";
import { hasSeen, markSeen } from "./dedupe/seenStore.js";
import { logger } from "./logger.js";

const EXTERNAL_IDS = [
  "019f317f-6cb5-75b3-b67e-d1164d4cdf56", // Johanna Donovan
  "019f36b2-7776-795d-b409-cee8732a8371",
  "019f36a0-8c1b-775b-84a8-a2db72859ff9",
  "019f3695-8490-7b95-940e-3af2dee3ec94",
  "019f3653-14f3-7af8-a0f4-5143f4da1e5a", // Bonnie Huang
  "019f2cde-9203-79c9-abc9-32b1c543e210", // Camilla Bird
  "019f320c-bf4e-7863-acca-416138a2603b", // Alexander Mitteregger
  "019f31f1-611f-71b5-b906-8f3dcb5d08a1", // chi ho har
  "019f2e06-57d8-7190-be27-c039c7147c5e", // "Emergency Handyman Service"
];

type BackfillLead = {
  category?: string;
  name?: string;
  location?: string;
  postcode?: string;
  message?: string;
  appointmentNote?: string;
  phone?: string;
  email?: string;
};

/** Full scrape from a lead's OWN detail page — no list-card data needed. */
async function scrapeLeadDetail(text: string): Promise<BackfillLead> {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const category = lines[1];
  const message = text.match(/^Message\n.*\n([\s\S]+?)\n\nAppointments/m)?.[1]?.trim();
  const appointmentNote = text.match(/^Appointments\n(?:Create\n)?([\s\S]+?)\n\n/m)?.[1]?.trim();
  const phone = text.match(/\+44\s?\d[\d\s]{8,}\d/)?.[0]?.trim();
  const email = text.match(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*\.[a-zA-Z]{2,24}/)?.[0];
  const postcodeIdx = lines.findIndex((l) => /\b[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}\b/.test(l));
  const location = postcodeIdx >= 0 ? lines[postcodeIdx] : undefined;
  const name = postcodeIdx > 0 ? lines[postcodeIdx - 1] : undefined;
  const postcode = location?.match(/\b([A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2})\b/)?.[0];
  return { category, name, location, postcode, message, appointmentNote, phone, email };
}

async function main(): Promise<void> {
  const cfg = loadConfig();
  const masterOs = createMasterOsClient(cfg);
  const { browser, context, page } = await getOrCreateContext(cfg);

  for (const externalId of EXTERNAL_IDS) {
    if (await hasSeen(externalId)) {
      logger.info(`Skipping ${externalId} — already in seen.json`);
      continue;
    }
    try {
      await page.goto(`https://membersapp.checkatrade.com/jobs/${externalId}`, { waitUntil: "domcontentloaded" });
      await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
      const text = await page.locator("body").innerText();
      const lead = await scrapeLeadDetail(text);

      if (!lead.name || !lead.location) {
        logger.error(`Could not parse lead ${externalId} — skipping (dump below)`, new Error(text.slice(0, 500)));
        continue;
      }

      const mappedCategory =
        Object.entries(cfg.categoryMap).find(([k]) => k.toLowerCase() === (lead.category ?? "").toLowerCase())?.[1] ??
        lead.category ??
        cfg.fallbackCategory;
      const payload = {
        name: lead.name,
        address: lead.location,
        postcode: lead.postcode,
        phone: lead.phone,
        email: lead.email,
        scope: [lead.message, lead.appointmentNote].filter(Boolean).join("\n\n"),
        service_type: mappedCategory,
      };
      let res;
      try {
        res = await masterOs.createLead(payload);
      } catch (err) {
        const isUnknownServiceType =
          err instanceof MasterOsApiError && err.status === 400 && /did not match any active Services catalog/.test(err.body);
        if (!isUnknownServiceType) throw err;
        logger.warn(`Unmapped category "${lead.category}" — retrying with fallbackCategory`, { externalId });
        res = await masterOs.createLead({ ...payload, service_type: cfg.fallbackCategory });
      }
      await markSeen(externalId, { kind: "lead", masterOsId: res.id });
      logger.info("Backfilled lead", { externalId, reference: res.reference, name: lead.name });
    } catch (err) {
      logger.error(`Backfill failed for ${externalId}`, err);
    }
  }

  await context.close();
  await browser.close();
}

main().catch((err) => {
  logger.error("Fatal backfill error", err);
  process.exit(1);
});
