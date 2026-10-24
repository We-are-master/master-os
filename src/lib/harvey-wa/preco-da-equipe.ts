/**
 * O sinal de um preço dado pela EQUIPE (dono, 13/10/2026: "o Harvey pode retomar
 * sim, se ele permitir").
 *
 * O Leo dá o preço de um job fora da tabela (£80 pelas cortinas, £230 pelo
 * estúdio), o cliente aceita, e daí em diante era tudo à mão: pedir endereço,
 * criar o job no OS, mandar o link. Com a conversa devolvida ao Harvey, ele
 * fecha: cria o job e manda o link dos 50%.
 *
 * A trava que importa: o Harvey NUNCA escolhe o número. O valor tem que estar
 * escrito por alguém da equipe nesta conversa. Sem isso a ferramenta recusa.
 */
import type { Fala } from "./cerebro";

/** "£90,00", "£1,450", "£ 72", "£80.50" viram número. Vírgula seguida de 2 dígitos no fim é centavo. */
export function valorEmLibras(texto: string): number | null {
  const t = texto.replace(/\s/g, "");
  const centavos = t.match(/^(\d{1,6})[.,](\d{2})$/);
  if (centavos) return Number(`${centavos[1]}.${centavos[2]}`);
  const n = Number(t.replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Todo valor em libras que alguém da equipe escreveu na conversa. */
export function precosDaEquipe(conversa: Fala[]): number[] {
  const achados = new Set<number>();
  for (const f of conversa) {
    if (f.papel !== "equipe") continue;
    for (const m of f.texto.matchAll(/£\s?(\d[\d,]*(?:\.\d{1,2})?)/g)) {
      const v = valorEmLibras(m[1]);
      if (v !== null) achados.add(Math.round(v * 100) / 100);
    }
  }
  return [...achados];
}

/**
 * O preço numa mensagem da equipe (dono, 15/10/2026: preço dado no chat vai para
 * 🟠 Awaiting approval). Mais de um valor ("£80 labour + £20 materials = £100", "£100,
 * deposit £50"): vale o maior, que é o total; os outros vão na nota.
 */
export function precoNaMensagem(texto: string): { preco: number; outros: number[] } | null {
  const todos = precosDaEquipe([{ papel: "equipe", texto }]);
  if (!todos.length) return null;
  const preco = Math.max(...todos);
  return { preco, outros: todos.filter((p) => p !== preco) };
}

/** Status do ticket que ainda está antes do preço: Lead, Open, New, Needs Quote, In Conversation (WhatsApp) ou vazio. */
export function ticketAntesDoPreco(statusId: number | null | undefined, antes: number[]): boolean {
  return statusId == null || antes.includes(Number(statusId));
}

/** O valor pedido é um dos que a equipe deu? Centavo a centavo. */
export function precoConfere(pedido: unknown, conversa: Fala[]): boolean {
  const n = Math.round(Number(pedido) * 100) / 100;
  if (!Number.isFinite(n) || n <= 0) return false;
  return precosDaEquipe(conversa).some((p) => Math.abs(p - n) < 0.005);
}

/** "9am to 12pm", "09:00-12:00", "12 - 3pm" viram a janela que o /api/jobs aceita. */
export function janelaParaOJob(texto: unknown): string | null {
  const t = String(texto ?? "").toLowerCase().replace(/\s+/g, " ").trim();
  const horas = [...t.matchAll(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/g)].slice(0, 2).map((m) => ({ h: Number(m[1]), min: m[2] ?? "00", sufixo: m[3] }));
  if (horas.length < 2) return null;
  const [a, b] = horas;
  // "12 - 3pm": o sufixo do fim vale para o começo quando o começo não tem o seu.
  const hora24 = (x: typeof a, herdado?: string) => {
    const s = x.sufixo ?? herdado;
    let h = x.h;
    if (s === "pm" && h < 12) h += 12;
    if (s === "am" && h === 12) h = 0;
    return h;
  };
  const fim = hora24(b);
  let ini = hora24(a, b.sufixo);
  if (!a.sufixo && b.sufixo === "pm" && ini > fim) ini -= 12; // "9 to 3pm" = 09:00-15:00
  if (!(ini >= 6 && fim <= 22 && fim > ini)) return null;
  const p = (n: number, m: string) => `${String(n).padStart(2, "0")}:${m}`;
  return `${p(ini, a.min)}-${p(fim, b.min)}`;
}
