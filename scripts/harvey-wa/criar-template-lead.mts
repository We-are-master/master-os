/**
 * Cria na WABA o template de primeiro contato do Harvey com lead do Checkatrade.
 *
 *   npx tsx scripts/harvey-wa/criar-template-lead.mts            mostra o que iria
 *   npx tsx scripts/harvey-wa/criar-template-lead.mts --enviar   submete à Meta
 *
 * Submeter não manda nada a ninguém: o template entra em revisão da Meta
 * (minutos a horas). Precisa ser a WABA do número que está no Zendesk
 * (+44 20 4538 4668); WHATSAPP_WABA_ID no .env.local. Depois de aprovado, o
 * nome vai em HARVEY_WA_LEAD_TEMPLATE (Vercel e .env.local).
 *
 * As variáveis, na ordem: primeiro nome, o serviço ("handyman work"), a área ("NW8 area").
 */
import { readFileSync } from "node:fs";

for (const l of readFileSync(new URL("../../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = l.match(/^([A-Z_0-9]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, "").trim();
}

const template = {
  name: process.argv.find((a) => a.startsWith("--nome="))?.slice(7) ?? "checkatrade_lead_hello",
  language: "en_GB",
  category: "UTILITY",
  components: [
    {
      type: "BODY",
      text:
        "Hi {{1}}, it's Harvey from Fixfy. We've got your Checkatrade request for {{2}} in the {{3}} and we can help. " +
        "Could you tell me a bit more about the job, or send a couple of photos? I'll come back with a fixed price.",
      example: { body_text: [["Sarah", "handyman work", "NW8 area"]] },
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
