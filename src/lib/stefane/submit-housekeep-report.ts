/**
 * STEFANE — preenche e submete o job report na Housekeep.
 *
 * Roda com Playwright porque o formulário é uma página React sem API pública.
 * É lento por natureza: 8 a 12 segundos sem foto, 25 a 35 com meia dúzia, e o
 * upload é quem manda no número. Por isso quem chama grava
 * `external_report_started_at` antes e devolve na hora, deixando o card mostrar
 * "enviando" enquanto isto corre.
 *
 * Nada aqui é chamado por varredura, só pelo botão. Em 2026-08-13 a fila tinha
 * dez jobs concluídos de semanas atrás, e submeter relatório retroativo em cima
 * de um que já foi entregue à mão cria confusão do lado deles.
 */
import { chromium, type Page } from "playwright";
import {
  FEEDBACK,
  HOUSEKEEP_CAMPOS,
  HOUSEKEEP_FOTOS,
  HOUSEKEEP_LIMPEZA,
  NAO,
  SIM,
  formaDoFormulario,
  type PayloadHousekeep,
  type PayloadLimpeza,
} from "./housekeep-report-form";

/** Fotos de um envio: antes e depois, na ordem dos dois blocos do formulário. */
export type FotosDoEnvio = { antes: string[]; depois: string[] };

/** Anexo pronto para o `setInputFiles`, já em memória. */
type Anexo = { name: string; mimeType: string; buffer: Buffer };

const TIPOS_ACEITOS = /^image\//;

/**
 * Baixa as fotos do nosso bucket e devolve em memória.
 *
 * O input da Housekeep é `accept="image/*"`, então PDF (certificado) é
 * descartado aqui em vez de ser recusado lá. Falha de download não derruba o
 * envio: relatório com foto a menos ainda é melhor que relatório nenhum, e o
 * que ficou de fora vai para o log.
 */
async function baixarFotos(urls: string[], prefixo: string): Promise<Anexo[]> {
  const out: Anexo[] = [];
  for (let i = 0; i < urls.length && out.length < HOUSEKEEP_FOTOS.maximoPorBloco; i++) {
    const url = urls[i];
    try {
      const r = await fetch(url);
      if (!r.ok) {
        console.error(`[stefane] foto ${prefixo} ${i} respondeu ${r.status}`);
        continue;
      }
      const mimeType = r.headers.get("content-type")?.split(";")[0]?.trim() || "image/jpeg";
      if (!TIPOS_ACEITOS.test(mimeType)) continue;
      out.push({
        name: `${prefixo}-${i + 1}.${mimeType.includes("png") ? "png" : "jpg"}`,
        mimeType,
        buffer: Buffer.from(await r.arrayBuffer()),
      });
    } catch (err) {
      console.error(`[stefane] foto ${prefixo} ${i} não baixou:`, err);
    }
  }
  if (urls.length > HOUSEKEEP_FOTOS.maximoPorBloco) {
    console.warn(
      `[stefane] ${prefixo}: ${urls.length} fotos, a Housekeep aceita ${HOUSEKEEP_FOTOS.maximoPorBloco}. ` +
        `${urls.length - HOUSEKEEP_FOTOS.maximoPorBloco} ficaram de fora.`,
    );
  }
  return out;
}

/** Põe os arquivos no bloco de índice `indice` (0 = antes, 1 = depois). */
async function anexarBloco(page: Page, indice: number, anexos: Anexo[]): Promise<void> {
  if (anexos.length === 0) return;
  const inputs = page.locator(HOUSEKEEP_FOTOS.seletor);
  if ((await inputs.count()) <= indice) {
    console.error(`[stefane] bloco de foto ${indice} não existe nesta página`);
    return;
  }
  await inputs.nth(indice).setInputFiles(anexos, { timeout: 60_000 });
}

export type ResultadoEnvio =
  /** `jaEstava` = a plataforma já tinha o relatório; ninguém submeteu nada agora. */
  | { ok: true; forma: "trade" | "limpeza"; segundos: number; jaEstava?: boolean }
  | { ok: false; motivo: string; segundos: number };

