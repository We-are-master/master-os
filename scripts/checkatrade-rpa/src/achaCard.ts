/** One-off: acha um card por texto (postcode etc.) nos boards de jobs. Uso: tsx src/achaCard.ts "EN3 6GN" */
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";

async function main(): Promise<void> {
  const alvo = process.argv[2];
  if (!alvo) throw new Error("uso: tsx src/achaCard.ts <texto>");
  const cfg = loadConfig();
  const { context, browser } = await getOrCreateContext(cfg);
  const page = await context.newPage();
  try {
    for (const url of [
      "https://membersapp.checkatrade.com/jobs/all",
      "https://membersapp.checkatrade.com/jobs/business",
    ]) {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60_000 });
      await page.waitForTimeout(4000);
      const cards = await page.evaluate(`
        Array.from(document.querySelectorAll('[data-testid^="job-card-v2-"]')).map((el) => ({
          id: (el.getAttribute("data-testid") || "").replace("job-card-v2-", ""),
          texto: el.innerText.replace(/\\n/g, " | "),
        }))
      `) as Array<{ id: string; texto: string }>;
      for (const c of cards) {
        if (c.texto.toLowerCase().includes(alvo.toLowerCase())) {
          console.log(`ACHOU em ${url}: ${c.id}`);
          console.log(`  ${c.texto.slice(0, 220)}`);
        }
      }
    }
  } finally {
    await page.close();
    await browser.close();
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
