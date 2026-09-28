/**
 * Leitura do Zendesk para a campanha: a chamada crua e a busca de tickets
 * criados desde um instante, já com o e-mail de quem abriu.
 *
 * Mora separado de `zendesk-respostas.ts` porque a triagem do envio
 * (`triagem.ts`) também precisa dela, e a varredura importa `campanha.ts`:
 * juntar tudo num arquivo só fecharia um ciclo de import.
 *
 * O e-mail de quem abriu o ticket vem de `users/show_many` pelos ids. Nada de
 * endereço na URL: a busca é por período e o cruzamento é na memória.
 */

import { normalizarEmail } from "./suppressions";

const HORA_MS = 60 * 60 * 1000;

const SUB = () => process.env.ZENDESK_SUBDOMAIN?.trim();
const EMAIL = () => process.env.ZENDESK_EMAIL?.trim() || process.env.ZENDESK_API_EMAIL?.trim();
const auth = () => "Basic " + Buffer.from(`${EMAIL()}/token:${process.env.ZENDESK_API_TOKEN?.trim()}`).toString("base64");

/** Lido na hora da chamada, não na carga do módulo. */
export function zendeskPronto(): boolean {
  return Boolean(SUB() && EMAIL() && process.env.ZENDESK_API_TOKEN?.trim());
}

export async function zd<T>(caminho: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`https://${SUB()}.zendesk.com/api/v2/${caminho}`, {
    ...init,
    headers: { Authorization: auth(), "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  if (!r.ok) throw new Error(`Zendesk ${r.status} em ${caminho.split("?")[0]}`);
  return (await r.json()) as T;
}

export type TicketDaBusca = { id: number; criadoEm: string; requesterId: number; email: string | null; tags: string[]; status: string };

/** id do usuário → e-mail principal, em minúsculas. Cem ids por chamada. */
export async function emailsDosUsuarios(ids: number[]): Promise<Map<number, string>> {
  const m = new Map<number, string>();
  for (let i = 0; i < ids.length; i += 100) {
    const { users } = await zd<{ users?: Array<{ id: number; email?: string | null }> }>(`users/show_many.json?ids=${ids.slice(i, i + 100).join(",")}`);
    for (const u of users ?? []) {
      const e = normalizarEmail(u.email);
      if (e) m.set(u.id, e);
    }
  }
  return m;
}

/**
 * Tickets criados desde `desde` (de qualquer canal, ou só de um), do mais novo
 * para o mais velho, com o e-mail do requester. A busca do Zendesk entrega no
 * máximo mil resultados; para uma campanha de uma semana é folga de sobra, e
 * se um dia faltar, o que fica de fora é o mais velho, não a resposta de agora.
 */
export async function ticketsDesde(desde: Date, opcoes: { via?: "email" | "whatsapp"; agora?: Date } = {}): Promise<TicketDaBusca[]> {
  const agora = opcoes.agora ?? new Date();
  // Hora relativa, a mesma sintaxe do `updated>30minutes` da varredura; a
  // hora a mais é folga, e o corte exato é feito aqui embaixo.
  const horas = Math.max(1, Math.ceil((agora.getTime() - desde.getTime()) / HORA_MS) + 1);
  // Na busca o e-mail é `via:mail`, embora o ticket traga `via.channel: "email"`:
  // `via:email` devolve 422 "Error filtering on field: via_id" (medido em 28/09/2026).
  const via = opcoes.via === "email" ? "mail" : opcoes.via;
  const consulta = ["type:ticket", via ? `via:${via}` : null, `created>${horas}hours`].filter(Boolean).join(" ");

  type Bruto = { id: number; created_at: string; requester_id: number; tags?: string[]; status?: string };
  const brutos: Bruto[] = [];
  for (let pagina = 1; pagina <= 10; pagina++) {
    const r = await zd<{ results?: Bruto[]; next_page?: string | null }>(
      `search.json?query=${encodeURIComponent(consulta)}&sort_by=created_at&sort_order=desc&per_page=100&page=${pagina}`,
    );
    brutos.push(...(r.results ?? []));
    if (!r.next_page) break;
  }

  const recentes = brutos.filter((t) => Date.parse(t.created_at) >= desde.getTime());
  const emails = await emailsDosUsuarios([...new Set(recentes.map((t) => t.requester_id))]);
  return recentes.map((t) => ({
    id: t.id,
    criadoEm: t.created_at,
    requesterId: t.requester_id,
    email: emails.get(t.requester_id) ?? null,
    tags: t.tags ?? [],
    status: t.status ?? "",
  }));
}