/**
 * Abre todas as seções recolhidas do formulário.
 *
 * A página é uma sanfona de quatro blocos — Job details, Start job, Finish job,
 * Feedback — e só o primeiro par vem aberto. `page.fill` recusa campo invisível,
 * então sem isto o preenchimento morria no primeiro campo da seção fechada, que
 * é justamente "Finish time". Foi o que impediu qualquer envio até hoje.
 *
 * Abrir é só apertar o `h5.collapsible`, que carrega o `aria-expanded`.
 */
async function abrirTodasAsSecoes(page: Page): Promise<void> {
  const cabecalhos = page.locator("h5.collapsible");
  const total = await cabecalhos.count();
  for (let i = 0; i < total; i++) {
    const h = cabecalhos.nth(i);
    if ((await h.getAttribute("aria-expanded")) === "true") continue;
    try {
      await h.click({ timeout: 5000 });
      await page.waitForTimeout(300);
    } catch {
      // Uma seção que não abre vira erro de campo lá embaixo, com nome e tudo.
      // Falhar aqui só trocaria uma mensagem clara por uma genérica.
    }
  }
}

/** Marca um radio pelo prefixo do id (`vxowxmk0gvz2` → `vxowxmk0gvz2-2`). */
async function marcarRadio(page: Page, prefixo: string, indice: number): Promise<void> {
  // `[id="..."]` e não `#...`: os ids da Housekeep começam com dígito, e o
  // seletor `#9vzq…` é inválido em CSS.
  const el = page.locator(`[id="${prefixo}-${indice}"]`);
  // `check()` falha em input escondido atrás de um label estilizado, que é o
  // caso aqui; clicar no label é o caminho que o usuário real percorre.
  const label = page.locator(`label[for="${prefixo}-${indice}"]`);
  if (await label.count()) await label.first().click({ timeout: 5000 });
  else await el.first().check({ timeout: 5000, force: true });
}

async function preencherTrade(page: Page, p: PayloadHousekeep): Promise<void> {
  if (p.inicio) await page.fill(HOUSEKEEP_CAMPOS.inicio.seletor, p.inicio);
  if (p.fim) await page.fill(HOUSEKEEP_CAMPOS.fim.seletor, p.fim);
  await page.fill(HOUSEKEEP_CAMPOS.descricao.seletor, p.descricao);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.recomendaServicos.prefixo, p.recomendaServicos ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.cobrancaExtra.prefixo, p.cobrancaExtra ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.conclusao.prefixo, p.conclusao);
  if (p.faltaFazer) await page.fill(HOUSEKEEP_CAMPOS.faltaFazer.seletor, p.faltaFazer);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.precisaRetorno.prefixo, p.precisaRetorno ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.feedback.prefixo, p.feedback ?? FEEDBACK.bom);
}

async function preencherLimpeza(page: Page, p: PayloadLimpeza): Promise<void> {
  if (p.inicio) await page.fill(HOUSEKEEP_CAMPOS.inicio.seletor, p.inicio);
  if (p.fim) await page.fill(HOUSEKEEP_CAMPOS.fim.seletor, p.fim);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.escopoMudou.prefixo, p.escopoMudou ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.danoPrevio.prefixo, p.danoPrevio ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.recusouFotos.prefixo, p.recusouFotos ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.recomendaServicos.prefixo, p.recomendaServicos ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.jobCompleto.prefixo, p.jobCompleto ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.clienteInspecionou.prefixo, p.clienteInspecionou ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.feedback.prefixo, p.feedback ?? FEEDBACK.bom);
}

/**
 * Abre o link, confere que é o formulário esperado, preenche e submete.
 *
 * `simular: true` faz tudo menos apertar Submit. É como se testa sem reportar
 * trabalho de mentira para a Housekeep, e deve ser o padrão de qualquer
 * primeira execução em job real.
 */
