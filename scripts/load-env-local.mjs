import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

function loadEnvFile(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i < 0) continue;
    const key = t.slice(0, i).trim();
    let val = t.slice(i + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

/**
 * Carrega `.env.local` e depois `.env` (o primeiro a definir vence).
 *
 * A ordem é a do Next, e é o contrário do que estava aqui. Não é detalhe: o
 * `.env` guarda um `ZENDESK_API_TOKEN` velho que devolve 401, e o de valer
 * está no `.env.local`. Com `.env` primeiro, todo script que fala com o
 * Zendesk por este loader falhava a autenticar — enquanto o app Next, que dá
 * precedência ao `.env.local`, funcionava. Dois comportamentos para o mesmo
 * segredo, e o do script era o errado.
 *
 * O `scripts/harvey/poll.ts` já carregava na mão nesta ordem, com um
 * comentário explicando o 401. Isso aqui é a mesma correção, no lugar onde
 * todo mundo lê.
 *
 * Medido em 03/09/2026: dos 16 nomes presentes nos dois arquivos, um único
 * tem valor diferente, e é esse token. Inverter a ordem muda essa variável e
 * nenhuma outra.
 */
export function loadEnvLocal(cwd = process.cwd()) {
  loadEnvFile(resolve(cwd, ".env.local"));
  loadEnvFile(resolve(cwd, ".env"));
}
