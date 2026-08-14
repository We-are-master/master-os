import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * O telefone do cliente para o email de job **confirmado**.
 *
 * Vive fora do job: `jobs` guarda `client_name` desnormalizado mas não o
 * telefone, que fica na linha de `clients`. Como só um email precisa dele, a
 * busca fica aqui em vez de engordar o `select` de todo mundo.
 *
 * Quem chama é sempre o caminho do parceiro já alocado. O convite de
 * auto-assign não usa isto de propósito: ele sai para todos os parceiros que
 * casam com o trade, e a maioria nunca vai pisar naquele endereço.
 *
 * Falhar aqui devolve `null` e o email sai sem a linha de telefone. Um email
 * de job sem telefone é incompleto; um email que não sai é um job que o
 * parceiro não sabe que tem.
 */
export async function clientPhoneForPartnerEmail(
  supabase: SupabaseClient,
  clientId: string | null | undefined,
): Promise<string | null> {
  if (!clientId) return null;
  try {
    const { data, error } = await supabase
      .from("clients")
      .select("phone")
      .eq("id", clientId)
      .maybeSingle();
    if (error) {
      console.error("[partner-email] telefone do cliente não veio:", error.message);
      return null;
    }
    const phone = (data as { phone?: string | null } | null)?.phone?.trim();
    return phone || null;
  } catch (err) {
    console.error("[partner-email] telefone do cliente não veio:", err);
    return null;
  }
}