export async function submeterRelatorioHousekeep(args: {
  url: string;
  payload: PayloadHousekeep | PayloadLimpeza;
  fotos?: FotosDoEnvio;
  simular?: boolean;
}): Promise<ResultadoEnvio> {
  const t0 = Date.now();
  const seg = () => Math.round((Date.now() - t0) / 100) / 10;

  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 30_000 });
    await page.waitForTimeout(2500);

    const texto = await page.locator("body").innerText();
    const ids = (
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("input,textarea")).map(
          (el) => (el as HTMLElement).id || (el as HTMLInputElement).name || "",
        ),
      )
    ).filter(Boolean);

    // Já submetido do outro lado: não é erro, é trabalho que alguém já fez.
    // Precisa vir antes da checagem de formulário, porque a página pós-envio
    // não tem campo nenhum e senão seria reportada como "formulário mudou".
    const semCampos = ids.length === 0;
    if (/report submitted|already submitted|thank you|received your report/i.test(texto) || semCampos) {
      return { ok: true, forma: "trade", segundos: seg(), jaEstava: true };
    }

    const forma = formaDoFormulario(ids);
    if (!forma) {
      // Tem campos, mas nenhum que a gente conhece: aí sim o formulário mudou.
      return {
        ok: false,
        motivo: `formulário da Housekeep mudou: ${ids.length} campos na página, nenhum conhecido`,
        segundos: seg(),
      };
    }

    await abrirTodasAsSecoes(page);

    if (forma === "trade") await preencherTrade(page, args.payload as PayloadHousekeep);
    else await preencherLimpeza(page, args.payload as PayloadLimpeza);

    // Fotos por último: o download é a parte lenta, e não faz sentido pagar por
    // ele se o preenchimento já falhou acima.
    if (args.fotos) {
      const [antes, depois] = await Promise.all([
        baixarFotos(args.fotos.antes, "before"),
        baixarFotos(args.fotos.depois, "after"),
      ]);
      await anexarBloco(page, HOUSEKEEP_FOTOS.antes, antes);
      await anexarBloco(page, HOUSEKEEP_FOTOS.depois, depois);
      // A página processa cada arquivo (miniatura, upload) antes de aceitar o
      // submit; sem essa folga o Submit chega antes das fotos.
      if (antes.length || depois.length) await page.waitForTimeout(3000);
    }

    // A confirmação de veracidade é o único checkbox visível da página.
    const confirmar = page.locator('input[type="checkbox"]:visible');
    if (await confirmar.count()) await confirmar.first().check({ force: true });

    if (args.simular) {
      // Conta o que de fato entrou nos inputs, não o que pretendíamos anexar:
      // é a única forma de saber que o upload pegou sem apertar Submit.
      const estado = await page.evaluate((sel) => ({
        fotos: Array.from(document.querySelectorAll(sel)).map(
          (el) => (el as HTMLInputElement).files?.length ?? 0,
        ),
        // Angular marca cada campo; sobrar inválido é o formulário dizendo que
        // recusaria o Submit, e é o que se quer descobrir sem apertá-lo.
        invalidos: document.querySelectorAll("input.ng-invalid, textarea.ng-invalid").length,
      }), HOUSEKEEP_FOTOS.seletor);
      return {
        ok: false,
        motivo:
          `simulação: ${forma} preenchido, fotos [${estado.fotos.join(", ")}], ` +
          `${estado.invalidos} campo(s) inválido(s), não submetido`,
        segundos: seg(),
      };
    }

    await page.locator('button[type="submit"]').first().click({ timeout: 10_000 });
    await page.waitForTimeout(4000);

    const depois = await page.locator("body").innerText();
    if (/thank you|submitted|received/i.test(depois)) {
      return { ok: true, forma, segundos: seg() };
    }
    const erro = depois.match(/required|error|invalid|must be/i);
    return {
      ok: false,
      motivo: erro ? `a Housekeep recusou: "${erro[0]}"` : "submetido mas sem confirmação na página",
      segundos: seg(),
    };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : "erro desconhecido", segundos: seg() };
  } finally {
    await browser.close();
  }
}
