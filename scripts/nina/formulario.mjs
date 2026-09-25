/**
 * Preenche e envia UM formulário de checkin ou checkout da Fantastic.
 *
 *   node scripts/fantastic/formulario.mjs [fotosPorBloco]
 *
 * Regras que o dono ditou em 16/09/2026:
 *   avaliação do cliente → sempre 5*
 *   dinheiro             → sempre 0 / "No cash payment collected"
 *   campo de texto       → N/A
 *   foto                 → qualquer uma; o que importa é fechar o job
 *
 * A ORDEM aqui não é gosto: fotos antes do texto. A lista é um RecyclerView e
 * adicionar foto recria as linhas, apagando o que já foi digitado. No W6 9AN
 * este script preencheu 36 campos, pôs as fotos, e os 36 voltaram a ficar
 * vazios — o SUBMIT ficou cinza e nada na tela dizia por quê.
 */
import { arvore, achar, tocar, dorme, sh, escrever, fecharTeclado, descer, subirAoTopo, procurarRolando, blocosVaziosVisiveis } from "./tela.mjs";

const QUANTAS = Number(process.argv[2] ?? 3);

// ── 1. avaliação: 5* ──────────────────────────────────────────────────────
const nota = procurarRolando((n) => /^5\* /.test(n.txt), 8);
if (nota) {
  if (!nota.no.checked) { tocar(nota.no.x, nota.no.y, 1500); console.log("avaliação → 5*") }
  else console.log("avaliação já em 5*");
}

// ── 2. dinheiro: nenhum ───────────────────────────────────────────────────
// O campo do valor fica `enabled=false` quando esta caixa está marcada, então
// ele aparecer vazio depois é o certo, não uma pendência.
const cash = procurarRolando((n) => /no cash payment/i.test(n.txt), 30);
if (cash) {
  if (!cash.no.checked) { tocar(cash.no.x, cash.no.y, 1500); console.log("dinheiro → No cash payment collected") }
  else console.log("dinheiro já marcado");
}

// ── 3. fotos ──────────────────────────────────────────────────────────────
function porFotos(alvo) {
  tocar(alvo.x, alvo.y, 2000);
  const gal = achar((n) => /^Gallery$/i.test(n.txt));
  if (!gal) { sh("shell input keyevent 4"); dorme(1200); return false }
  tocar(gal.x, gal.y, 3500);

  // O picker do Google pinta um aviso de nuvem umas vezes e não outras, e ele
  // desloca a grade em ~60px. Dispensar antes de medir.
  const disp = achar((n) => /^Dismiss$/i.test(n.txt));
  if (disp) tocar(disp.x, disp.y, 1600);

  const grade = arvore()
    .filter((n) => n.clic && Math.abs((n.x2 - n.x1) - (n.y2 - n.y1)) < 12 && (n.x2 - n.x1) > 200 && n.y1 > 1000)
    .sort((a, b) => a.y - b.y || a.x - b.x);
  if (!grade.length) { sh("shell input keyevent 4"); dorme(1200); return false }
  for (const it of grade.slice(0, QUANTAS)) tocar(it.x, it.y, 800);

  const done = achar((n) => /^(Done|Add)$/i.test(n.txt));
  if (!done) { sh("shell input keyevent 4"); dorme(1200); return false }
  tocar(done.x, done.y, 2600);
  return true;
}
let blocos = 0;
for (let passada = 1; passada <= 4; passada++) {
  subirAoTopo();
  let fez = false;
  for (let v = 0, parado = 0, antes = ""; v < 45 && parado < 3; v++) {
    const nos = arvore();
    const vazio = blocosVaziosVisiveis(nos)[0];
    if (vazio) { if (porFotos(vazio)) { blocos++; fez = true } parado = 0; antes = ""; continue }
    const chave = nos.map((n) => `${n.y}:${n.txt}`).join("|");
    if (chave === antes) parado++; else parado = 0;
    antes = chave;
    descer();
  }
  if (!fez) break;
}
console.log(`${blocos} bloco(s) de foto preenchido(s)`);

// ── 4. campos de texto ────────────────────────────────────────────────────
// A janela vai até 2150 e não 1900: há campo de comentário perto do rodapé, e
// cortar antes dele deixava o formulário incompleto sem aviso.
let textos = 0;
subirAoTopo();
for (let v = 0, parado = 0, antes = ""; v < 40 && parado < 3; v++) {
  const nos = arvore();
  const vazio = nos.find((n) => n.cls === "EditText" && n.enab && n.txt.trim() === "" && n.y1 > 300 && n.y2 < 2150);
  if (vazio) {
    tocar(vazio.x, vazio.y, 1000);
    escrever("N/A");
    fecharTeclado();
    textos++; parado = 0; antes = "";
    continue;
  }
  const chave = nos.map((n) => `${n.y}:${n.txt}`).join("|");
  if (chave === antes) parado++; else parado = 0;
  antes = chave;
  descer();
}
console.log(`${textos} campo(s) de texto com N/A`);

// ── 5. enviar ─────────────────────────────────────────────────────────────
// O SUBMIT é RODAPÉ FIXO, em y≈2211..2337 — fora da faixa "visível" que o
// resto do script usa para não tocar em bloco meio cortado. Procurar sem esse
// filtro, senão o formulário fica preenchido e não é enviado.
const botao = achar((n) => n.txt === "SUBMIT" && n.clic);
if (!botao) { console.log("✘ não achei o SUBMIT"); process.exit(1) }
if (!botao.enab) { console.log("✘ SUBMIT desabilitado: ainda falta algo no formulário"); process.exit(1) }
tocar(botao.x, botao.y, 6000);
console.log("SUBMIT apertado, subindo fotos…");

for (let i = 0; i < 90; i++) {
  const nos = arvore();
  const pronto = nos.find((n) => /successfully/i.test(n.txt));
  if (pronto) {
    console.log(`✔ ${pronto.txt}`);
    const ok = achar((n) => /^OK$/i.test(n.txt));
    if (ok) tocar(ok.x, ok.y, 3500);
    process.exit(0);
  }
  if (!nos.some((n) => /Uploading|Sending/i.test(n.txt)) && i > 4) {
    console.log("(sem diálogo de envio; conferir a tela)");
    process.exit(0);
  }
  dorme(8000);
}
console.log("tempo esgotado esperando o envio");
