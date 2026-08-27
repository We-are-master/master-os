/**
 * O braço que conclui o job no Checkatrade.
 *
 * Existe aqui, e não na Stefane, porque concluir exige a sessão auth0 — que
 * mora neste processo e em nenhum outro lugar. A Stefane faz POST de formulário
 * na Housekeep e não tem navegador; pedir a ela que abrasse o members app seria
 * pedir um segundo Chromium disputando a mesma sessão, que derruba os dois.
 *
 * Pelo mesmo motivo isto roda DENTRO do ciclo do `index.ts`, com a `page` que já
 * está aberta. Nenhum navegador novo, nenhuma disputa.
 *
 * O trabalho vem pronto do OS: `filaDeConclusao()` devolve só job com relatório
 * validado, link de members app legível e foto assinada, e já respeita o teto de
 * três tentativas. Aqui não se decide o que concluir, só se conclui.
 *
 * ─── MODOS ───────────────────────────────────────────────────────────────────
 *
 *   off   não faz nada. É o padrão, e é onde ele nasce.
 *   map   abre o job e imprime os controles que encontrar. NÃO clica em nada.
 *   live  conclui de verdade.
 *
 * `map` existe porque o formulário depois de "Mark job as complete" nunca foi
 * lido por ninguém. O que se sabe hoje, de leitura ao vivo, é só que a ação
 * existe na página de um job aceito (veja `booking.ts`). Escrever os cliques
 * seguintes por dedução é o erro que a Housekeep já cobrou: dois campos
 * obrigatórios eram invisíveis até alguém abrir a tela, e um deles nem existe no
 * DOM antes de outra resposta ser dada. Ler a página custa um minuto; adivinhar
 * custa uma submissão recusada e uma das três tentativas.
 */
import type { Page } from "playwright";
import type { RpaConfig } from "../config.js";
import type { ItemDaFila, MasterOsClient } from "../masterOs/client.js";
import { logger } from "../logger.js";
import { mapearPedidoDePagamento } from "./requestPayment.js";

/** Texto da ação que abre a conclusão, confirmado ao vivo em job aceito. */
const ACAO_CONCLUIR = /mark job as complete/i;

type Controle = {
  tag: string;
  tipo: string;
  texto: string;
  testid: string;
  aria: string;
};

/**
 * Tudo que a página oferece agora, sem tocar em nada.
 *
 * Serve ao modo `map` e ao diagnóstico de uma falha em `live`: quando um clique
 * não acha o que esperava, o log traz a tela inteira em vez de um timeout de
 * seletor, que não diz nada a quem for consertar amanhã.
 */
async function lerControles(page: Page): Promise<Controle[]> {
  // Código como STRING de propósito: o tsx (esbuild) instrumenta arrow
  // functions com um helper `__name` que não existe no contexto da página, e
  // o evaluate explodia com "ReferenceError: __name is not defined" antes de
  // ler o primeiro controle. String não é instrumentada.
  return page.evaluate(`(() => {
    const visivel = (el) => !!el.offsetParent;
    const alvos = Array.from(
      document.querySelectorAll("button, a[role=button], input, select, textarea, [role=dialog] *[role=button]"),
    );
    return alvos.filter(visivel).map((el) => ({
      tag: el.tagName.toLowerCase(),
      tipo: el.type ?? "",
      texto: (el.textContent ?? "").trim().slice(0, 80),
      testid: el.getAttribute("data-testid") ?? "",
      aria: el.getAttribute("aria-label") ?? "",
    }));
  })()`) as Promise<Controle[]>;
}

