/**
 * Cria na Stripe os cupons da temporada, do jeito que o site espera.
 *
 *   npx tsx scripts/marketing-cupons.mts                 # ensaio: mostra o que falta
 *   npx tsx scripts/marketing-cupons.mts --aplicar       # cria o que falta
 *   npx tsx scripts/marketing-cupons.mts --so=WEEK10     # só esse código
 *
 * A chave sai de `STRIPE_SECRET_KEY` (ou `B2C_STRIPE_SECRET_KEY`). Se for
 * `sk_test_`, mexe no modo teste; se for `sk_live_`, mexe no dinheiro de
 * verdade e o script avisa antes.
 *
 * ── O que ele cria, e por que são dois objetos ──────────────────────────────
 *
 * Na Stripe um desconto é um `Coupon` (o valor) mais um `Promotion code` (o
 * texto que o cliente digita). O site lê o código, acha o cupom e aplica o
 * valor no PaymentIntent. Criar só o cupom não dá código para ninguém digitar.
 *
 * ── O que ele NUNCA faz, porque o site recusaria ────────────────────────────
 *
 * Cupom preso a cliente, preso a produto, ou marcado como "primeira compra"
 * é recusado pelo `/api/b2c/promo` do site, e o cliente lê a oferta no e-mail e
 * leva "Promo codes are not available right now" na cara do pagamento. Valor
 * fixo sai sempre em GBP pelo mesmo motivo.
 *
 * É idempotente: código que já existe é deixado quieto, com o valor dele
 * conferido contra `cupons.ts`. Rodar duas vezes não duplica nem sobrescreve.
 */

import { CUPONS, comoSeLe, type Cupom } from "@/lib/marketing/cupons";

const APLICAR = process.argv.includes("--aplicar");
/** `--so=WEEK10,OUTRO` mexe só nesses códigos. */
const SO = process.argv.find((a) => a.startsWith("--so="))?.slice(5).split(",").map((c) => c.trim().toUpperCase());

const CHAVE = (process.env.STRIPE_SECRET_KEY || process.env.B2C_STRIPE_SECRET_KEY || "").trim();
if (!CHAVE) {
  console.error("Falta STRIPE_SECRET_KEY (ou B2C_STRIPE_SECRET_KEY) no ambiente.");
  console.error("  modo teste: STRIPE_SECRET_KEY=sk_test_... npx tsx scripts/marketing-cupons.mts --aplicar");
  process.exit(1);
}
const AO_VIVO = CHAVE.startsWith("sk_live") || CHAVE.startsWith("rk_live");

/**
 * Fim do dia em Londres: um cupom que expira "em 31/03" vale o dia 31 inteiro.
 *
 * Tem que descontar o horário de verão. `23:59:59Z` em setembro é 00:59 do dia
 * seguinte em Londres, e o WEEK10 prometido "até domingo à meia-noite" valeria
 * uma hora a mais que o e-mail diz.
 */
export function fimDoDia(iso: string): number {
  const utc = Date.parse(`${iso}T23:59:59Z`);
  const hora = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(new Date(utc)));
  const adiantamento = hora === 0 ? 1 : 0; // BST: Londres está 1h à frente de UTC
  return Math.floor((utc - adiantamento * 3600_000) / 1000);
}

/**
 * Versão da API fixada de propósito.
 *
 * Na versão preview de 2026 o promotion code mudou de forma (`promotion[type]`
 * em vez de `coupon`). Fixando aqui, o script não muda de comportamento no dia
 * em que a conta subir de versão.
 */
const VERSAO_DA_API = "2024-06-20";

