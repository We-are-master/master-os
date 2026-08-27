/**
 * Pedido de pagamento EXTRA ao cliente do Express — material comprado on site.
 *
 * O valor vem do report (report-material-extra no OS): a fila de conclusão
 * devolve `extraCobranca` e, DEPOIS de o job estar concluído no portal, este
 * braço pede esse pagamento ao cliente pelo Checkatrade.
 *
 * Estado atual: SÓ MAPA. Todo o código que existe de pagamentos no repo é
 * leitura (dumpPayments/probePayments, "never clicks anything that commits") —
 * ninguém nunca clicou em Request payment. Este módulo segue o protocolo do
 * completion: `map` abre a tela, lista os controles, tira print e sai SEM
 * confirmar nada. O modo `live` só nasce depois de o mapa ser conferido por
 * uma pessoa, porque o clique aqui cobra dinheiro de cliente de verdade.
 *
 * Liga com REQUEST_PAYMENT_MODE=map no ambiente do bot (cópia viva em
 * ~/checkatrade-rpa, não este repo).
 */
import type { Page } from "playwright";
import type { ItemDaFila } from "../masterOs/client.js";
import { logger } from "../logger.js";

/** Candidatos ao gatilho, a confirmar no mapa. Vistos nos dumps read-only. */
const ACAO_PEDIR = /request (a )?payment|request money|add payment/i;

type Controle = { tag: string; tipo: string; texto: string; testid: string; aria: string };

/** Mesmo leitor do completion: tudo que a página oferece, sem tocar em nada. */
async function lerControles(page: Page): Promise<Controle[]> {
  // String de propósito: o tsx instrumenta arrow functions com `__name` e o
  // evaluate explode dentro da página (mesma lição do completion.ts).
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

/**
 * MAPA do pedido de pagamento: abre a página do job já concluído, procura o
 * gatilho de Request payment, lista os controles e registra print. Não clica
 * em nada que comprometa — nem no gatilho: a tela de dentro será mapeada com
 * uma pessoa olhando, porque o formulário provavelmente pede valor e envia
 * cobrança real ao cliente no OK.
 */
export async function mapearPedidoDePagamento(page: Page, item: ItemDaFila): Promise<void> {
  const valor = Number(item.extraCobranca ?? 0);
  if (!(valor > 0)) return;

  await page.goto(item.url, { waitUntil: "domcontentloaded" });
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  await page.waitForTimeout(2_000);

  const controles = await lerControles(page);
  const gatilhos = controles.filter((c) => ACAO_PEDIR.test(c.texto) || ACAO_PEDIR.test(c.aria));

  logger.info(`[request-payment:map] ${item.reference} — £${valor.toFixed(2)} a pedir`, {
    url: page.url(),
    controlesVisiveis: controles.length,
    gatilhoDePagamento: gatilhos.length > 0 ? gatilhos : "NAO ENCONTRADO",
  });
  console.log(`\n─── request payment: controles em ${item.reference} (£${valor.toFixed(2)}) ───`);
  for (const c of controles) {
    console.log(`  ${c.tag}${c.tipo ? `[${c.tipo}]` : ""}  "${c.texto}"  testid=${c.testid}  aria=${c.aria}`);
  }
  console.log("");
  await page
    .screenshot({ path: `/Users/victorsouza/checkatrade-rpa/.logs/request-payment-map-${item.reference}.png`, fullPage: true })
    .catch(() => {});
}
