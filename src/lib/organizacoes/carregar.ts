/**
 * As organizações como o reconhecedor precisa delas.
 *
 * Separado de `reconhecer.ts` de propósito: aquele arquivo é função pura e
 * testável sem banco, este é o único que sabe de onde os dados vêm. Quando a
 * tabela `accounts` virar `organizations` no banco (hoje o rename é só de
 * tela, dono 03/09/2026), muda aqui e em nenhum outro lugar.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";
import { dominioDe, dominioProvaOrganizacao, type OrganizacaoConhecida } from "./reconhecer";

/**
 * Carrega as organizações ativas com os domínios que provam cada uma.
 *
 * `domains` é a fonte (migração 284). O e-mail do contato entra como reserva
 * para a organização cadastrada antes da coluna existir, ou criada depois sem
 * ninguém preencher — o pior resultado possível aqui é o robô não reconhecer
 * uma conta que existe, e isso é fácil de acontecer por esquecimento.
 */
export async function carregarOrganizacoes(
  client?: SupabaseClient,
): Promise<OrganizacaoConhecida[]> {
  const supabase = client ?? createServiceClient();
  const { data, error } = await supabase
    .from("accounts")
    .select("id, company_name, email, domains, status")
    .is("deleted_at", null);
  if (error) {
    console.error("[organizacoes] carregar falhou:", error);
    return [];
  }

  const linhas = (data ?? []) as Array<{
    id: string;
    company_name: string;
    email: string | null;
    domains: string[] | null;
    status: string | null;
  }>;

  /**
   * Um domínio pertence a UMA organização.
   *
   * A migração já garante isso no seed, mas o cadastro é editável e nada
   * impede alguém de repetir um domínio depois. Repetido, o primeiro fica e o
   * segundo é ignorado com aviso no log: reconhecer duas organizações para o
   * mesmo remetente é pior que não reconhecer nenhuma, porque o job nasce na
   * conta errada e alguém factura o cliente errado.
   */
  const dono = new Map<string, string>();
  const orgs: OrganizacaoConhecida[] = [];

  for (const l of linhas) {
    if (l.status === "inactive") continue;
    /**
     * `domains` é cadastro; o e-mail do contato é só reserva.
     *
     * A diferença importa na hora de reclamar: dois cadastros disputando o
     * mesmo domínio é erro de gente e merece aviso. A reserva perdendo para um
     * cadastro é o desenho funcionando — a Express tem `rishi@checkatrade.com`
     * no contato e o domínio é do Checkatrade por decisão do dono. Avisar isso
     * a cada carregamento seria um alarme permanente para uma coisa certa, e
     * alarme que sempre toca é alarme que ninguém lê.
     */
    const cadastrados = (l.domains ?? []).map((d) => [d, true] as const);
    const reserva = [[l.email ?? "", false] as const];
    const dominios: string[] = [];
    for (const [b, ehCadastro] of [...cadastrados, ...reserva]) {
      const d = dominioDe(b);
      // `gmail.com` no contato da conta interna não pode virar domínio de
      // organização: transformaria todo remetente do gmail em Fixfy.
      if (!d || !dominioProvaOrganizacao(d)) continue;
      const jaTem = dono.get(d);
      if (jaTem && jaTem !== l.id) {
        if (ehCadastro) {
          console.warn(
            `[organizacoes] domínio ${d} está cadastrado em duas organizações — ignorado em ${l.company_name}`,
          );
        }
        continue;
      }
      if (dominios.includes(d)) continue;
      dono.set(d, l.id);
      dominios.push(d);
    }
    if (dominios.length === 0) continue;
    orgs.push({ id: l.id, nome: l.company_name, dominios });
  }
  return orgs;
}
