/**
 * A checklist diária do app: selfie de uniforme e as duas fotos do veículo.
 *
 *   node scripts/fantastic/checklist-diaria.mjs
 *
 * Ela BLOQUEIA o dia: sem ela enviada, o app abre nessa tela e não deixa
 * chegar nos jobs, e a faixa "To receive new jobs, please send your summary!"
 * não sai.
 *
 * É a ÚNICA tela do app sem opção de galeria: o diálogo tem só "Take photo" e
 * "Record video". Por isso ela ficou travada até 16/09/2026, quando apareceu
 * que o AVD tinha `hw.camera.front=none` e selfie usa a frontal: o disparador
 * não capturava nada, o contador ficava em 0/20, e nenhum erro aparecia na
 * tela. Consertado no `~/.android/avd/fantastic.avd/config.ini`
 * (`hw.camera.front=emulated`) e reinício do emulador.
 *
 * Ao reiniciar: `adb emu kill` deixa locks órfãos. Apagar
 * `hardware-qemu.ini.lock` e `multiinstance.lock` no .avd, senão o emulador
 * recusa com "Running multiple emulators with the same AVD".
 *
 * O que ela grava é quadro vazio, porque o emulador não tem feed de câmera.
 */
import { arvore, achar, tocar, dorme, sh, blocosVaziosVisiveis } from "./tela.mjs";

for (let volta = 1; volta <= 5; volta++) {
  const nos = arvore();
  const vazio = blocosVaziosVisiveis(nos)[0];
  if (!vazio) { console.log("nenhum slot vazio restante"); break }
  const rot = nos.filter((n) => n.cls === "TextView" && n.txt && n.y < vazio.y).sort((a, b) => b.y - a.y)[0];
  console.log(`▸ ${(rot?.txt ?? "slot").slice(0, 50)}`);

  tocar(vazio.x, vazio.y, 2500);
  const tirar = achar((n) => /^Take photo$/i.test(n.txt));
  if (!tirar) { console.log("   ✘ sem 'Take photo'"); sh("shell input keyevent 4"); dorme(1500); continue }
  tocar(tirar.x, tirar.y, 8000);

  const disparo = achar((n) => n.id === "btn_take_photo");
  if (!disparo) { console.log("   ✘ câmera não abriu"); sh("shell input keyevent 4"); dorme(1500); continue }
  tocar(disparo.x, disparo.y, 5000);
  console.log(`   ${achar((n) => /\d+\/20 Photos/.test(n.txt))?.txt ?? "?"}`);

  const done = achar((n) => n.id === "btn_done");
  if (done) tocar(done.x, done.y, 4000);
}

const fim = arvore();
const sub = fim.find((n) => n.txt === "SUBMIT");
console.log(`\nfotos: ${fim.filter((n) => n.id === "btn_delete").length} · SUBMIT ${sub ? (sub.enab ? "habilitado" : "desabilitado") : "não encontrado"}`);
if (sub?.enab && process.argv.includes("--enviar")) {
  tocar(sub.x, sub.y, 10000);
  console.log("enviada.");
} else if (sub?.enab) {
  console.log("(rode com --enviar para mandar)");
}
