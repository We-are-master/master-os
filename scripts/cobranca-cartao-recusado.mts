/**
 * Cartão recusado: e-mails do dia 1, 3 e 7 e, do dia 7 em diante, pendência
 * Payment Unsuccessful + fim das tentativas automáticas + nota "needs a person".
 * As regras moram em `src/lib/cobranca/cartao-recusado.ts`. Só conta direct com
 * process_rules.v2 e PROCESSOS_V2=on; sem isso não faz nada.
 *
 *   npx tsx scripts/cobranca-cartao-recusado.mts            # ENSAIO: lista, não grava
 *   npx tsx scripts/cobranca-cartao-recusado.mts --aplicar  # grava e manda (CLIENT_MESSAGING_ENABLED=1)
 *
 * No Railway roda todo dia às 10h de Londres (scripts/workers/rotinas.mts).
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";

loadEnvLocal();

// Import DEPOIS do loadEnvLocal: o cliente do Zendesk lê as credenciais no carregamento.
const { varrerCartaoRecusado } = await import("../src/lib/cobranca/cartao-recusado");

const aplicar = process.argv.includes("--aplicar");
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

const { linhas, modo, aviso } = await varrerCartaoRecusado(sb, { aplicar });
console.log(`\n[cobranca-cartao] ${modo === "envio" ? "ENVIO REAL" : "ENSAIO (nenhum e-mail ao cliente)"}`);
if (aviso) console.log(`aviso: ${aviso}`);
for (const l of linhas) console.log(`  ${l.resultado.padEnd(9)} ${l.reference.padEnd(10)} ${l.detalhe}`);
console.log(`${linhas.length} job(s).`);
