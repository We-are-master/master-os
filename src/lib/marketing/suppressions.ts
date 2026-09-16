/**
 * A lista de bloqueio de marketing, e a única porta para consultá-la.
 *
 * A regra que isto existe para garantir: **sair de uma camada é sair de
 * todas**. Antes de 14/09/2026 quem clicava em unsubscribe saía das sequências
 * e virava `unsubscribed` em `leads`, mas continuava alcançável em `clients` —
 * então recebia a próxima campanha pela outra porta. É assim que se ganha
 * marcação de spam, e a marcação não cai só sobre o marketing: cai sobre o
 * domínio que também manda confirmação de job e cobrança.
 *
 * Transacional NÃO consulta este módulo. Quem pediu para não receber promoção
 * continua tendo que receber a confirmação da visita que ele mesmo marcou.
 */

import { createServiceClient } from "@/lib/supabase/service";

export type MotivoSupressao = "unsubscribed" | "complained" | "bounced" | "manual" | "invalid";

export function normalizarEmail(email: string | null | undefined): string | null {
  const e = String(email ?? "").trim().toLowerCase();
  return e.includes("@") && e.length <= 320 ? e : null;
}

/**
 * Os e-mails bloqueados dentro de uma lista.
 *
 * Devolve um Set para quem chama filtrar em memória: uma campanha resolve o
 * segmento inteiro de uma vez e depois filtra, em vez de fazer uma consulta
 * por destinatário.
 */
export async function bloqueados(emails: string[]): Promise<Set<string>> {
  const limpos = new Set(emails.map(normalizarEmail).filter((e): e is string => !!e));
  if (limpos.size === 0) return new Set();

  /**
   * Puxa a lista INTEIRA e cruza na memória, em vez de perguntar por e-mail.
   *
   * A primeira versão mandava os e-mails num `in(...)`, em lotes de 500, e o
   * PostgREST devolveu "URI too long" no primeiro teste com a base real: a
   * consulta vai na URL, e 500 endereços passam de oito mil caracteres.
   *
   * Inverter resolve de vez e ainda fica mais rápido. A lista de bloqueio é
   * pequena por natureza, são centenas ou poucos milhares contra 4.100
   * contatos, e ela é lida uma vez por campanha, não uma vez por pessoa.
   */
  const sb = createServiceClient();
  const achados = new Set<string>();
  const PAGINA = 1000;
  for (let inicio = 0; ; inicio += PAGINA) {
    const { data, error } = await sb
      .from("email_suppressions")
      .select("email")
      .range(inicio, inicio + PAGINA - 1);
    if (error) throw new Error(`suppressions: ${error.message}`);
    const pagina = data ?? [];
    for (const r of pagina) {
      const e = String(r.email).toLowerCase();
      if (limpos.has(e)) achados.add(e);
    }
    if (pagina.length < PAGINA) break;
  }
  return achados;
}

/** Um e-mail está bloqueado? Para o caminho de envio unitário. */
export async function estaBloqueado(email: string): Promise<boolean> {
  const e = normalizarEmail(email);
  if (!e) return true; // endereço inválido nunca recebe
  return (await bloqueados([e])).has(e);
}

/**
 * Bloqueia um e-mail, para sempre, em todas as camadas.
 *
 * Idempotente de propósito: o webhook do Resend pode entregar o mesmo evento
 * de reclamação mais de uma vez, e um clique duplo no link de unsubscribe é o
 * comportamento normal de quem está irritado.
 */
export async function bloquear(
  email: string,
  motivo: MotivoSupressao,
  origem?: string,
  notas?: string,
): Promise<{ ok: boolean; email: string | null }> {
  const e = normalizarEmail(email);
  if (!e) return { ok: false, email: null };

  const sb = createServiceClient();
  const { error } = await sb
    .from("email_suppressions")
    .upsert({ email: e, reason: motivo, source: origem ?? null, notes: notas ?? null }, { onConflict: "email" });
  if (error) throw new Error(`suppressions upsert: ${error.message}`);

  /**
   * A tag no cliente é redundante de propósito.
   *
   * A tabela de bloqueio é a fonte da verdade para o envio, mas quem abre o
   * card do cliente no OS precisa VER que aquela pessoa pediu para sair, senão
   * alguém a inclui à mão numa lista amanhã. Falhar aqui não desfaz o
   * bloqueio: o envio já está protegido pela tabela.
   */
  try {
    const { data: clientes } = await sb.from("clients").select("id, tags").ilike("email", e).is("deleted_at", null);
    for (const c of clientes ?? []) {
      const tags: string[] = Array.isArray(c.tags) ? c.tags : [];
      if (tags.includes("no-marketing")) continue;
      await sb.from("clients").update({ tags: [...tags, "no-marketing"] }).eq("id", c.id);
    }
  } catch (err) {
    console.error(`[suppressions] bloqueio gravado mas a tag do cliente falhou (${e}):`, err);
  }

  return { ok: true, email: e };
}

/** Desfaz um bloqueio. Só para engano nosso, nunca para reativar quem pediu para sair. */
export async function desbloquear(email: string): Promise<boolean> {
  const e = normalizarEmail(email);
  if (!e) return false;
  const sb = createServiceClient();
  const { error } = await sb.from("email_suppressions").delete().eq("email", e);
  if (error) throw new Error(`suppressions delete: ${error.message}`);
  return true;
}
