/**
 * Cria na WABA o template de marketing da campanha de limpeza.
 *
 *   npx tsx scripts/whatsapp-criar-template.mts           # mostra o que iria
 *   npx tsx scripts/whatsapp-criar-template.mts --enviar  # submete à Meta
 *   npx tsx scripts/whatsapp-criar-template.mts --passo=wa_oferta --enviar   # template WEEK10
 *
 * Submeter não manda nada a ninguém: o template entra em revisão da Meta
 * (minutos a horas) e só depois o cron pode usá-lo. Preço aqui é o do site em
 * 23/09/2026 (studio); mudou a tabela, cria um template novo com outro nome,
 * porque template aprovado só aceita uma edição por dia.
 *
 * O botão "Stop promotions" é o que a Meta pede para marketing e é o que o
 * webhook (/api/webhooks/whatsapp) lê para bloquear o número.
 */

import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const { WHATSAPP, linkDaCampanha, WEEK10 } = await import("../src/lib/marketing/week10-copy");
/** `--passo=wa_followup` ou `--passo=wa_oferta`: usa a copy da campanha WEEK10. */
const PASSO = process.argv.find((a) => a.startsWith("--passo="))?.slice(8) as keyof typeof WHATSAPP | undefined;
const NOME = PASSO ? WHATSAPP[PASSO].template : process.argv.find((a) => a.startsWith("--nome="))?.slice(7) ?? "fixfy_cleaning_prices";
const LINK = "https://www.getfixfy.com/?utm_source=whatsapp&utm_medium=broadcast&utm_campaign=wa_limpeza_lancamento_2026_10";

const corpo = [
  "Hi {{1}}, it's Fixfy. You got in touch with us before, so here's what's new: fixed-price cleaning across London, booked online in 2 minutes.",
  "",
  "End of tenancy from £200",
  "Deep clean from £174",
  "After builders from £204",
  "",
  "Products and equipment included, no quotes and no waiting. If anything is missed, we come back within 7 days to fix it for free.",
].join("\n");

const daCampanha = PASSO
  ? {
      name: NOME,
      language: "en_GB",
      category: "MARKETING",
      components: [
        { type: "BODY", text: WHATSAPP[PASSO].corpo, example: { body_text: [["Sarah", WEEK10.codigo]] } },
        { type: "FOOTER", text: "Fixfy · London" },
        {
          type: "BUTTONS",
          buttons: [
            { type: "URL", text: WHATSAPP[PASSO].botao, url: linkDaCampanha(PASSO) },
            { type: "QUICK_REPLY", text: "Stop promotions" },
          ],
        },
      ],
    }
  : null;

const template = daCampanha ?? {
  name: NOME,
  language: "en_GB",
  category: "MARKETING",
  components: [
    { type: "BODY", text: corpo, example: { body_text: [["Sarah"]] } },
    { type: "FOOTER", text: "Fixfy · London" },
    {
      type: "BUTTONS",
      buttons: [
        { type: "URL", text: "See prices and book", url: LINK },
        { type: "QUICK_REPLY", text: "Stop promotions" },
      ],
    },
  ],
};

console.log(JSON.stringify(template, null, 2));

if (!process.argv.includes("--enviar")) {
  console.log("\nEnsaio. Para submeter: --enviar");
  process.exit(0);
}

const r = await fetch(`https://graph.facebook.com/v21.0/${process.env.WHATSAPP_WABA_ID}/message_templates`, {
  method: "POST",
  headers: { Authorization: `Bearer ${process.env.WHATSAPP_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify(template),
});
console.log(r.status, JSON.stringify(await r.json()));
