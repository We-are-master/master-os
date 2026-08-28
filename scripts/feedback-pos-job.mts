/**
 * FEEDBACK PÓS-JOB — o WhatsApp que pergunta "como foi?" depois do job pago.
 *
 *   npx tsx scripts/feedback-pos-job.mts            # ENSAIO: lista, não manda
 *   npx tsx scripts/feedback-pos-job.mts --enviar   # manda de verdade
 *
 * É um SWEEP, não um gancho, de propósito: `completed`/pago acontece por
 * vários caminhos (a tela, a Zia dos payouts, o Stripe do /pay), e pendurar o
 * envio em cada um é garantir que um deles esqueça. A varredura diária pega
 * todos, e a trava é por job.
 *
 * As regras, na ordem em que cortam:
 *
 *   1. Pago nas últimas 72h. O corte importa MUITO na primeira rodada: sem
 *      ele, o histórico inteiro de jobs pagos receberia o pedido de uma vez.
 *   2. Uma vez por job, para sempre — a trava mora em audit_logs
 *      (action=feedback_requested), que de quebra aparece na timeline do card.
 *   3. A política da conta manda (mig 259): conta com WhatsApp de cliente
 *      desligado (Fantastic) não recebe pedido de feedback também — o cliente
 *      final é da conta, não nosso.
 *   4. CLIENT_MESSAGING_ENABLED=1 é o interruptor geral, o mesmo da
 *      confirmação.
 *   5. Só entre 09h e 20h de LONDRES: pedir feedback de madrugada é pedir
 *      nota baixa.
 *
 * Sai pelo mesmo canal da confirmação (RESPONDIO_CONFIRMATION_CHANNEL_ID — o
 * 07 desde 28/08), template `afterwork_feedback` (aprovado pela
 * Meta em 28/08, uma variável: o nome). Sem link no corpo: a resposta cai na
 * própria conversa do respond.io, onde o time já trabalha.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { createRespondIoClient, phoneIdentifier } from "@/lib/respond-io/client";
import { decidirEnvio, mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";

loadEnvLocal();

const ENVIAR = process.argv.includes("--enviar");
const JANELA_HORAS = Number(process.env.FEEDBACK_WINDOW_HOURS ?? 72); // env só para ensaio/backfill
const TEMPLATE = process.env.RESPONDIO_FEEDBACK_TEMPLATE?.trim() || "afterwork_feedback";
const IDIOMA = process.env.RESPONDIO_CONFIRMATION_LANG?.trim() || "en";
const CANAL = Number(process.env.RESPONDIO_CONFIRMATION_CHANNEL_ID ?? 0) || null;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  (process.env.SERVICE_ROLE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY)!,
  { auth: { persistSession: false } },
);

const horaLondres = Number(
  new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", hour12: false }).format(new Date()),
);
if (ENVIAR && (horaLondres < 9 || horaLondres >= 20)) {
  console.log(`[feedback] fora da janela (9h-20h de Londres, agora ${horaLondres}h): só listando.`);
}
const ENVIAR_AGORA = ENVIAR && horaLondres >= 9 && horaLondres < 20;

if (ENVIAR_AGORA && !mensagensAoClienteLigadas()) {
  console.log("[feedback] CLIENT_MESSAGING_ENABLED não é 1: nada sai.");
  process.exit(0);
}
if (ENVIAR_AGORA && !CANAL) {
  throw new Error("RESPONDIO_CONFIRMATION_CHANNEL_ID ausente: sem canal, sem envio");
}

const desde = new Date(Date.now() - JANELA_HORAS * 3600e3).toISOString();

const { data: jobs, error } = await supabase
  .from("jobs")
  .select("id, reference, title, client_id, client_name, paid_at, payment_status, status")
  .eq("payment_status", "paid")
  .gte("paid_at", desde)
  .is("deleted_at", null)
  .limit(100);
if (error) throw new Error(error.message);

const candidatos = jobs ?? [];
console.log(`[feedback] ${new Date().toISOString().slice(0, 16)} · ${candidatos.length} job(s) pagos nas últimas ${JANELA_HORAS}h · modo ${ENVIAR_AGORA ? "ENVIO" : "ENSAIO"}`);
if (!candidatos.length) process.exit(0);

// A trava: quem já recebeu, nunca mais.
const { data: jaPedidos } = await supabase
  .from("audit_logs")
  .select("entity_id")
  .eq("action", "feedback_requested")
  .in("entity_id", candidatos.map((j) => j.id));
const pedidos = new Set((jaPedidos ?? []).map((a) => a.entity_id));

const respond = ENVIAR_AGORA ? createRespondIoClient() : null;
let ok = 0, pulados = 0, falhas = 0;

for (const j of candidatos) {
  if (pedidos.has(j.id)) { pulados++; continue; }

  const { data: cliente } = j.client_id
    ? await supabase.from("clients").select("full_name, phone, source_account_id").eq("id", j.client_id).maybeSingle()
    : { data: null };
  const { data: conta } = cliente?.source_account_id
    ? await supabase.from("accounts").select("company_name, client_confirmation_whatsapp").eq("id", cliente.source_account_id).maybeSingle()
    : { data: null };

  // A mesma régua da confirmação decide: política da conta + telefone móvel UK
  // válido. `jaEnviadoEm` fica nulo porque a NOSSA trava é a de feedback.
  const decisao = decidirEnvio({
    politicaDaConta: (conta as { client_confirmation_whatsapp?: boolean | null } | null)?.client_confirmation_whatsapp,
    nomeDaConta: (conta as { company_name?: string | null } | null)?.company_name,
    telefoneDoCliente: (cliente as { phone?: string | null } | null)?.phone ?? null,
    jaEnviadoEm: null,
  });
  if (!decisao.manda) {
    pulados++;
    console.log(`· ${j.reference}: pulado — ${decisao.motivo}`);
    continue;
  }

  const primeiroNome =
    String((cliente as { full_name?: string | null } | null)?.full_name ?? j.client_name ?? "").trim().split(/\s+/)[0] || "there";
  const servico = String(j.title ?? "").trim() || "job";

  if (!ENVIAR_AGORA) {
    console.log(`· ${j.reference}: enviaria ${TEMPLATE} → ${primeiroNome} | ${decisao.telefone}`);
    continue;
  }

  try {
    const id = phoneIdentifier(decisao.telefone);
    await respond!.createOrUpdateContact(id, { firstName: primeiroNome, phone: decisao.telefone });
    const { messageId } = await respond!.sendTemplate(
      id,
      {
        name: TEMPLATE,
        languageCode: IDIOMA,
        // afterwork_feedback tem UMA variavel ({{1}} = nome). Mandar mais
        // do que o corpo declara faz a Meta recusar o envio inteiro.
        components: [
          { type: "body", parameters: [{ type: "text" as const, text: primeiroNome }] },
        ],
      },
      CANAL!,
    );
    // A trava grava ANTES de qualquer conferência de entrega: pedido de
    // feedback repetido irrita mais do que um perdido — na dúvida, não repete.
    await supabase.from("audit_logs").insert({
      entity_type: "job", entity_id: j.id, entity_ref: j.reference,
      action: "feedback_requested", user_name: "Fixfy OS",
      new_value: decisao.telefone,
      metadata: { template: TEMPLATE, canal: CANAL, message_id: messageId ?? null, servico },
    });
    ok++;
    console.log(`✓ ${j.reference}: feedback pedido a ${primeiroNome} (${decisao.telefone})`);
  } catch (err) {
    falhas++;
    console.error(`✗ ${j.reference}: ${err instanceof Error ? err.message : err}`);
  }
}

console.log(`[feedback] fim: ${ok} enviado(s), ${pulados} pulado(s), ${falhas} falha(s)`);
