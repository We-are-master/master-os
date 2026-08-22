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
import type { Page } from "playwright";

/**
 * O Playwright entra só na hora de abrir o browser.
 *
 * Com `import { chromium }` no topo, ele virava dependência de quem apenas
 * IMPORTA este arquivo — e quem importa é a rota do passo 3, que na maior
 * parte das vezes só responde um GET de estado. Em produção o pacote não está
 * lá (é devDependency, ~100MB) e a rota inteira caía, GET junto: o passo 3 do
 * Final review ficava mudo, sem "Try again", sem marcar à mão, sem erro na
 * tela. O envio de verdade continua igual; o que muda é que ler o estado não
 * precisa mais do browser.
 */
async function abrirChromium() {
  const { chromium } = await import("playwright");
  return chromium;
}
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
  HOUSEKEEP_COMODOS,
  HOUSEKEEP_SECOES_FOTO,
} from "./housekeep-report-form";
import { confirmarSubmissao } from "./housekeep-api";

/** Fotos de um envio: antes e depois, na ordem dos dois blocos do formulário. */
export type FotosDoEnvio = {
  antes: string[];
  depois: string[];
  /**
   * As mesmas fotos, ainda separadas por cômodo, quando o relatório foi
   * preenchido no formulário de limpeza. As listas achatadas acima continuam
   * existindo para o formulário de trade, que tem dois blocos só.
   */
  antesPorComodo?: Record<string, string[]>;
  depoisPorComodo?: Record<string, string[]>;
  /**
   * O TETO de cada campo, como a Housekeep publica, na chave do nosso lado
   * (`kitchen`, `equipment`...). Não é decorativo: "Cleaning equipment" aceita
   * DUAS fotos, e mandar cinco é como um campo válido vira campo recusado.
   * Sem este mapa, cai no teto global de 20, que só vale para o de trade.
   */
  maxPorChave?: Record<string, number>;
};

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
async function baixarFotos(
  urls: string[],
  prefixo: string,
  teto: number = HOUSEKEEP_FOTOS.maximoPorBloco,
): Promise<Anexo[]> {
  const out: Anexo[] = [];
  for (let i = 0; i < urls.length && out.length < teto; i++) {
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
  if (urls.length > teto) {
    console.warn(
      `[stefane] ${prefixo}: ${urls.length} fotos, a Housekeep aceita ${teto}. ` +
        `${urls.length - teto} ficaram de fora.`,
    );
  }
  return out;
}

/**
 * Onde está cada campo de arquivo da página: seção da sanfona e rótulo do bloco.
 *
 * Por RÓTULO e não por índice porque índice é promessa que a página não fez: o
 * bloco de vapor só existe quando a limpeza a vapor foi contratada, e qualquer
 * cômodo novo que eles adicionem empurra todos os outros. O rótulo é o que o
 * parceiro lê e é o que sobrevive.
 */
async function mapaDosBlocos(page: Page): Promise<Array<{ indice: number; secao: string; rotulo: string }>> {
  return page.evaluate(() => {
    const inputs = Array.from(document.querySelectorAll('input[type="file"]'));
    const secaoDe = (el: Element): string => {
      let p: Element | null = el;
      while ((p = p.parentElement)) {
        const h = p.querySelector?.("h5.collapsible");
        if (h?.textContent) return h.textContent.trim();
      }
      return "";
    };
    const rotuloDe = (el: Element): string => {
      let p: Element | null = el.closest("div");
      for (let k = 0; k < 5 && p; k++) {
        const l = p.querySelector("label, strong, h4");
        const t = l?.textContent?.trim();
        if (t && t.length < 90) return t;
        p = p.parentElement?.closest("div") ?? null;
      }
      return "";
    };
    return inputs.map((el, indice) => ({ indice, secao: secaoDe(el), rotulo: rotuloDe(el) }));
  });
}

/**
 * Sobe as fotos de limpeza cômodo a cômodo, cada uma no bloco com o nome dela.
 *
 * Devolve o que NÃO encontrou lugar: cômodo que a página não tem (vapor não
 * contratado, por exemplo) não é erro, mas precisa aparecer no log — foto que
 * ninguém sobe é serviço que ninguém prova.
 */
async function anexarPorComodo(
  page: Page,
  secaoAlvo: string,
  fotos: Record<string, string[]>,
  prefixoLog: string,
  maxPorChave: Record<string, number> = {},
): Promise<string[]> {
  const blocos = await mapaDosBlocos(page);
  const inputs = page.locator(HOUSEKEEP_FOTOS.seletor);
  const semLugar: string[] = [];
  for (const [chave, urls] of Object.entries(fotos)) {
    if (!urls || urls.length === 0) continue;
    const rotulo = HOUSEKEEP_COMODOS[chave];
    const alvo = rotulo
      ? blocos.find((b) => b.secao === secaoAlvo && b.rotulo.toLowerCase().startsWith(rotulo.toLowerCase()))
      : undefined;
    if (!alvo) {
      semLugar.push(chave);
      continue;
    }
    const anexos = await baixarFotos(urls, `${prefixoLog}/${chave}`, maxPorChave[chave]);
    if (anexos.length === 0) continue;
    await inputs.nth(alvo.indice).setInputFiles(anexos, { timeout: 60_000 });
    console.log(`[stefane] ${prefixoLog}: ${anexos.length} foto(s) em "${alvo.rotulo.slice(0, 40)}"`);
  }
  return semLugar;
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

/**
 * `ok: true` quer dizer que a Housekeep confirmou por `submitted_at`, e nada
 * menos que isso. Quem responde "já estava submetido" é o orquestrador, antes
 * de abrir browser nenhum.
 */
export type ResultadoEnvio =
  | { ok: true; forma: "trade" | "limpeza"; segundos: number }
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

  /**
   * Confere que marcou, porque marcar sem efeito não dava erro nenhum.
   *
   * Em 15/08/2026 a Housekeep recusou o JOB-9428 dizendo que "Is any follow up
   * work required?" era obrigatório, com o campo preenchido do nosso lado e o
   * mapeamento certo nos dois. O clique acertava um label que não governa o
   * input, ou o id daquele grupo mudou: nos dois casos o Playwright seguia
   * satisfeito e só a página deles reclamava, depois do submit, sem dizer qual
   * campo era.
   *
   * Falhar aqui é melhor: nomeia o campo antes de gastar a tentativa, e o card
   * mostra o nome em vez de "rejected it".
   */
  const marcado = await el
    .first()
    .isChecked({ timeout: 2000 })
    .catch(() => false);
  if (!marcado) {
    throw new Error(
      `could not tick "${prefixo}" option ${indice}: the field stayed empty, so Housekeep would reject it`,
    );
  }
}

/**
 * Escreve num campo que só nasce depois de o gatilho virar "Yes".
 *
 * `waitFor attached` e não `visible`: o campo pode estar dentro de uma sanfona
 * recolhida, e `fill` não se importa com visibilidade — mas se importa com o
 * elemento ainda não existir, que é o que acontece nos milissegundos entre o
 * clique no radio e o Angular redesenhar.
 */
async function preencherCondicional(page: Page, seletor: string, texto: string | null): Promise<void> {
  if (!texto) return;
  const campo = page.locator(seletor);
  await campo.waitFor({ state: "attached", timeout: 5000 });
  await campo.fill(texto);
}

async function preencherTrade(page: Page, p: PayloadHousekeep): Promise<void> {
  if (p.inicio) await page.fill(HOUSEKEEP_CAMPOS.inicio.seletor, p.inicio);
  if (p.fim) await page.fill(HOUSEKEEP_CAMPOS.fim.seletor, p.fim);
  await page.fill(HOUSEKEEP_CAMPOS.descricao.seletor, p.descricao);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.recomendaServicos.prefixo, p.recomendaServicos ? SIM : NAO);
  // Depois do radio: o campo de texto não existe antes do "Yes".
  await preencherCondicional(page, HOUSEKEEP_CAMPOS.servicosRecomendados.seletor, p.servicosRecomendados);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.cobrancaExtra.prefixo, p.cobrancaExtra ? SIM : NAO);
  if (p.cobrancaExtra) {
    await preencherCondicional(page, HOUSEKEEP_CAMPOS.trabalhoAdicionalCobranca.seletor, p.trabalhoAdicionalCobranca);
    await marcarRadio(page, HOUSEKEEP_CAMPOS.clienteAprovouCobranca.prefixo, p.clienteAprovouCobranca ? SIM : NAO);
  }
  await marcarRadio(page, HOUSEKEEP_CAMPOS.conclusao.prefixo, p.conclusao);
  if (p.faltaFazer) await preencherCondicional(page, HOUSEKEEP_CAMPOS.faltaFazer.seletor, p.faltaFazer);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.precisaRetorno.prefixo, p.precisaRetorno ? SIM : NAO);
  // Depois do radio, e não antes: "Describe additional work" só existe na
  // página depois que o retorno vira "Yes", e aí passa a ser obrigatório.
  // Preencher antes seria escrever num campo que ainda não nasceu.
  if (p.precisaRetorno && p.trabalhoAdicional) {
    const campo = page.locator(HOUSEKEEP_CAMPOS.trabalhoAdicional.seletor);
    await campo.waitFor({ state: "attached", timeout: 5000 });
    await campo.fill(p.trabalhoAdicional);
  }
  await marcarRadio(page, HOUSEKEEP_CAMPOS.feedback.prefixo, p.feedback ?? FEEDBACK.bom);
}

