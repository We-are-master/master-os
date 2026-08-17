// One-off live diagnostic: map the Checkatrade job COMPLETION flow, so the
// report arm can be written against what is there instead of a guess.
//
// Housekeep was mapped the same way and it paid off twice in one night: two
// required fields were invisible to us until someone read the real form, and
// one of them ("Describe additional work") does not even exist in the DOM until
// another answer is given. Guessing selectors costs a rejected submission and
// one of three attempts; reading the page costs a minute.
//
// STRICTLY READ-ONLY. It opens the job, expands what it can, and prints every
// button, input, file field and dialog it finds. It never clicks anything that
// completes, uploads or confirms — completing a Checkatrade job is a real,
// customer-visible act and belongs to the arm we write next, behind an
// explicit flag, not to a probe.
//
//   npx tsx src/probeCompletion.ts <externalId>
//
// The externalId is the tail of `jobs.report_link` in Master OS, e.g.
// https://membersapp.checkatrade.com/business-jobs/cmst2onea0owms6016vwgm84e
import { loadConfig } from "./config.js";
import { getOrCreateContext } from "./checkatrade/auth.js";
import { detailUrl } from "./checkatrade/booking.js";
import { logger } from "./logger.js";

type Achado = {
  tag: string;
  tipo: string;
  texto: string;
  testid: string;
  aria: string;
  visivel: boolean;
};

async function main(): Promise<void> {
  const externalId = process.argv[2];
  if (!externalId) {
    console.error("usage: npx tsx src/probeCompletion.ts <externalId>");
    process.exit(1);
  }

  const cfg = loadConfig();
  const { browser, page } = await getOrCreateContext(cfg);

  try {
    const url = detailUrl(externalId);
    logger.info(`opening ${url}`);
    await page.goto(url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
    await page.waitForTimeout(2500);

    // O estado do job decide o que a página oferece: um job ainda agendado não
    // mostra a conclusão, e mapear a tela errada é pior do que não mapear.
    const titulo = await page.title();
    const corpo = (await page.locator("body").innerText().catch(() => "")).slice(0, 1200);
    logger.info(`title: ${titulo}`);
    console.log("\n─── texto da página (início) ───\n" + corpo + "\n");

    const achados: Achado[] = await page.evaluate(() => {
      const visivel = (el: Element) => !!(el as HTMLElement).offsetParent;
      const ler = (el: Element): Achado => ({
        tag: el.tagName.toLowerCase(),
        tipo: (el as HTMLInputElement).type ?? "",
        texto: (el.textContent ?? "").trim().replace(/\s+/g, " ").slice(0, 70),
        testid: el.getAttribute("data-testid") ?? "",
        aria: el.getAttribute("aria-label") ?? "",
        visivel: visivel(el),
      });
      return [...document.querySelectorAll("button, a[role=button], input, textarea, select")].map(ler);
    });

    const interessa = (a: Achado) =>
      a.tipo === "file" ||
      /complete|finish|upload|attach|photo|document|invoice|close|done|mark/i.test(
        `${a.texto} ${a.aria} ${a.testid}`,
      );

    console.log("─── candidatos da conclusão ───");
    for (const a of achados.filter(interessa)) {
      console.log(
        `${a.visivel ? "  " : "· "}${a.tag}${a.tipo ? `[${a.tipo}]` : ""} ` +
          `testid="${a.testid}" aria="${a.aria}" texto="${a.texto}"`,
      );
    }

    console.log("\n─── todos os inputs de arquivo ───");
    const arquivos = achados.filter((a) => a.tipo === "file");
    console.log(arquivos.length ? JSON.stringify(arquivos, null, 1) : "nenhum (pode nascer depois de um clique)");

    console.log(`\n─── total: ${achados.length} controles, ${achados.filter(interessa).length} candidatos ───`);
    console.log("· = escondido agora. Campo escondido costuma nascer depois de outra resposta.");
  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  logger.error(`probeCompletion failed: ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
