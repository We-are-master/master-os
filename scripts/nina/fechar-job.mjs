/**
 * Fecha UM job na Fantastic, do summary ao checkout enviado.
 *
 *   node scripts/fantastic/fechar-job.mjs
 *
 * Roteiro do dono (16/09/2026), aprendido na tela porque o app não tem API:
 *
 *   Summary → 0 no dinheiro, N/A no comentário → SEND
 *   → diálogo "unfinished jobs" → OPEN JOB
 *   → Check in → YES → formulário → SUBMIT → OK
 *   → Check out → YES → formulário → SUBMIT → OK
 *
 * Rode com a tela do Summary do job aberta. Depois que a checklist diária
 * passa, o job também se abre direto pelo menu History → dia, e aí basta o
 * `ciclo-job.mjs`.
 */
import { execSync } from "node:child_process";
import { achar, esperar, tocar, dorme, sh } from "./tela.mjs";

/** Uma linha do summary: toca, escreve no diálogo, confirma. */
function preencherLinha(rotulo, valor, botao) {
  const lbl = achar((n) => n.txt === rotulo);
  if (!lbl) { console.log(`(sem "${rotulo}")`); return }
  tocar(lbl.x, lbl.y, 2500);
  const campo = achar((n) => n.cls === "EditText");
  if (!campo) { console.log(`(diálogo de "${rotulo}" não abriu)`); return }
  tocar(campo.x, campo.y, 900);
  sh(`shell input text "${valor}"`); dorme(700);
  const b = achar((n) => n.txt === botao);
  if (b) tocar(b.x, b.y, 2500);
  console.log(`${rotulo} → ${valor}`);
}

preencherLinha("Money Collected:", "0", "EDIT");
preencherLinha("Comments:", "N/A", "ADD");

// O rótulo muda: num job é "SEND SUMMARY" e noutro é só "SEND" (a tela vira a
// lista "Summaries" quando há mais de um pendente).
const enviar = achar((n) => /^SEND( SUMMARY)?$/.test(n.txt));
if (!enviar) { console.log("✘ sem SEND"); process.exit(1) }
tocar(enviar.x, enviar.y, 6000);
console.log("SEND apertado");

// Se a checklist diária ainda não foi enviada, é ELA que abre aqui, não o job.
if (achar((n) => /selfie wearing your uniform/i.test(n.txt))) {
  console.log("↯ a checklist diária abriu e bloqueia o dia: rode checklist-diaria.mjs --enviar primeiro");
  process.exit(2);
}

const abrir = esperar("OPEN JOB", 30);
if (abrir) { tocar(abrir.x, abrir.y, 5000); console.log("OPEN JOB") }
else console.log("(sem diálogo de unfinished jobs)");

execSync("node scripts/fantastic/ciclo-job.mjs", { stdio: "inherit", cwd: process.cwd() });