async function stripe(caminho: string, corpo?: Record<string, string>): Promise<{ ok: boolean; dados: Record<string, unknown> }> {
  const r = await fetch(`https://api.stripe.com/v1/${caminho}`, {
    method: corpo ? "POST" : "GET",
    headers: {
      Authorization: `Bearer ${CHAVE}`,
      "Stripe-Version": VERSAO_DA_API,
      ...(corpo ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(corpo ? { body: new URLSearchParams(corpo).toString() } : {}),
  });
  const dados = (await r.json()) as Record<string, unknown>;
  return { ok: r.ok, dados };
}

/** O código já existe nesta conta? Devolve o promotion code, se houver. */
async function jaExiste(codigo: string): Promise<Record<string, unknown> | null> {
  const { ok, dados } = await stripe(`promotion_codes?code=${encodeURIComponent(codigo)}&limit=1`);
  if (!ok) throw new Error(`lookup ${codigo}: ${JSON.stringify(dados).slice(0, 200)}`);
  const lista = (dados.data as Array<Record<string, unknown>>) ?? [];
  return lista[0] ?? null;
}

async function criar(cupom: Cupom): Promise<string> {
  const base: Record<string, string> = {
    name: cupom.nome,
    duration: "once",
    redeem_by: String(fimDoDia(cupom.expiraEm)),
    "metadata[proposito]": cupom.proposito.slice(0, 480),
    "metadata[origem]": "marketing-cupons.mts",
  };
  if (cupom.percentual) base.percent_off = String(cupom.percentual);
  else {
    base.amount_off = String(cupom.pence ?? 0);
    base.currency = "gbp"; // o site recusa qualquer outra moeda
  }

  const { ok, dados } = await stripe("coupons", base);
  if (!ok) throw new Error(`coupon ${cupom.codigo}: ${JSON.stringify(dados).slice(0, 300)}`);
  const coupomId = String(dados.id);

  const promo: Record<string, string> = {
    coupon: coupomId,
    code: cupom.codigo,
    expires_at: String(fimDoDia(cupom.expiraEm)),
    "metadata[proposito]": cupom.proposito.slice(0, 480),
  };
  if (cupom.maxUsos) promo.max_redemptions = String(cupom.maxUsos);
  if (cupom.minimoPence) {
    promo["restrictions[minimum_amount]"] = String(cupom.minimoPence);
    promo["restrictions[minimum_amount_currency]"] = "gbp";
  }

  const r2 = await stripe("promotion_codes", promo);
  if (!r2.ok) throw new Error(`promo ${cupom.codigo}: ${JSON.stringify(r2.dados).slice(0, 300)}`);
  return String(r2.dados.id);
}

/** O que a Stripe tem bate com o que o e-mail promete? */
function confere(cupom: Cupom, promoNaStripe: Record<string, unknown>): string | null {
  const c = promoNaStripe.coupon as Record<string, unknown> | undefined;
  if (!c) return "sem cupom ligado";
  if (cupom.percentual && Number(c.percent_off) !== cupom.percentual) return `Stripe diz ${c.percent_off}%, o e-mail promete ${cupom.percentual}%`;
  if (cupom.pence && Number(c.amount_off) !== cupom.pence) return `Stripe diz ${c.amount_off}p, o e-mail promete ${cupom.pence}p`;
  if (promoNaStripe.active === false) return "promotion code inativo";
  return null;
}

async function main() {
  console.log(`Stripe em modo ${AO_VIVO ? "AO VIVO (dinheiro de verdade)" : "TESTE"}, ${CUPONS.length} cupons na lista.`);
  if (AO_VIVO && APLICAR) console.log("Criando cupons REAIS. Eles só descontam quando alguém digita o código.\n");

  let criados = 0, existiam = 0, divergentes = 0;
  for (const cupom of CUPONS.filter((c) => !SO || SO.includes(c.codigo))) {
    const existente = await jaExiste(cupom.codigo);
    if (existente) {
      const problema = confere(cupom, existente);
      if (problema) { divergentes++; console.log(`  ! ${cupom.codigo.padEnd(16)} já existe e NÃO bate: ${problema}`); }
      else { existiam++; console.log(`  = ${cupom.codigo.padEnd(16)} já existe (${comoSeLe(cupom)})`); }
      continue;
    }
    if (!APLICAR) { console.log(`  + ${cupom.codigo.padEnd(16)} falta criar (${comoSeLe(cupom)}, até ${cupom.expiraEm})`); criados++; continue; }
    const id = await criar(cupom);
    criados++;
    console.log(`  + ${cupom.codigo.padEnd(16)} criado (${comoSeLe(cupom)}, até ${cupom.expiraEm}) ${id}`);
  }

  console.log(`\n${APLICAR ? "criados" : "faltam"}: ${criados} · já existiam: ${existiam} · divergentes: ${divergentes}`);
  if (!APLICAR) console.log("Ensaio. Para criar de verdade: --aplicar");
  if (divergentes) {
    console.log("\nDivergente quer dizer que o cliente vai ler um desconto no e-mail e ver outro no checkout.");
    console.log("Conserte na Stripe (ou em cupons.ts) antes de a temporada começar.");
    process.exitCode = 2;
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