/** Abre o job e conta o que viu. Não clica. */
async function mapear(page: Page, item: ItemDaFila): Promise<void> {
  await page.goto(item.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const controles = await lerControles(page);
  const conclusao = controles.filter((c) => ACAO_CONCLUIR.test(c.texto) || ACAO_CONCLUIR.test(c.aria));

  logger.info(`[completion:map] ${item.reference} (${item.externalId})`, {
    url: page.url(),
    controlesVisiveis: controles.length,
    acaoDeConcluir: conclusao.length > 0 ? conclusao : "NAO ENCONTRADA",
    fotosProntas: item.fotos.length,
    ehCertificado: item.ehCertificado,
  });
  // A lista inteira vai para o stdout, não para o log estruturado: ela é longa e
  // serve para uma pessoa ler uma vez, não para ficar no arquivo.
  console.log(`\n─── controles em ${item.reference} ───`);
  for (const c of controles) {
    console.log(`  ${c.tag}${c.tipo ? `[${c.tipo}]` : ""}  "${c.texto}"  testid=${c.testid}  aria=${c.aria}`);
  }
  console.log("");

  /**
   * Segundo nível do mapa (17/08/2026): CLICA em "Mark job as complete" e lê
   * o que abrir — sem tocar em nada lá dentro. O primeiro nível provou que o
   * botão existe; escrever o `concluir` exige saber o formulário atrás dele.
   * O print vai para .logs/ porque descrição de controle não substitui olho.
   */
  if (conclusao.length > 0) {
    await page.getByText(ACAO_CONCLUIR).first().click({ timeout: 8_000 }).catch(() => {});
    await page.waitForTimeout(2_500);
    const depois = await lerControles(page);
    console.log(`─── depois do clique em "Mark job as complete" (${item.reference}) ───`);
    for (const c of depois) {
      console.log(`  ${c.tag}${c.tipo ? `[${c.tipo}]` : ""}  "${c.texto}"  testid=${c.testid}  aria=${c.aria}`);
    }
    console.log("");
    await page
      .screenshot({ path: `/Users/victorsouza/checkatrade-rpa/.logs/completion-map-${item.reference}.png`, fullPage: true })
      .catch(() => {});
    // Sai da tela sem confirmar nada: Escape fecha modal; se navegou, volta.
    await page.keyboard.press("Escape").catch(() => {});
    await page.goBack({ waitUntil: "domcontentloaded" }).catch(() => {});
  }
}

/**
 * Conclui de verdade.
 *
 * Ainda não implementado, e falhar alto é melhor do que tentar: o mapa do
 * formulário depois de "Mark job as complete" não existe, e um clique cego numa
 * tela que o cliente vê não se desfaz. Rode `COMPLETION_MODE=map` uma vez, leia
 * a saída, e os passos entram aqui com seletor conferido.
 */
async function concluir(page: Page, item: ItemDaFila): Promise<{ ok: boolean; motivo?: string }> {
  await page.goto(item.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});

  const botao = page.getByText(ACAO_CONCLUIR).first();
  if (!(await botao.isVisible({ timeout: 10_000 }).catch(() => false))) {
    const controles = await lerControles(page);
    logger.warn(`[completion] ${item.reference}: acao de concluir nao esta na pagina`, {
      url: page.url(),
      controles: controles.map((c) => c.texto).filter(Boolean).slice(0, 25),
    });
    return { ok: false, motivo: "completion action not on the page" };
  }

  /**
   * O fluxo real, mapeado ao vivo no JOB-9406 (17/08/2026, print em .logs/):
   * "Mark job as complete" abre uma bottom sheet com "Add photos" (imagem),
   * "Add documents" (PDF — certificado entra aqui) e um "Complete job" que
   * NASCE DESABILITADO e só acende depois de pelo menos um upload. Concluir
   * libera o pagamento do lado deles, então a confirmação final exige prova:
   * a sheet fechada E a ação sumida da página recarregada.
   */
  await botao.click({ timeout: 8_000 });
  const SUBMIT = '[data-testid="BusinessJobCompleteBottomSheet-submit-button"]';
  if (!(await page.locator(SUBMIT).isVisible({ timeout: 8_000 }).catch(() => false))) {
    return { ok: false, motivo: "completion sheet did not open" };
  }

  // Baixa as fotos assinadas para arquivos temporários — o file chooser da
  // página só aceita caminho local.
  const { mkdtempSync, writeFileSync, rmSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const pasta = mkdtempSync(join(tmpdir(), "conclusao-"));
  const imagens: string[] = [];
  const documentos: string[] = [];
  try {
    for (let i = 0; i < Math.min(item.fotos.length, 10); i++) {
      const r = await fetch(item.fotos[i]);
      if (!r.ok) continue;
      const tipo = r.headers.get("content-type") ?? "";
      const ehPdf = /pdf/i.test(tipo) || /\.pdf(\?|$)/i.test(item.fotos[i]);
      const caminho = join(pasta, `anexo-${i}.${ehPdf ? "pdf" : "jpg"}`);
      writeFileSync(caminho, Buffer.from(await r.arrayBuffer()));
      (ehPdf ? documentos : imagens).push(caminho);
    }
    if (imagens.length === 0 && documentos.length === 0) {
      return { ok: false, motivo: "could not download any report photo to attach" };
    }

    // Cada botão abre um file chooser do sistema; o anexo entra por ele.
    const anexar = async (rotuloTestid: string, arquivos: string[]) => {
      if (arquivos.length === 0) return;
      const escolha = page.waitForEvent("filechooser", { timeout: 10_000 });
      await page.locator(`[data-testid="${rotuloTestid}"]`).click({ timeout: 8_000 });
      await (await escolha).setFiles(arquivos);
      await page.waitForTimeout(2_500);
    };
    await anexar("add-photos-button", imagens);
    await anexar("AddFilesButton-button", documentos);
    logger.info(
      `[completion] ${item.reference}: anexado ${imagens.length} foto(s) + ${documentos.length} documento(s) do relatório`,
      { fontes: item.fotos.slice(0, 10).map((u) => u.split("?")[0].split("/").slice(-2).join("/")) },
    );

    // "Complete job" acende quando o upload assentou. Espera ATIVA, não fixa:
    // upload de certificado às vezes leva mais que a folga de um sleep.
    let habilitado = false;
    for (let i = 0; i < 20; i++) {
      if (await page.locator(SUBMIT).isEnabled().catch(() => false)) { habilitado = true; break; }
      await page.waitForTimeout(1_500);
    }
    if (!habilitado) {
      return { ok: false, motivo: "Complete job stayed disabled after upload — attachment did not register" };
    }

    /**
     * Prova do anexo ANTES do submit, a pedido do dono: "não podemos errar".
     * O botão aceso já é o formulário dizendo que recebeu upload, e o print
     * fica em .logs/ como evidência do QUE estava na sheet no instante do
     * clique — auditável depois, job a job.
     */
    await page
      .screenshot({ path: `/Users/victorsouza/checkatrade-rpa/.logs/completion-${item.reference}-antes-do-submit.png`, fullPage: false })
      .catch(() => {});

    await page.locator(SUBMIT).click({ timeout: 8_000 });

    // Prova positiva, lição da Housekeep: sheet fechada + página recarregada
    // SEM a ação de concluir. Qualquer coisa aquém disso é "não sei", e "não
    // sei" aqui vira falso verde com pagamento no meio.
    let sheetFechou = false;
    for (let i = 0; i < 10; i++) {
      await page.waitForTimeout(1_500);
      if (!(await page.locator(SUBMIT).isVisible().catch(() => false))) { sheetFechou = true; break; }
    }
    if (!sheetFechou) {
      const controles = await lerControles(page);
      return {
        ok: false,
        motivo: `sheet still open after Complete job — ${controles.map((c) => c.texto).filter(Boolean).slice(0, 6).join(" · ")}`,
      };
    }
    await page.goto(item.url, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("networkidle", { timeout: 15_000 }).catch(() => {});
    if (await page.getByText(ACAO_CONCLUIR).first().isVisible({ timeout: 5_000 }).catch(() => false)) {
      return { ok: false, motivo: "job page still offers Mark job as complete after submitting" };
    }
    return { ok: true };
  } finally {
    rmSync(pasta, { recursive: true, force: true });
  }
}

/**
 * Um ciclo do braço. Chamado de dentro do loop, dentro da janela de horário.
 *
 * Nunca lança: uma falha aqui não pode parar a colheita de lead, que é o que
 * paga a conta. Cada job responde por si, e o motivo vai para o OS contar a
 * tentativa.
 */
export async function rodarConclusoes(
  page: Page,
  cfg: RpaConfig,
  masterOs: MasterOsClient,
): Promise<void> {
  const modo = cfg.completion.mode;
  if (modo === "off") return;

  let fila: ItemDaFila[];
  try {
    const r = await masterOs.filaDeConclusao();
    fila = r.fila;
  } catch (err) {
    logger.warn(`[completion] nao consegui ler a fila: ${String(err)}`);
    return;
  }

  if (fila.length === 0) return;
  logger.info(`[completion] ${fila.length} job(s) esperando conclusao (modo: ${modo})`);

  for (const item of fila.slice(0, cfg.completion.maxPerCycle)) {
    try {
      if (modo === "map") {
        await mapear(page, item);
        continue; // mapear não conclui, então não há resultado a registrar
      }
      const r = await concluir(page, item);
      await masterOs.registrarConclusao(item.jobId, r.ok, r.motivo);
      logger.info(`[completion] ${item.reference}: ${r.ok ? "concluido" : `falhou — ${r.motivo}`}`);
      /**
       * Material do report vira pedido de pagamento extra DEPOIS da conclusão.
       * Por ora só o mapa (REQUEST_PAYMENT_MODE=map): lista a tela e tira
       * print, sem clicar em nada que cobre o cliente. O live nasce quando o
       * mapa for conferido — dinheiro de verdade não se clica no escuro.
       */
      if (r.ok && cfg.completion.requestPaymentMode === "map" && Number(item.extraCobranca ?? 0) > 0) {
        await mapearPedidoDePagamento(page, item).catch((err) =>
          logger.warn(`[request-payment:map] ${item.reference} falhou: ${String(err).slice(0, 200)}`),
        );
      }
    } catch (err) {
      const motivo = String(err).slice(0, 300);
      logger.error(`[completion] ${item.reference} explodiu`, err);
      // Registrar a falha é o que faz a tentativa contar. Sem isso, um job
      // quebrado voltaria à fila para sempre.
      await masterOs.registrarConclusao(item.jobId, false, motivo).catch(() => {});
    }
  }
}
