/**
 * Lembrete de véspera para os clientes com job amanhã.
 *
 *   npx tsx scripts/confirmacao-24h.mts             ← dry run, não manda nada
 *   npx tsx scripts/confirmacao-24h.mts --enviar    ← manda de verdade
 *
 * Dry run é o PADRÃO, e é assim de propósito. Em 20/08/2026 duas chamadas de
 * teste numa rota de cron deste repo soltaram o parceiro de 15 jobs e
 * dispararam 52 convites reais. Desde então o caminho que fala com gente de
 * verdade precisa de gesto explícito.
 *
 * `--enviar` sozinho ainda não basta: `CLIENT_MESSAGING_ENABLED=1` também tem
 * que estar de pé. São duas travas porque são dois erros diferentes — rodar o
 * script sem querer, e o sistema inteiro estar ligado antes da hora.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { varrerLembretesDeVespera } from "../src/lib/client-confirmation/sweep-24h";

loadEnvLocal();

const enviar = process.argv.includes("--enviar");
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
);

const { dia, linhas } = await varrerLembretesDeVespera(supabase, { enviarDeVerdade: enviar });

console.log(`\n${enviar ? "ENVIO REAL" : "DRY RUN (nada foi enviado)"} · jobs de ${dia}\n`);
if (linhas.length === 0) {
  console.log("  nenhum job agendado para amanhã que ainda não tenha recebido lembrete.\n");
} else {
  for (const l of linhas) {
    const marca = l.resultado === "enviado" ? "✓" : l.resultado === "falhou" ? "✗" : "·";
    console.log(`  ${marca} ${l.reference.padEnd(10)} ${l.cliente.slice(0, 20).padEnd(21)} ${l.detalhe}`);
  }
}

const conta = (r: string) => linhas.filter((l) => l.resultado === r).length;
console.log(
  `\n${linhas.length} job(s) · enviados: ${conta("enviado")} · pulados: ${conta("pulado")} · falhas: ${conta("falhou")}\n`,
);
if (!enviar && linhas.length > 0) {
  console.log("Para mandar de verdade: --enviar, e CLIENT_MESSAGING_ENABLED=1 no ambiente.\n");
}
