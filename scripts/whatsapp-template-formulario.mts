/**
 * Submete à Meta o template de boas-vindas do lead do formulário instantâneo
 * (fixfy_form_welcome), na WABA do 020 4538 4668.
 *
 *   npx tsx scripts/whatsapp-template-formulario.mts           # mostra o que iria
 *   npx tsx scripts/whatsapp-template-formulario.mts --enviar  # submete à revisão da Meta
 *
 * Submeter não manda nada a ninguém: entra em revisão (minutos a horas). UTILITY
 * porque responde a um pedido que o cliente acabou de fazer.
 */

import { readFileSync } from "node:fs";

for (const l of readFileSync(".env.local", "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const { TEXTO_DO_TEMPLATE, templateDoFormulario } = await import("../src/lib/meta/formulario");

const template = {
  name: templateDoFormulario(),
  language: "en_GB",
  category: "UTILITY",
  components: [
    { type: "BODY", text: TEXTO_DO_TEMPLATE, example: { body_text: [["Sarah", "end of tenancy clean"]] } },
    { type: "FOOTER", text: "Fixfy · London" },
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
