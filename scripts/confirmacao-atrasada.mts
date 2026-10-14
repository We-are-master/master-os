/**
 * Confirmação atrasada: jobs de amanhã em diante, com parceiro, que nunca
 * confirmaram nada ao cliente (0 de 47 em 14/10/2026).
 *
 *   npx tsx scripts/confirmacao-atrasada.mts                     ← ENSAIO: lista, não grava nada
 *   npx tsx scripts/confirmacao-atrasada.mts --aplicar           ← manda (9h-20h de Londres)
 *   npx tsx scripts/confirmacao-atrasada.mts --aplicar --agora   ← manda fora da janela
 *   npx tsx scripts/confirmacao-atrasada.mts --aplicar --max=10  ← no máximo 10 envios
 *
 * `--aplicar` sozinho não basta: `CLIENT_MESSAGING_ENABLED=1` também tem que
 * estar de pé. Cada job passa pelas mesmas regras da confirmação na hora da
 * atribuição (`src/lib/client-confirmation/send.ts`).
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

// Import DEPOIS do loadEnvLocal: `import` estático é içado, e o cliente do
// Zendesk lê as credenciais no carregamento do módulo (veio "Zendesk not configured").
const { recuperarConfirmacoes } = await import("../src/lib/client-confirmation/catch-up");

const aplicar = process.argv.includes("--aplicar");
const ignorarJanela = process.argv.includes("--agora");
const maxArg = process.argv.find((a) => a.startsWith("--max="));
const max = maxArg ? Number(maxArg.slice(6)) : undefined;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

const { desde, linhas, modo, aviso } = await recuperarConfirmacoes(supabase, { aplicar, ignorarJanela, max });

console.log(`\n${modo === "envio" ? "ENVIO REAL" : "ENSAIO (nada gravado, nada enviado)"} · jobs de ${desde} em diante`);
if (aviso) console.log(`aviso: ${aviso}`);
console.log("");
for (const l of linhas) {
  const marca = l.resultado === "enviado" ? "✓" : l.resultado === "enviaria" ? "→" : l.resultado === "falhou" ? "✗" : "·";
  console.log(`  ${marca} ${l.reference.padEnd(10)} ${l.dia}  ${l.detalhe}`);
}
const conta = (r: string) => linhas.filter((l) => l.resultado === r).length;
console.log(
  `\n${linhas.length} job(s) · enviariam: ${conta("enviaria")} · enviados: ${conta("enviado")} · pulados: ${conta("pulado")} · falhas: ${conta("falhou")}\n`,
);
