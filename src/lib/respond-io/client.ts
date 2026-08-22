/**
 * Cliente da API v2 do respond.io.
 *
 * `fetch` direto em vez do SDK deles: são cinco chamadas, e uma dependência a
 * mais no bundle do Next não se paga. Os formatos abaixo foram confirmados
 * contra a API ao vivo e contra o código do MCP oficial
 * (github.com/respond-io/mcp-server), não deduzidos.
 *
 * O que a API NÃO expõe, e por isso não está aqui: AI Agent, workflow, knowledge
 * source, webhook e lifecycle. Todos 404 — são de painel.
 */

const BASE = "https://api.respond.io/v2";

export class RespondIoError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly body: string,
  ) {
    super(`respond.io ${status} on ${path}: ${body.slice(0, 200)}`);
    this.name = "RespondIoError";
  }
}

/** `phone:+447712345678` | `email:a@b.com` | `id:123`. */
export type ContactIdentifier = `phone:${string}` | `email:${string}` | `id:${number}`;

/**
 * Update e create exigem `phone:` ou `email:`; `id:` só funciona em leitura
 * (a API responde 403 "Invalid identifier :id" na escrita).
 */
export function phoneIdentifier(phone: string): ContactIdentifier {
  const t = phone.trim();
  return `phone:${t.startsWith("+") ? t : `+${t.replace(/\D/g, "")}`}`;
}

export type CustomFieldValue = { name: string; value: unknown };

export type Contact = {
  id: number;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  email: string | null;
  status: string;
  isBlocked: boolean;
  custom_fields: CustomFieldValue[];
  tags: string[];
  assignee: { id: number; firstName: string; lastName: string; email: string } | null;
  lifecycle: string | null;
  created_at: number;
};

export type Channel = { id: number; name: string; source: string; created_at: number };

export type CustomFieldDataType =
  | "text" | "list" | "checkbox" | "email" | "number" | "url" | "date" | "time";

export type TemplateComponent = {
  type: "header" | "body" | "button";
  parameters: Array<{ type: "text"; text: string }>;
};

