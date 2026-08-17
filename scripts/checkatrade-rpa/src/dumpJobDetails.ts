/**
 * Lê a página "View all job information" de um Express job já aceito.
 *
 * O painel do job mostra só o postcode na barra lateral. A rua e o número
 * ficam atrás do link "View all job information", que é onde o Checkatrade
 * finalmente entrega o endereço para quem já se comprometeu com o trabalho.
 *
 *   npx tsx src/dumpJobDetails.ts <externalId> [<externalId> ...]
 */
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { readLeafFields } from "./checkatrade/leadResponse.js";

async function main(): Promise<void> {
  const ids = process.argv.slice(2);
  if (!ids.length) throw new Error("usage: tsx src/dumpJobDetails.ts <externalId> [...]");
  const cfg = await loadConfig();
  const { context } = await getOrCreateContext(cfg);
  const page = await context.newPage();

  for (const externalId of ids) {
    await page.goto(`https://membersapp.checkatrade.com/business-jobs/${externalId}?source=express`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(2500);

    // O link fica num cartão "Job details"; o texto visível é "View".
    const alvo = page.getByText("View all job information", { exact: false }).first();
    if (await alvo.isVisible().catch(() => false)) {
      await alvo.click().catch(() => {});
    } else {
      await page.getByRole("link", { name: /^view$/i }).first().click().catch(() => {});
    }
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    await page.waitForTimeout(1500);

    const campos = await readLeafFields(page);
    // Uma linha com vírgula e postcode é o endereço; o resto do dump é ruído.
    const endereco = campos.find((f) => /,/.test(f) && /[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.test(f));
    console.log(`\n=== ${externalId} ===`);
    console.log(`URL: ${page.url()}`);
    console.log(`ENDERECO: ${endereco ?? "(não encontrado)"}`);
    for (const [i, f] of campos.entries()) {
      if (/[A-Z]{1,2}\d[A-Z\d]?\s?\d[A-Z]{2}/i.test(f) || /road|street|avenue|lane|close|way|gardens|court|house|flat/i.test(f)) {
        console.log(`  [${i}] ${f.slice(0, 100)}`);
      }
    }
  }
  await page.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
