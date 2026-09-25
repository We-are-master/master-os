/**
 * Falar com a tela do app da Fantastic pelo adb.
 *
 * O app deles não tem API, então o caminho é a tela. O que este arquivo
 * carrega é a única lição que se paga caro aprender aqui: **reler a árvore
 * antes de cada toque**. O formulário de checkin/checkout é um RecyclerView
 * que CRESCE a cada bloco preenchido, e o teclado desloca a lista; coordenada
 * guardada de uma leitura anterior aponta para outra coisa.
 */
import { execSync } from "node:child_process";

const ADB = process.env.ADB_BIN ?? "/opt/homebrew/share/android-commandlinetools/platform-tools/adb";

export const sh = (c) => {
  try { return execSync(`${ADB} ${c}`, { encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }) }
  catch { return "" }
};
export const dorme = (ms) => execSync(`sleep ${ms / 1000}`);
export const tocar = (x, y, ms = 1500) => { sh(`shell input tap ${x} ${y}`); dorme(ms) };
export const escrever = (texto) => { sh(`shell input text "${texto}"`); dorme(600) };
/** ESC fecha o teclado sem sair da tela; BACK sairia do formulário. */
export const fecharTeclado = () => { sh("shell input keyevent 111"); dorme(800) };
export const descer = () => { sh("shell input swipe 540 1900 540 700 300"); dorme(1000) };
export const subirAoTopo = () => {
  for (let i = 0; i < 14; i++) sh("shell input swipe 540 700 540 2000 180");
  dorme(1200);
};

/** A árvore de acessibilidade como lista de nós com centro já calculado. */
export function arvore() {
  sh("shell uiautomator dump /sdcard/u.xml");
  const xml = sh("shell cat /sdcard/u.xml");
  const nos = [];
  for (const m of xml.matchAll(/<node[^>]*>/g)) {
    const n = m[0];
    const g = (k) => (n.match(new RegExp(`${k}="([^"]*)"`)) ?? [, ""])[1];
    const b = g("bounds").match(/\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/);
    if (!b) continue;
    const [x1, y1, x2, y2] = b.slice(1).map(Number);
    nos.push({
      id: g("resource-id").split("/").pop(), cls: g("class").split(".").pop(),
      txt: g("text"), desc: g("content-desc"),
      clic: g("clickable") === "true", enab: g("enabled") === "true", checked: g("checked") === "true",
      x: (x1 + x2) >> 1, y: (y1 + y2) >> 1, x1, y1, x2, y2,
    });
  }
  return nos;
}

export const achar = (t) => arvore().find((n) => (typeof t === "string" ? n.txt === t : t(n)));

/** Espera algo aparecer, relendo a cada 3s. */
export function esperar(teste, segundos = 120) {
  for (let i = 0; i < segundos / 3; i++) {
    const n = achar(teste);
    if (n) return n;
    dorme(3000);
  }
  return null;
}

/** Rola do topo até achar, e devolve o nó com a leitura em que ele apareceu. */
export function procurarRolando(teste, voltas = 30) {
  subirAoTopo();
  for (let v = 0; v < voltas; v++) {
    const nos = arvore();
    const achou = nos.find((n) => n.y1 > 280 && n.y2 < 2150 && teste(n));
    if (achou) return { no: achou, nos };
    descer();
  }
  return null;
}

/**
 * O botão de ADICIONAR foto de um bloco é o `iv_image` mais à esquerda
 * (x1 < 100); as fotos já postas ficam à direita dele, na mesma altura, e
 * tocá-las abre o visualizador em vez do diálogo.
 *
 * Um bloco está VAZIO quando não há `btn_delete` na mesma faixa de altura.
 */
export function blocosVaziosVisiveis(nos = arvore()) {
  const deletes = nos.filter((n) => n.id === "btn_delete");
  return nos
    .filter((n) => n.id === "iv_image" && n.clic && n.x1 < 100 && (n.y2 - n.y1) > 150 && n.y1 > 280 && n.y2 < 2150)
    .filter((a) => !deletes.some((d) => Math.abs(d.y - a.y) < 140))
    .sort((a, b) => a.y - b.y);
}
