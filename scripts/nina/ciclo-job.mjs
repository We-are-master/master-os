/**
 * Check in e check out de um job já aberto na tela, com o formulário no meio.
 *
 *   node scripts/fantastic/ciclo-job.mjs
 *
 * Use este quando o job já está na tela (pelo menu History → dia, por
 * exemplo). O caminho do summary só é preciso uma vez por dia e está no
 * `fechar-job.mjs`.
 *
 * COMO SABER QUE FECHOU: a tela do job passa a mostrar "The job is done" com
 * o círculo cinza. O campo `Status` na tela de detalhe continua dizendo
 * "Booked" mesmo em job concluído — ele só diz que a reserva existe, e usá-lo
 * como verificação faz retrabalhar job que já estava pronto.
 */
import { execSync } from "node:child_process";
import { achar, esperar, tocar } from "./tela.mjs";

const ir = achar("GO TO JOB");
if (ir) { tocar(ir.x, ir.y, 5000); console.log("GO TO JOB") }

if (achar((n) => /The job\s*is done/i.test(n.txt))) {
  console.log("este job já está fechado (\"The job is done\")");
  process.exit(0);
}

for (const etapa of ["Check in", "Check out"]) {
  const botao = esperar((n) => n.txt === etapa, 40);
  if (!botao) { console.log(`✘ não achei "${etapa}"`); process.exit(1) }
  tocar(botao.x, botao.y, 3500);
  const sim = esperar("YES", 20);
  if (sim) tocar(sim.x, sim.y, 7000);
  console.log(`${etapa} → YES`);

  const form = esperar((n) => /^(Checkin|Checkout)$/.test(n.txt), 45);
  if (!form) { console.log("✘ o formulário não abriu"); process.exit(1) }
  console.log(`  formulário ${form.txt}, preenchendo…`);
  try {
    console.log("  " + execSync("node scripts/fantastic/formulario.mjs", { encoding: "utf8", cwd: process.cwd() }).trim().split("\n").join("\n  "));
  } catch (e) {
    console.log("  formulario.mjs: " + String(e.stdout ?? e.message).trim().split("\n").join("\n  "));
  }

  const ok = esperar((n) => n.txt === "OK" && n.clic, 300);
  if (ok) { tocar(ok.x, ok.y, 6000); console.log(`  ✔ ${etapa} enviado`) }
  else console.log(`  (sem confirmação visível no ${etapa})`);
}
console.log("\njob fechado.");
