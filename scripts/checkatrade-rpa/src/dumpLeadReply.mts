// Abre um lead e mostra COMO responder, sem responder.
//
// Só leitura: nada é clicado, nada é enviado, e a sessão não é salva de volta
// (`storageState` entra como input e nunca como output), para não competir com
// o `.state/storage-state.json` que o RPA usa enquanto roda.
//
//   npx tsx src/dumpLeadReply.mts <leadId>
import { chromium } from "playwright";

const LEAD = process.argv[2];
if (!LEAD) throw new Error("uso: npx tsx src/dumpLeadReply.mts <leadId>");

// Headful sob Xvfb, como o RPA. Em headless o Checkatrade devolve a tela de
// login mesmo com sessão válida, porque detecta o navegador automatizado.
const browser = await chromium.launch({ headless: process.env.RPA_HEADLESS === "true" });
const context = await browser.newContext({ storageState: ".state/storage-state.json" });
const page = await context.newPage();

await page.goto(`https://membersapp.checkatrade.com/jobs/${LEAD}`, { waitUntil: "domcontentloaded" });
await page.waitForTimeout(6000);

console.log("URL final:", page.url());
console.log("Título:", await page.title());

const corpo = (await page.locator("body").innerText().catch(() => "")).replace(/\n{3,}/g, "\n\n");
console.log("\n──────── TEXTO DA PÁGINA ────────");
console.log(corpo.slice(0, 2500));

console.log("\n──────── CAMPOS DE TEXTO ────────");
for (const sel of ["textarea", 'input[type="text"]', '[contenteditable="true"]']) {
  const n = await page.locator(sel).count();
  for (let i = 0; i < n; i++) {
    const el = page.locator(sel).nth(i);
    const ph = await el.getAttribute("placeholder").catch(() => null);
    const aria = await el.getAttribute("aria-label").catch(() => null);
    const vis = await el.isVisible().catch(() => false);
    console.log(`  ${sel}[${i}] visível=${vis} placeholder=${ph ?? "-"} aria=${aria ?? "-"}`);
  }
}

console.log("\n──────── BOTÕES ────────");
const bn = await page.locator("button, a[role=button]").count();
for (let i = 0; i < Math.min(bn, 40); i++) {
  const b = page.locator("button, a[role=button]").nth(i);
  const t = (await b.innerText().catch(() => "")).replace(/\s+/g, " ").trim();
  if (t && (await b.isVisible().catch(() => false))) console.log(`  "${t}"`);
}

await page.screenshot({ path: ".state/lead-reply.png", fullPage: true });
console.log("\nscreenshot em .state/lead-reply.png");
await browser.close();
