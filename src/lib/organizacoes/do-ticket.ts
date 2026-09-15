/**
 * De qual organização é este ticket — e o que dizer quando não dá para saber.
 *
 * O portão do Harvey (dono, 03/09/2026): **sem organização conhecida, sem
 * ação**. Ele continua lendo, continua classificando e continua deixando nota
 * interna; o que ele não faz é criar job, quote ou request de um remetente
 * que não prova de onde vem.
 *
 * A prova é o domínio de quem abriu o ticket. Não é o nome da empresa escrito
 * no texto, que era o que o `acharConta` procurava: os pedidos reais da
 * Kvadrat em agosto foram "Couple of lights to replace", "Door handle +
 * Painter" e "Cupboard fix", e nenhum diz Kvadrat.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { carregarOrganizacoes } from "./carregar";
import { reconhecerOrganizacao } from "./reconhecer";

export type OrganizacaoDoTicket =
  | { ok: true; id: string; nome: string; dominio: string }
  | { ok: false; motivo: string; nota: string };

export interface TicketComRemetente {
  id: number | string;
  requesterEmail?: string | null;
  subject?: string | null;
}

/**
 * A nota que o Harvey deixa quando não reconhece.
 *
 * Ela existe para ser RESOLVIDA, não para registrar fracasso: diz o que ele
 * leu, por que parou e qual é o gesto exato que o desbloqueia. As duas razões
 * pedem gestos diferentes, e por isso não compartilham texto — uma pede que
 * alguém confirme a pessoa, a outra que alguém cadastre a empresa.
 */
function notaDeRecusa(assunto: string, motivo: string, comoResolver: string): string {
  return [
    "🤖 HARVEY — I read this, but I did NOT act on it.",
    "",
    `Subject: ${assunto}`,
    `Why: ${motivo}`,
    "",
    "Owner rule (03/09/2026): no known organization, no action. Nothing was created in the OS.",
    "",
    comoResolver,
  ].join("\n");
}

export async function organizacaoDoTicket(
  ticket: TicketComRemetente,
  client?: SupabaseClient,
): Promise<OrganizacaoDoTicket> {
  const assunto = String(ticket.subject ?? `#${ticket.id}`);
  const organizacoes = await carregarOrganizacoes(client);

  /**
   * A porta de ensaio, e ela é do tamanho de UM endereço.
   *
   * Sem isto não dá para ensaiar a corrente inteira: o dono só consegue mandar
   * e-mail do próprio gmail, e gmail é domínio pessoal, que o portão barra com
   * razão. Ensaiar "de verdade" pedindo para um cliente real escrever é pior
   * que não ensaiar.
   *
   * Por que é seguro: casa um endereço EXATO, escolhido a dedo na variável, e
   * não um domínio. Ligá-la não abre gmail nenhum além daquele. Sem a variável
   * o caminho nem existe.
   *
   *   HARVEY_ENSAIO_EMAIL=victorhsouz@gmail.com
   *   HARVEY_ENSAIO_CONTA=Fixfy
   */
  const ensaioEmail = process.env.HARVEY_ENSAIO_EMAIL?.trim().toLowerCase();
  if (ensaioEmail && ticket.requesterEmail?.trim().toLowerCase() === ensaioEmail) {
    const alvo = process.env.HARVEY_ENSAIO_CONTA?.trim() || "Fixfy";
    /**
     * A busca é no banco, não na lista já carregada.
     *
     * `carregarOrganizacoes` só devolve quem tem domínio que PROVA algo, e a
     * conta de ensaio costuma ser justamente a que não tem (a Fixfy está
     * cadastrada com um gmail de reserva). Procurar nela achava nada e o
     * ensaio caía no portão normal, que foi o que aconteceu na primeira
     * rodada de 15/09/2026.
     */
    const { createServiceClient } = await import("@/lib/supabase/service");
    const { data: conta } = await (client ?? createServiceClient())
      .from("accounts")
      .select("id, company_name")
      .ilike("company_name", alvo)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle();
    if (conta) {
      const c = conta as { id: string; company_name: string };
      console.log(`[organizacoes] ENSAIO: ${ensaioEmail} tratado como ${c.company_name}`);
      return { ok: true, id: c.id, nome: c.company_name, dominio: `ensaio:${ensaioEmail}` };
    }
    console.error(`[organizacoes] ENSAIO: não achei a conta "${alvo}" — seguindo o portão normal`);
  }

  const r = reconhecerOrganizacao(ticket.requesterEmail, organizacoes);

  if (r.tipo === "organizacao") {
    return { ok: true, id: r.id, nome: r.nome, dominio: r.dominio };
  }

  if (r.tipo === "desconhecida") {
    return {
      ok: false,
      motivo: `unknown organization (${r.dominio})`,
      nota: notaDeRecusa(
        assunto,
        `the sender's domain is ${r.dominio}, which is not one of our organizations.`,
        `To unblock: add ${r.dominio} to the right organization in the OS (Organizations → the company → domains), then remove the tag on this ticket and I will retry on my next pass. If this is a one-off private customer, handle it by hand — I will keep leaving it alone.`,
      ),
    };
  }

  return {
    ok: false,
    motivo: r.motivo,
    nota: notaDeRecusa(
      assunto,
      `${r.motivo} — a personal address (or our own) never proves which organization a request belongs to.`,
      "To unblock: reply from the company address, or create the job/quote by hand from the organization's page. I will not guess the organization from the text.",
    ),
  };
}
