/**
 * Onde mora o arquivo de estado local de uma rotina (a trava de "já mandei hoje").
 *
 * FIXFY_STATE_DIR definida: o arquivo vai para lá. É o caso do Railway, onde o
 * diretório é o volume (/data/state) e sobrevive a deploy e restart; sem
 * volume, cada deploy zeraria a trava e o e-mail do dia sairia de novo.
 *
 * FIXFY_STATE_DIR vazia: o caminho de sempre (`scripts/`, relativo à raiz do
 * repo, de onde o launchd roda). O Mac não muda nada.
 *
 * @param {string} nome    nome do arquivo, ex.: ".tomorrow-sent.json"
 * @param {string} [padrao] diretório quando FIXFY_STATE_DIR não está definida
 */
import { mkdirSync } from "node:fs";
import { join } from "node:path";

export function arquivoDeEstado(nome, padrao = "scripts") {
  const dir = process.env.FIXFY_STATE_DIR?.trim() || padrao;
  mkdirSync(dir, { recursive: true });
  return join(dir, nome);
}
