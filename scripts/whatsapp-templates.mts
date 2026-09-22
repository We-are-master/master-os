/**
 * Os templates aprovados na nossa conta do WhatsApp, e se o número está de pé.
 *
 *   npx tsx scripts/whatsapp-templates.mts
 *
 * Só leitura: não manda mensagem nenhuma. Serve para escolher os nomes que vão
 * em WHATSAPP_TEMPLATE_CONFIRMATION, _REMINDER e _FEEDBACK.
 */
import { loadEnvLocal } from "./load-env-local.mjs";
import { listTemplates, whatsappConfigured } from "../src/lib/whatsapp/cloud";

loadEnvLocal();

if (!whatsappConfigured()) {
  console.log("Faltam WHATSAPP_TOKEN e WHATSAPP_PHONE_NUMBER_ID no .env.local.");
  process.exit(1);
}

const templates = await listTemplates();
if (templates.length === 0) {
  console.log("A conta não tem template nenhum aprovado ainda.");
  process.exit(0);
}

console.log(`\n${templates.length} template(s):\n`);
for (const t of templates.sort((a, b) => a.name.localeCompare(b.name))) {
  const marca = t.status === "APPROVED" ? "✓" : "·";
  console.log(`${marca} ${t.name}  [${t.language}]  ${t.status}  ${t.category}  ${t.bodyVariables} variável(is)`);
  if (t.body) console.log(`    ${t.body.replace(/\s+/g, " ").slice(0, 160)}`);
}
console.log("");
