/**
 * A Resend que o agente usa: segmento, contatos e broadcasts.
 *
 * O SDK instalado ainda fala em "audiences" e não agenda broadcast com todos os
 * campos, então aqui é REST direto. A conta aceita 2 chamadas por segundo: o
 * `passo` espaça as chamadas e o 429 espera e tenta de novo, senão a carga
 * inicial de contatos morre no meio.
 */

const BASE = "https://api.resend.com";
const ESPACO_MS = 550;
let ultima = 0;

export type ContatoResend = { id: string; email: string; first_name: string | null; unsubscribed: boolean };
export type BroadcastResend = { id: string; name: string | null; status: string; scheduled_at: string | null; sent_at: string | null };

async function api<T>(metodo: string, caminho: string, corpo?: unknown): Promise<T> {
  const chave = process.env.RESEND_API_KEY?.trim();
  if (!chave) throw new Error("RESEND_API_KEY ausente");
  for (let tentativa = 0; ; tentativa++) {
    const espera = ultima + ESPACO_MS - Date.now();
    if (espera > 0) await new Promise((r) => setTimeout(r, espera));
    ultima = Date.now();
    const res = await fetch(`${BASE}${caminho}`, {
      method: metodo,
      headers: { Authorization: `Bearer ${chave}`, "Content-Type": "application/json" },
      body: corpo === undefined ? undefined : JSON.stringify(corpo),
      signal: AbortSignal.timeout(20_000),
    });
    if (res.status === 429 && tentativa < 4) {
      await new Promise((r) => setTimeout(r, 1500 * (tentativa + 1)));
      continue;
    }
    const texto = await res.text();
    if (!res.ok) throw new Error(`Resend ${metodo} ${caminho.split("?")[0]} ${res.status}: ${texto.slice(0, 240)}`);
    return (texto ? JSON.parse(texto) : {}) as T;
  }
}

type Lista<T> = { data: T[]; has_more?: boolean };

async function todos<T extends { id: string }>(caminho: string): Promise<T[]> {
  const tudo: T[] = [];
  let depois = "";
  for (;;) {
    const sep = caminho.includes("?") ? "&" : "?";
    const pagina = await api<Lista<T>>("GET", `${caminho}${sep}limit=100${depois ? `&after=${depois}` : ""}`);
    tudo.push(...(pagina.data ?? []));
    if (!pagina.has_more || !pagina.data?.length) return tudo;
    depois = pagina.data[pagina.data.length - 1].id;
  }
}

/** O segmento pelo nome; cria se não existir (só com `criar`). */
export async function segmentoPeloNome(nome: string, criar: boolean): Promise<string | null> {
  const lista = await api<Lista<{ id: string; name: string }>>("GET", "/segments");
  const achado = lista.data?.find((s) => s.name === nome);
  if (achado) return achado.id;
  if (!criar) return null;
  const novo = await api<{ id: string }>("POST", "/segments", { name: nome });
  return novo.id;
}

export const contatosDoSegmento = (segmento: string) => todos<ContatoResend>(`/audiences/${segmento}/contacts`);

export const criarContato = (segmento: string, c: { email: string; first_name?: string }) =>
  api<{ id: string }>("POST", `/audiences/${segmento}/contacts`, { ...c, unsubscribed: false });

export const marcarSaida = (segmento: string, contatoId: string) =>
  api<unknown>("PATCH", `/audiences/${segmento}/contacts/${contatoId}`, { unsubscribed: true });

export const broadcasts = () => todos<BroadcastResend>("/broadcasts");

export const criarBroadcast = (b: { segment_id: string; from: string; reply_to?: string; subject: string; html: string; name: string }) =>
  api<{ id: string }>("POST", "/broadcasts", b);

/** Agenda (ou manda já, sem `quando`). Depois disto o broadcast sai sozinho. */
export const agendarBroadcast = (id: string, quando?: Date) =>
  api<{ id: string }>("POST", `/broadcasts/${id}/send`, quando ? { scheduled_at: quando.toISOString() } : {});

/** Põe um contato que já existe na conta em mais um segmento. */
export const adicionarAoSegmento = (contatoId: string, segmento: string) =>
  api<unknown>("POST", `/contacts/${contatoId}/segments/${segmento}`);
