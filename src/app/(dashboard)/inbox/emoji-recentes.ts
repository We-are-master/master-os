/**
 * OS EMOJI QUE ESTA PESSOA USA (founder 23/09: "quero esse completo").
 *
 * A aba "Mais usados" era uma lista FIXA de oito, igual pra todo mundo . o
 * palpite de quem escreveu o catálogo, não o hábito de quem digita. Quem manda
 * ✅ o dia inteiro continuava rolando atrás dele.
 *
 * Guarda no navegador, por FREQUÊNCIA e depois por recência: o empate desfaz
 * pelo último uso, senão o emoji de ontem que já foi usado cinco vezes ficaria
 * na frente do que se está usando agora.
 *
 * Só do navegador, de propósito: é preferência de digitação, não dado da
 * empresa . não vale uma tabela nem uma ida ao servidor. E como qualquer
 * leitura de `localStorage`, ela pode falhar (janela anônima, site bloqueado),
 * então toda chamada tolera o erro e a tela cai no catálogo.
 */
const CHAVE = "fixfy:inbox:emoji:v1";
const TETO = 32;

interface Uso {
  e: string;
  n: number;
  t: number;
}

function ler(): Uso[] {
  try {
    const cru = localStorage.getItem(CHAVE);
    if (!cru) return [];
    const lista = JSON.parse(cru) as unknown;
    if (!Array.isArray(lista)) return [];
    return lista.filter(
      (u): u is Uso =>
        !!u && typeof (u as Uso).e === "string" && typeof (u as Uso).n === "number",
    );
  } catch {
    return [];
  }
}

/** Os mais usados desta pessoa, do mais pro menos. Vazio = nunca usou nenhum. */
export function emojisUsados(): string[] {
  return ler()
    .sort((a, b) => b.n - a.n || b.t - a.t)
    .map((u) => u.e);
}

/** Marca um uso. Chamado no clique, não no envio: escolher já é usar. */
export function registrarUsoDeEmoji(emoji: string): void {
  try {
    const lista = ler();
    const achado = lista.find((u) => u.e === emoji);
    if (achado) {
      achado.n += 1;
      achado.t = Date.now();
    } else {
      lista.push({ e: emoji, n: 1, t: Date.now() });
    }
    /* O TETO poda pela mesma régua da ordenação: cortar por recência pura
       jogaria fora justamente o joinha que se usa todo dia e não se usou hoje. */
    const podada = lista.sort((a, b) => b.n - a.n || b.t - a.t).slice(0, TETO);
    localStorage.setItem(CHAVE, JSON.stringify(podada));
  } catch {
    /* Sem armazenamento a aba simplesmente não aprende. A tela segue. */
  }
}
