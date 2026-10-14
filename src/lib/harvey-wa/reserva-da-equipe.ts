/**
 * Reserva de um job com o preço que a equipe deu no WhatsApp: cria o job no OS
 * (Unassigned, no ticket da conversa) e devolve o link do sinal de 50%.
 *
 * É a mesma porta que a equipe usa (`POST /api/jobs`), então o job nasce com
 * fatura, margem e tudo o mais igual a um job criado à mão. O link é o `/pay` da
 * fatura, que cobra o valor certo na hora do clique. Ver `preco-da-equipe.ts`
 * para a trava do valor.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { directConsumerAccountIds } from "@/lib/direct-consumer-accounts";
import { getFixfyAccountId } from "@/lib/fixfy-account";
import { invoicePayLinkUrl } from "@/lib/pay-link-url";

export type ReservaDaEquipe = {
  telefone: string | null;
  ticketId: number | null;
  preco: number;
  servico: string;
  escopo: string;
  /** YYYY-MM-DD */
  data: string;
  /** HH:MM-HH:MM */
  janela: string;
  nome: string;
  email?: string | null;
  endereco: string;
  postcode: string;
  /** Quem da equipe deu o preço, para a nota do job. */
  quemDeuOPreco?: string | null;
};

export type ResultadoDaReserva = { reference: string; jobId: string; payUrl: string; deposit: number; balance: number } | { error: string };

const round2 = (n: number) => Math.round(n * 100) / 100;

const digitos = (t: string | null | undefined) => String(t ?? "").replace(/\D/g, "").slice(-10);

/**
 * O lead comprado já tem cadastro numa conta de cliente direto (hoje "Checkatrade").
 * A reserva tem de cair nesse mesmo cadastro: mandar para a conta Fixfy criaria um
 * segundo cliente e tiraria a venda da conta de onde o lead veio. Sem cadastro
 * achado devolve null, e a reserva segue para a conta Fixfy como sempre. Nunca lança.
 */
export async function contaDoLead(sb: SupabaseClient, telefone?: string | null, email?: string | null): Promise<string | null> {
  try {
    const contas = [...directConsumerAccountIds()];
    const tel = digitos(telefone);
    const mail = String(email ?? "").trim().toLowerCase();
    if (!contas.length || (tel.length < 10 && !mail)) return null;
    const { data } = await sb
      .from("clients")
      .select("source_account_id, phone, email")
      .in("source_account_id", contas)
      .order("created_at", { ascending: false })
      .limit(2000);
    const achado = ((data ?? []) as Array<{ source_account_id: string | null; phone: string | null; email: string | null }>).find(
      (c) => (tel.length === 10 && digitos(c.phone) === tel) || (mail !== "" && String(c.email ?? "").trim().toLowerCase() === mail),
    );
    return achado?.source_account_id ?? null;
  } catch {
    return null;
  }
}

export async function reservarPrecoDaEquipe(sb: SupabaseClient, r: ReservaDaEquipe): Promise<ResultadoDaReserva> {
  const chave = process.env.MASTER_OS_JOB_WEBHOOK_API_KEY?.trim();
  if (!chave) return { error: "booking is not configured (job key missing): hand off to the team" };
  const base = (process.env.NEXT_PUBLIC_APP_URL?.trim() || "https://app.getfixfy.com").replace(/\/$/, "");
  const accountId = (await contaDoLead(sb, r.telefone, r.email)) ?? (await getFixfyAccountId(sb));

  const res = await fetch(`${base}/api/jobs`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": chave },
    body: JSON.stringify({
      account_id: accountId,
      date: r.data,
      arrival_time: r.janela,
      title: r.servico,
      service_type: r.servico,
      client_name: r.nome,
      ...(r.email ? { client_email: r.email } : {}),
      ...(r.telefone ? { client_phone: r.telefone } : {}),
      property_address: r.endereco,
      postcode: r.postcode,
      rate_type: "fixed",
      client_price: r.preco,
      ...(r.ticketId ? { ticket_id: r.ticketId } : { create_zendesk_ticket: true }),
      description: r.escopo,
      internal_notes: `Booked on WhatsApp by Harvey at the price given by ${r.quemDeuOPreco || "the team"} in the conversation: £${r.preco.toFixed(2)}. The customer was sent the link for the 50% deposit (£${round2(r.preco / 2).toFixed(2)}); the job is unassigned until the team allocates a partner. Partner cost still to be confirmed.`,
    }),
    signal: AbortSignal.timeout(20_000),
  });
  const j = (await res.json().catch(() => ({}))) as { id?: string; reference?: string; error?: string };
  if (!res.ok || !j.reference || !j.id) return { error: j.error || `could not create the job (${res.status}): hand off to the team` };

  const { data: inv } = await sb.from("invoices").select("reference").eq("job_reference", j.reference).is("deleted_at", null).order("created_at", { ascending: false }).limit(1).maybeSingle();
  const ref = (inv as { reference?: string } | null)?.reference;
  if (!ref) return { error: `job ${j.reference} was created but has no invoice yet: hand off to the team so they send the payment link` };

  const deposit = round2(r.preco / 2);
  return { reference: j.reference, jobId: j.id, payUrl: invoicePayLinkUrl(ref, 50), deposit, balance: round2(r.preco - deposit) };
}