export function createRespondIoClient(apiKey = process.env.RESPONDIO_API_KEY) {
  if (!apiKey) throw new Error("RESPONDIO_API_KEY não definido");

  async function call<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${BASE}/${path}`, {
      method,
      headers: {
        authorization: `Bearer ${apiKey}`,
        ...(body === undefined ? {} : { "content-type": "application/json" }),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await res.text();
    if (!res.ok) throw new RespondIoError(res.status, path, text);
    return (text ? JSON.parse(text) : null) as T;
  }

  return {
    listChannels: () => call<{ items: Channel[] }>("GET", "space/channel").then((r) => r.items),

    /**
     * `limit` não é opcional na prática: sem ele a API devolve **10** e nada na
     * resposta diz que foi truncada. Em 2026-08-11 isso me fez concluir que
     * `checkatrade_lead_id` não existia quando existia, porque era o 11º.
     */
    listCustomFields: (limit = 100) =>
      call<{
        items: Array<{
          id: number; name: string; slug: string; dataType: string;
          allowedValues?: { listValues?: string[] };
        }>;
      }>("GET", `space/custom_field?limit=${limit}`).then((r) => r.items),

    createCustomField: (input: {
      name: string; slug?: string; description?: string;
      dataType: CustomFieldDataType; allowedValues?: string[];
    }) => call<{ id: number }>("POST", "space/custom_field", input),

    /**
     * Templates do canal com o status de aprovação da Meta. O caminho é
     * `space/channel/{id}/template`, não `space/template` (404).
     */
    listTemplates: (channelId: number) =>
      call<{ items: Array<{ name: string; status?: string; language?: string; category?: string }> }>(
        "GET", `space/channel/${channelId}/template`,
      ).then((r) => r.items),

    getContact: (id: ContactIdentifier) => call<Contact>("GET", `contact/${id}`),

    /**
     * Marca o contato. É por aqui que a fase do funil se mexe.
     *
     * O `lifecycle` vem no GET do contato mas NÃO tem escrita na API v2: todo
     * caminho responde 404, e `contact/create_or_update` aceita o campo e o
     * descarta em silêncio, devolvendo 200 (medido em 22/08/2026). Quem muda
     * fase no respond.io é Workflow, e o gatilho que um Workflow enxerga vindo
     * de fora é a tag.
     *
     * Some sozinha se já estiver lá; a API não duplica.
     */
    addTags: (id: ContactIdentifier, tags: string[]) =>
      call<{ contactId: number }>("POST", `contact/${id}/tag`, tags),

    /** `firstName` é obrigatório: sem ele a API devolve 403, não 400. */
    createOrUpdateContact: (
      id: ContactIdentifier,
      fields: {
        firstName: string; lastName?: string | null; phone?: string | null;
        email?: string | null; language?: string | null; custom_fields?: CustomFieldValue[];
      },
    ) => call<Contact>("POST", `contact/create_or_update/${id}`, fields),

    /**
     * `search`, `filter` E `timezone` são obrigatórios juntos. Faltando qualquer
     * um, a API aponta o próximo campo ausente um de cada vez, o que faz parecer
     * outro erro. `search: ""` + `filter: {$and: []}` significam "tudo".
     */
    listContacts: (input: {
      search?: string; filter?: Record<string, unknown>;
      timezone?: string; limit?: number; cursorId?: number;
    } = {}) =>
      call<{ items: Contact[]; pagination: { next: string | null; previous: string | null } }>(
        "POST", "contact/list",
        {
          search: input.search ?? "",
          filter: input.filter ?? { $and: [] },
          timezone: input.timezone ?? "Europe/London",
          limit: input.limit ?? 50,
          ...(input.cursorId ? { cursorId: input.cursorId } : {}),
        },
      ),

    /**
     * Todos os contatos, paginando de verdade.
     *
     * Duas armadilhas, as duas descobertas medindo em 2026-08-12:
     *
     * 1. `limit` só vale como QUERY PARAM. Mandado no corpo, é ignorado e a API
     *    devolve 10 por página.
     * 2. `pagination.next` é a URL completa da próxima página, não um número.
     *    Passá-la como `cursorId` faz a API repetir a primeira página, e um
     *    laço que compara cursores para no segundo ciclo achando que acabou.
     *
     * Juntas, elas faziam este workspace parecer ter 20 contatos quando tem
     * 1035. Todo dedupe montado sobre essa lista conhecia as dez pessoas mais
     * recentes e considerava o resto novo, o que reenviou o mesmo template seis
     * vezes para sete pessoas antes de alguém perceber. A regra que sobra:
     * **seguir a URL do `next`, nunca remontar a chamada.**
     */
    listAllContacts: async (max = 20000): Promise<Contact[]> => {
      const body = JSON.stringify({ search: "", filter: { $and: [] }, timezone: "Europe/London" });
      const vistos = new Map<number, Contact>();
      let url = `${BASE}/contact/list?limit=100`;
      for (let i = 0; i < Math.ceil(max / 100) + 5; i++) {
        const res = await fetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${apiKey}`, "content-type": "application/json" },
          body,
        });
        const txt = await res.text();
        if (!res.ok) throw new RespondIoError(res.status, "contact/list", txt);
        const j = JSON.parse(txt) as { items?: Contact[]; pagination?: { next?: string | null } };
        const antes = vistos.size;
        for (const c of j.items ?? []) vistos.set(c.id, c);
        // Página sem nada novo significa que a paginação parou de avançar.
        // Sair aqui evita o laço infinito que o `next` repetido causaria.
        if (vistos.size === antes || !j.pagination?.next || vistos.size >= max) break;
        url = j.pagination.next;
      }
      return [...vistos.values()];
    },

    sendText: (id: ContactIdentifier, text: string, channelId?: number) =>
      call<{ messageId: number }>("POST", `contact/${id}/message`, {
        ...(channelId ? { channelId } : {}),
        message: { type: "text", text },
      }),

    /**
     * Template aprovado pela Meta. É o único jeito de abrir conversa com quem
     * nunca escreveu: fora da janela de 24h a API recusa texto livre.
     *
     * Se a estrutura não bater exatamente com o template aprovado, a mensagem
     * chega ao cliente mas aparece como balão vazio no inbox. Falha silenciosa
     * do lado de quem opera, não de quem recebe.
     */
    sendTemplate: (
      id: ContactIdentifier,
      template: { name: string; languageCode: string; components?: TemplateComponent[] },
      channelId?: number,
    ) =>
      call<{ messageId: number }>("POST", `contact/${id}/message`, {
        ...(channelId ? { channelId } : {}),
        message: {
          type: "whatsapp_template",
          template: {
            name: template.name,
            languageCode: template.languageCode,
            components: template.components ?? [],
          },
        },
      }),

    /**
     * Põe a conversa na mão de alguém. Sem isto o contato entra sem responsável
     * e o AI Agent não engaja: o template sai, o cliente responde, e a conversa
     * fica parada esperando um dono que ninguém definiu.
     *
     * `assignee` precisa ser **inteiro**. O mesmo id como string devolve 400,
     * não 200 com coerção.
     */
    assignConversation: (id: ContactIdentifier, assignee: number) =>
      call<{ contactId: number }>("POST", `contact/${id}/conversation/assignee`, { assignee }),

    /** Histórico da conversa, mais recente primeiro. */
    messages: (id: ContactIdentifier, limit = 20) =>
      call<{ items: Array<{ messageId: number; traffic?: string; status?: Array<{ value: string; message?: string }> }> }>(
        "GET", `contact/${id}/message/list?limit=${limit}`,
      ).then((r) => r.items),

    /**
     * Status de uma mensagem já enviada.
     *
     * `sendTemplate` devolver 200 só diz que o respond.io aceitou. A entrega é
     * assíncrona e o status vira `failed` segundos depois, com o motivo em
     * `message`. Sem consultar isto, "enviado" e "entregue" viram sinônimos no
     * relatório, que foi como 90 leads pagos foram consumidos sem receber nada.
     */
    messageStatus: async (id: ContactIdentifier, messageId: number) => {
      const r = await call<{ items: Array<{ messageId: number; status?: Array<{ value: string; message?: string }> }> }>(
        "GET", `contact/${id}/message/list?limit=10`,
      );
      return r.items.find((m) => m.messageId === messageId)?.status ?? [];
    },

    /**
     * Move o contato de estágio no funil.
     *
     * O "Default stage" do painel **não** vale para contato criado por API: em
     * 2026-08-12, 1007 dos 1013 contatos criados pelo dispatcher ficaram sem
     * estágio nenhum, e o funil do painel mostrava vazio enquanto as mensagens
     * saíam. Quem cria por API tem que marcar o estágio explicitamente.
     *
     * O parâmetro chama-se `name`. Mandar `stage` ou `lifecycle` devolve 400.
     */
    setLifecycle: (id: ContactIdentifier, name: string) =>
      call<{ code?: number; message?: string }>("POST", `contact/${id}/lifecycle/update`, { name }),

    /** Nota interna, não vai para o cliente. */
    addComment: (id: ContactIdentifier, text: string) =>
      call<unknown>("POST", `contact/${id}/comment`, { text }),
  };
}

export type RespondIoClient = ReturnType<typeof createRespondIoClient>;
