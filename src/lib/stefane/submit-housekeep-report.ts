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
  HOUSEKEEP_LIMPEZA,
  NAO,
  SIM,
  formaDoFormulario,
  type PayloadHousekeep,
  type PayloadLimpeza,
} from "./housekeep-report-form";

export type ResultadoEnvio =
  /** `jaEstava` = a plataforma já tinha o relatório; ninguém submeteu nada agora. */
  | { ok: true; forma: "trade" | "limpeza"; segundos: number; jaEstava?: boolean }
  | { ok: false; motivo: string; segundos: number };

/** Marca um radio pelo prefixo do id (`vxowxmk0gvz2` → `vxowxmk0gvz2-2`). */
async function marcarRadio(page: Page, prefixo: string, indice: number): Promise<void> {
  const el = page.locator(`#${prefixo}-${indice}`);
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
  fotos?: string[];
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

    if (forma === "trade") await preencherTrade(page, args.payload as PayloadHousekeep);
    else await preencherLimpeza(page, args.payload as PayloadLimpeza);

    // A confirmação de veracidade é o único checkbox visível da página.
    const confirmar = page.locator('input[type="checkbox"]:visible');
    if (await confirmar.count()) await confirmar.first().check({ force: true });

    if (args.simular) {
      return { ok: false, motivo: `simulação: ${forma} preenchido, não submetido`, segundos: seg() };
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