async function preencherLimpeza(page: Page, p: PayloadLimpeza): Promise<void> {
  if (p.inicio) await page.fill(HOUSEKEEP_CAMPOS.inicio.seletor, p.inicio);
  if (p.fim) await page.fill(HOUSEKEEP_CAMPOS.fim.seletor, p.fim);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.escopoMudou.prefixo, p.escopoMudou ? SIM : NAO);
  if (p.escopoMudou) {
    await preencherCondicional(page, HOUSEKEEP_LIMPEZA.detalhesDaMudanca.seletor, p.detalhesDaMudanca);
    await marcarRadio(page, HOUSEKEEP_LIMPEZA.clienteAprovouMudanca.prefixo, p.clienteAprovouMudanca ? SIM : NAO);
  }
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.danoPrevio.prefixo, p.danoPrevio ? SIM : NAO);
  if (p.danoPrevio) await preencherCondicional(page, HOUSEKEEP_LIMPEZA.descricaoDoDano.seletor, p.descricaoDoDano);
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.recusouFotos.prefixo, p.recusouFotos ? SIM : NAO);
  await marcarRadio(page, HOUSEKEEP_CAMPOS.recomendaServicos.prefixo, p.recomendaServicos ? SIM : NAO);
  if (p.recomendaServicos) {
    await preencherCondicional(page, HOUSEKEEP_LIMPEZA.servicosRecomendados.seletor, p.servicosRecomendados);
  }
  await marcarRadio(page, HOUSEKEEP_LIMPEZA.jobCompleto.prefixo, p.jobCompleto ? SIM : NAO);
  /**
   * Os dois que o "não" revela, e que recusaram o JOB-9450 em 19/08.
   *
   * A limpeza tem ids PRÓPRIOS para estes dois; o mapa só conhecia os do
   * formulário de trade, então eles ficavam em branco e obrigatórios.
   */
  if (!p.jobCompleto) {
    await preencherCondicional(page, HOUSEKEEP_LIMPEZA.faltaFazer.seletor, p.faltaFazer);
    await preencherCondicional(page, HOUSEKEEP_LIMPEZA.porqueIncompleto.seletor, p.porqueIncompleto);
  }
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
  /**
   * Qual formulário quem chamou montou o payload PARA.
   *
   * Existe desde 20/08/2026 para que a discordância vire erro em vez de virar
   * preenchimento errado. Antes, o payload era escolhido pelo template do
   * relatório e o preenchimento pela página: quando os dois discordavam, um
   * `as PayloadLimpeza` transformava campo ausente em `undefined`, `undefined`
   * em "No", e "Is the job complete? No" em recusa. Foi o JOB-9450 inteiro.
   */
  forma?: "trade" | "limpeza";
  payload: PayloadHousekeep | PayloadLimpeza;
  fotos?: FotosDoEnvio;
  simular?: boolean;
}): Promise<ResultadoEnvio> {
  const t0 = Date.now();
  const seg = () => Math.round((Date.now() - t0) / 100) / 10;

  const browser = await (await abrirChromium()).launch({ headless: true });
  try {
    const page = await browser.newPage();
    /**
     * Remendo para `page.evaluate` rodar fora do Next.
     *
     * O esbuild que o `tsx` usa liga `keepNames`, e isso embrulha toda função
     * nomeada em `__name(...)` — um ajudante que existe no bundle e NÃO existe
     * dentro do navegador. As funções que passamos para `evaluate` viajam como
     * texto, chegam do outro lado chamando `__name` e morrem com
     * "ReferenceError: __name is not defined".
     *
     * Em produção não acontece (o Next compila sem isso), então o sintoma só
     * aparecia ao chamar este módulo de um script — que é justamente como se
     * testa o envio sem submeter. Uma linha aqui vale mais que um módulo que
     * só funciona dentro do servidor.
     */
    await page.addInitScript(() => {
      const g = globalThis as unknown as { __name?: (f: unknown) => unknown };
      if (!g.__name) g.__name = (f: unknown) => f;
    });
    await page.goto(args.url, { waitUntil: "domcontentloaded", timeout: 45_000 });

    /**
     * ESPERAR o formulário aparecer, em vez de amostrar depois de 2,5 segundos.
     *
     * Medido em 20/08/2026: a página é um Angular que leva uns 10 segundos para
     * renderizar, e às vezes não renderiza em 35. O código antigo lia a página
     * depois de 2,5s, encontrava zero campo, e devolvia `ok: true, jaEstava`.
     * Ou seja: página lenta era carimbada como "a Housekeep já tinha este
     * relatório", o job saía da fila para sempre e o relatório ficava para
     * trás. Era o defeito mais caro do arquivo, porque falhava em silêncio.
     *
     * Agora ausência de campo é FALHA. Quem afirma que já foi submetido é o
     * `submitted_at` da API deles, conferido por quem chama antes daqui.
     */
    await page
      .locator("input,textarea,select")
      .first()
      .waitFor({ state: "attached", timeout: 60_000 })
      .catch(() => {});
    await page.waitForTimeout(1500);

    const ids = (
      await page.evaluate(() =>
        Array.from(document.querySelectorAll("input,textarea")).map(
          (el) => (el as HTMLElement).id || (el as HTMLInputElement).name || "",
        ),
      )
    ).filter(Boolean);

    if (ids.length === 0) {
      return {
        ok: false,
        motivo: "the client platform form never rendered: nothing was filled in",
        segundos: seg(),
      };
    }

    const forma = formaDoFormulario(ids);
    if (!forma) {
      // Tem campos, mas nenhum que a gente conhece: aí sim o formulário mudou.
      return {
        ok: false,
        motivo: `the Housekeep form changed: ${ids.length} fields on the page, none recognised`,
        segundos: seg(),
      };
    }

    /**
     * A página tem que ser o formulário para o qual o payload foi montado.
     *
     * Discordar aqui e seguir mesmo assim é o que produziu o JOB-9450. Parar
     * dizendo o nome dos dois lados custa uma tentativa; seguir custa o
     * relatório e o dia do parceiro.
     */
    if (args.forma && args.forma !== forma) {
      return {
        ok: false,
        motivo: `form mismatch: the report was prepared for the ${args.forma} form but the page is the ${forma} one`,
        segundos: seg(),
      };
    }

    await abrirTodasAsSecoes(page);

    if (forma === "trade") await preencherTrade(page, args.payload as PayloadHousekeep);
    else await preencherLimpeza(page, args.payload as PayloadLimpeza);

    // Fotos por último: o download é a parte lenta, e não faz sentido pagar por
    // ele se o preenchimento já falhou acima.
    if (args.fotos) {
      /**
       * Limpeza sobe cômodo a cômodo; trade continua com os dois baldes.
       *
       * Este é o par do espelho que o app do parceiro já fazia: lá o parceiro
       * fotografa cozinha, banheiro e quartos em campos separados, e até 19/08
       * tudo isso era achatado em duas listas na hora de subir — o formulário
       * deles tem treze campos e recebia dois. Relatório coletado certo,
       * entregue errado.
       */
      const porComodo =
        forma === "limpeza" && (args.fotos.antesPorComodo || args.fotos.depoisPorComodo);
      if (porComodo) {
        const teto = args.fotos.maxPorChave ?? {};
        const perdidosA = await anexarPorComodo(page, HOUSEKEEP_SECOES_FOTO.antes, args.fotos.antesPorComodo ?? {}, "before", teto);
        const perdidosD = await anexarPorComodo(page, HOUSEKEEP_SECOES_FOTO.depois, args.fotos.depoisPorComodo ?? {}, "after", teto);
        const perdidos = [...new Set([...perdidosA, ...perdidosD])];
        if (perdidos.length) {
          console.warn(`[stefane] cômodo(s) sem bloco correspondente na página: ${perdidos.join(", ")}`);
        }
        await page.waitForTimeout(3000);
      } else if (forma === "limpeza") {
        /**
         * Formulário de limpeza sem mapa por cômodo NÃO cai nos dois baldes.
         *
         * Os índices 0 e 1 são "antes" e "depois" no formulário de trade. No de
         * limpeza são "Cleaning equipment" (que aceita 2 fotos) e "Living
         * room". O JOB-9450 mandou 20 fotos para cada um desses dois e a
         * Housekeep descartou as 40: os treze campos ficaram vazios num
         * relatório que o nosso lado dava por enviado.
         *
         * Na prática o orquestrador já barra este caso antes, conferindo os
         * mínimos por cômodo. Isto aqui é a rede embaixo da rede.
         */
        return {
          ok: false,
          motivo: "the cleaning form needs photos tagged by room and this report has a flat list",
          segundos: seg(),
        };
      } else {
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
    }

    /**
     * SALVAR cada seção antes de submeter — descoberto no JOB-9437, 17/08.
     *
     * O formulário tem um botão "Save" por seção (Start job, Finish job,
     * Feedback), e é ele que persiste a seção no servidor: rádio e horário
     * autosalvam, mas descrição e foto só entram no relatório pelo Save. A
     * Stefane preenchia tudo e ia direto ao Submit, o servidor finalizava o
     * rascunho SEM as seções não salvas, e a página voltava com o formulário
     * — que o detector antigo ainda por cima lia como enviado.
     *
     * No dry run os Saves NÃO são clicados de propósito: salvar já grava no
     * rascunho do lado deles, e simulação que escreve não é simulação.
     */
    if (!args.simular) {
      /**
       * Save de cada seção, RE-CONSULTANDO a cada clique — aprendido à mão no
       * JOB-9437: salvar recolhe a seção e a lista de botões muda. O loop
       * antigo contava os três Saves antes e clicava por índice na lista
       * velha: só o primeiro acertava, os outros dois eram cliques no vazio
       * engolidos pelo catch — e a descrição nunca persistia.
       */
      const salvarSecoes = async (): Promise<string | null> => {
        const total = await page.locator("button", { hasText: /^Save$/ }).count();
        for (let i = 0; i < total; i++) {
          await abrirTodasAsSecoes(page);
          const visiveis = page.locator("button:visible", { hasText: /^Save$/ });
          if (i >= (await visiveis.count())) break;
          await visiveis.nth(i).click({ timeout: 5000 }).catch(() => {});
          await page.waitForTimeout(2500);
          const erro = await page
            .locator('[class*="error"], [role="alert"]')
            .filter({ hasText: /error|invalid|failed/i })
            .first()
            .textContent({ timeout: 500 })
            .catch(() => null);
          if (erro?.trim()) return `section save ${i + 1} of ${total} was refused: ${erro.trim().slice(0, 140)}`;
        }
        return null;
      };
      const erroSave = await salvarSecoes();
      if (erroSave) return { ok: false, motivo: erroSave, segundos: seg() };

      /**
       * Submit em página FRESCA — é a resposta literal ao "Validation error
       * has occurred. Please refresh the page and try again": submeter na
       * sessão que acabou de salvar três seções era recusado como stale. O
       * reload prova de quebra o que persistiu; o que os saves não seguraram
       * (rádio resetado por tentativa anterior) é re-preenchido aqui, e o
       * Submit valida o formulário inteiro como está na tela.
       */
      await page.reload({ waitUntil: "domcontentloaded" });
      await page.waitForTimeout(2500);
      await abrirTodasAsSecoes(page);
      if (forma === "trade") {
        const desc = page.locator(HOUSEKEEP_CAMPOS.descricao.seletor);
        const persistiu = ((await desc.inputValue().catch(() => "")) ?? "").trim().length > 0;
        if (!persistiu) {
          // Os saves não seguraram nada: repete a dose inteira uma vez, com
          // fotos, e recarrega de novo. Persistir de novo em branco é falha.
          await preencherTrade(page, args.payload as PayloadHousekeep);
          if (args.fotos) {
            const [antes2, depois2] = await Promise.all([
              baixarFotos(args.fotos.antes, "before"),
              baixarFotos(args.fotos.depois, "after"),
            ]);
            await anexarBloco(page, HOUSEKEEP_FOTOS.antes, antes2);
            await anexarBloco(page, HOUSEKEEP_FOTOS.depois, depois2);
            await page.waitForTimeout(3000);
          }
          const erroSave2 = await salvarSecoes();
          if (erroSave2) return { ok: false, motivo: erroSave2, segundos: seg() };
          await page.reload({ waitUntil: "domcontentloaded" });
          await page.waitForTimeout(2500);
          await abrirTodasAsSecoes(page);
        }
      }
      // Rádio e horário que alguma tentativa anterior tenha derrubado voltam
      // aqui — re-preencher com os mesmos valores é idempotente.
      if (forma === "trade") await preencherTrade(page, args.payload as PayloadHousekeep);
      else await preencherLimpeza(page, args.payload as PayloadLimpeza);
    }

    /**
     * "I confirm that the information provided in this report is true and
     * accurate", o único checkbox da página, e sem ele o formulário não passa.
     *
     * Era `check({ force: true })` e não pegava, e ninguém via porque
     * `check({force})` não confere o resultado: a falha só aparecia depois do
     * submit, como um "This field is required" que não dizia qual campo.
     *
     * O clique nativo vem primeiro porque foi o único que funcionou quando se
     * testou no formulário aberto, em 15/08/2026. O label ao lado do checkbox
     * não tem `for`, o input não tem `id` e o label não o envolve: clicar no
     * label não alterna nada, ao contrário do que acontece nos radios. E o
     * input tem `appearance: none` e fica fora da viewport, que é o que fazia
     * o clique por coordenada errar o alvo.
     */
    const confirmar = page.locator('input[type="checkbox"]').first();
    if (await confirmar.count()) {
      // `el.click()` no próprio input: alterna e dispara o change, que é o que
      // o framework da página escuta.
      await confirmar.evaluate((el) => (el as HTMLInputElement).click()).catch(() => {});
      if (!(await confirmar.isChecked().catch(() => false))) {
        await confirmar.scrollIntoViewIfNeeded().catch(() => {});
        await confirmar.check({ force: true, timeout: 5000 }).catch(() => {});
      }
      if (!(await confirmar.isChecked().catch(() => false))) {
        return {
          ok: false,
          motivo: 'could not tick "I confirm that the information provided is true and accurate"',
          segundos: seg(),
        };
      }
    }

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
          `dry run: ${forma} form filled, photos [${estado.fotos.join(", ")}], ` +
          `${estado.invalidos} invalid field(s), not submitted`,
        segundos: seg(),
      };
    }

    await page.locator('button[type="submit"]').first().click({ timeout: 10_000 });

    /**
     * Quem confirma é a API da Housekeep, não o texto da página.
     *
     * O texto sempre foi palpite: "o botão sumiu" deu enviado falso no
     * JOB-9437, e o filtro por "required" pescava o RÓTULO de uma pergunta
     * ("Is any follow up work required?") como se fosse recusa. `submitted_at`
     * não é interpretável: ou tem data, ou o relatório não entrou.
     *
     * A ESPERA é proporcional ao número de fotos, aprendido no JOB-9454
     * (20/08/2026). Aquele relatório tinha 124 fotos: a Stefane apertou
     * Submit, sondou por 30 segundos, não viu confirmação e gravou "no
     * confirmation after 30s". O servidor deles finalizou às 18:00:26, CINCO
     * MINUTOS depois — o upload ainda corria enquanto a gente desistia.
     *
     * O envio deu certo e o OS registrou falha. É o erro simétrico do falso
     * "já estava enviado" e custa o mesmo: manda alguém refazer à mão um
     * trabalho que já está feito, e some com a confiança na tela.
     *
     * 30s de base mais 2s por foto, com teto de 6 minutos. A página fica
     * aberta o tempo todo, que é o que mantém o upload andando.
     */
    const nFotos =
      (args.fotos?.antes.length ?? 0) +
      (args.fotos?.depois.length ?? 0) +
      Object.values(args.fotos?.antesPorComodo ?? {}).reduce((a, l) => a + l.length, 0) +
      Object.values(args.fotos?.depoisPorComodo ?? {}).reduce((a, l) => a + l.length, 0);
    const tetoMs = Math.min(30_000 + nFotos * 2_000, 6 * 60_000);
    const t1 = Date.now();
    while (Date.now() - t1 < tetoMs) {
      await page.waitForTimeout(5000);
      if (await confirmarSubmissao(args.url).catch(() => null)) {
        return { ok: true, forma, segundos: seg() };
      }
    }

    /**
     * A recusa de verdade, lida de onde o Angular a escreve.
     *
     * O filtro antigo varria o texto inteiro atrás de "required" e devolvia
     * rótulos de pergunta. O que diz o que faltou são os CONTROLES marcados
     * ng-invalid (com o rótulo do bloco em que vivem) e os elementos de erro
     * que o formulário renderiza. É isso que se coleta.
     */
    const diagnostico = await page.evaluate(() => {
      const rotuloDe = (el: Element): string => {
        let p: Element | null = el.closest("div,fieldset");
        for (let k = 0; k < 4 && p; k++) {
          const l = p.querySelector("label, legend, h4, h5");
          const t = l?.textContent?.trim();
          if (t) return t.slice(0, 60);
          p = p.parentElement?.closest("div,fieldset") ?? null;
        }
        return (el as HTMLInputElement).name || el.tagName.toLowerCase();
      };
      const invalidos = [
        ...new Set(
          Array.from(document.querySelectorAll("input.ng-invalid, textarea.ng-invalid, select.ng-invalid"))
            .map(rotuloDe),
        ),
      ].slice(0, 4);
      const erros = [
        ...new Set(
          Array.from(document.querySelectorAll('[class*="error"], [role="alert"], .invalid-feedback'))
            .map((e) => e.textContent?.trim() ?? "")
            .filter((t) => t.length > 3 && t.length < 160),
        ),
      ].slice(0, 3);
      return { invalidos, erros };
    });
    const partes = [
      diagnostico.erros.length ? diagnostico.erros.join(" · ") : "",
      diagnostico.invalidos.length ? `fields not accepted: ${diagnostico.invalidos.join(", ")}` : "",
    ].filter(Boolean);
    return {
      ok: false,
      motivo: partes.length
        ? `Housekeep did not confirm: ${partes.join(" — ")}`
        : `no confirmation after ${Math.round(tetoMs / 1000)}s: the client platform never stamped the report as submitted`,
      segundos: seg(),
    };
  } catch (err) {
    return { ok: false, motivo: err instanceof Error ? err.message : "unknown error", segundos: seg() };
  } finally {
    await browser.close();
  }
}
