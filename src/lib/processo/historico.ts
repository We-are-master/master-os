/**
 * O que a equipe já disse no ticket, para nenhum envio automático atropelar uma
 * resposta feita à mão (plano do dono, 22/10/2026).
 *
 * Resposta manual = comentário PÚBLICO, depois de `desde`, de alguém que não é
 * o solicitante, que não veio pela API (tudo que o OS, o Harvey e os agentes
 * escrevem sai por `via.channel = "api"`) e que não é de um autor marcado como
 * robô. É o que um agente faz pela tela do Zendesk (web) ou respondendo o
 * e-mail do ticket (email).
 *
 * Equivalente local do `quoteJaEnviadaAMao` (quote-envio-automatico.ts), que
 * pode não existir nesta base. Puro: quem chama lê os comentários.
 */

export type ComentarioDoTicket = {
  id?: number | string;
  author_id?: number | string | null;
  public?: boolean | null;
  created_at?: string | null;
  body?: string | null;
  plain_body?: string | null;
  via?: { channel?: string | null } | null;
};

export type OpcoesDaResposta = {
  /** O solicitante do ticket (o cliente ou a plataforma): o que ele escreve não é a equipe. */
  solicitanteId?: number | string | null;
  /** Autores que são automação (o usuário da API do Zendesk, o Harvey). */
  autoresAutomaticos?: Array<number | string>;
  /**
   * Quem é da equipe (users com role agent/admin, do `?include=users`). Quando
   * vem, só eles contam: alguém da plataforma em cópia respondendo por e-mail
   * não é resposta da equipe.
   */
  equipeIds?: Array<number | string>;
  /** Só conta resposta que cita um preço (£). */
  soComPreco?: boolean;
};

const CANAIS_AUTOMATICOS = new Set(["api", "rule", "system", "automation"]);

export function citaPreco(texto: string | null | undefined): boolean {
  return /£\s?\d/.test(String(texto ?? ""));
}

/** A primeira resposta manual pública da equipe depois de `desde`, ou null. */
export function respostaManualDepoisDe(
  comentarios: ComentarioDoTicket[],
  desde: string | Date,
  opcoes: OpcoesDaResposta = {},
): ComentarioDoTicket | null {
  const limite = typeof desde === "string" ? Date.parse(desde) : desde.getTime();
  if (!Number.isFinite(limite)) return null;
  const solicitante = opcoes.solicitanteId != null ? String(opcoes.solicitanteId) : null;
  const robos = new Set((opcoes.autoresAutomaticos ?? []).map(String));
  const equipe = opcoes.equipeIds ? new Set(opcoes.equipeIds.map(String)) : null;
  const ordenados = [...comentarios].sort((a, b) => Date.parse(a.created_at ?? "") - Date.parse(b.created_at ?? ""));
  for (const c of ordenados) {
    if (c.public !== true) continue;
    const em = Date.parse(c.created_at ?? "");
    if (!Number.isFinite(em) || em <= limite) continue;
    const autor = c.author_id != null ? String(c.author_id) : null;
    if (!autor) continue;
    if (solicitante && autor === solicitante) continue;
    if (robos.has(autor)) continue;
    if (equipe && !equipe.has(autor)) continue;
    const canal = String(c.via?.channel ?? "").toLowerCase();
    if (CANAIS_AUTOMATICOS.has(canal)) continue;
    if (opcoes.soComPreco && !citaPreco(c.plain_body ?? c.body)) continue;
    return c;
  }
  return null;
}

/** Os ids da equipe a partir dos users que o Zendesk devolve com `include=users`. */
export function idsDaEquipe(usuarios: Array<{ id?: number | string | null; role?: string | null }> | null | undefined): string[] {
  return (usuarios ?? [])
    .filter((u) => u.id != null && (u.role === "agent" || u.role === "admin"))
    .map((u) => String(u.id));
}
