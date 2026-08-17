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
  return page.evaluate(() => {
    const visivel = (el: Element) => !!(el as HTMLElement).offsetParent;
    const alvos = Array.from(
      document.querySelectorAll("button, a[role=button], input, select, textarea, [role=dialog] *[role=button]"),
    );
    return alvos.filter(visivel).map((el) => ({
      tag: el.tagName.toLowerCase(),
      tipo: (el as HTMLInputElement).type ?? "",
      texto: (el.textContent ?? "").trim().slice(0, 80),
      testid: el.getAttribute("data-testid") ?? "",
      aria: el.getAttribute("aria-label") ?? "",
    }));
  });
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

  return {
    ok: false,
    motivo:
      "completion form not mapped yet — run COMPLETION_MODE=map once and fill in the steps",
  };
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
    } catch (err) {
      const motivo = String(err).slice(0, 300);
      logger.error(`[completion] ${item.reference} explodiu`, err);
      // Registrar a falha é o que faz a tentativa contar. Sem isso, um job
      // quebrado voltaria à fila para sempre.
      await masterOs.registrarConclusao(item.jobId, false, motivo).catch(() => {});
    }
  }
}
