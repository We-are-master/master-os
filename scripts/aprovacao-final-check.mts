/**
 * APROVAÇÃO DO CLIENTE — o WhatsApp que pergunta "está tudo certo?" quando o
 * job entra em FINAL CHECK.
 *
 *   npx tsx scripts/aprovacao-final-check.mts            # ENSAIO: lista, não manda
 *   npx tsx scripts/aprovacao-final-check.mts --enviar   # manda de verdade
 *
 * Nasceu de um erro de gatilho (dono, 01/09/2026). O texto aprovado na Meta
 * sempre foi de aprovação PRÉ-fechamento — "Before we close the job, could you
 * please confirm that everything has been completed to your satisfaction?" —
 * mas quem o disparava era o `feedback-pos-job`, que roda em cima de
 * `payment_status = paid`. A cliente do JOB-9541 recebeu o pedido de aprovação
 * DEPOIS de ter pago, e dois dias depois do serviço.
 *
 * ── A carência de 5 minutos ──────────────────────────────────────────────
 *
 * Job só entra na conta 5 minutos depois de chegar em final check. É a janela
 * para desfazer: se alguém arrastou por engano e voltou, a varredura seguinte
 * simplesmente NÃO ENCONTRA o job, porque a condição deixou de ser verdadeira.
 *
 * Isso é o motivo de ser varredura e não um timer de 5 minutos no servidor.
 * Timer vive na memória de um processo que reinicia sozinho, e teria que ser
 * cancelado à mão em cada caminho que tira o job de final check. Aqui não há
 * nada para cancelar.
 *
 * ── Por que `final_check_at` e não `updated_at` ──────────────────────────
 *
 * A tela mostrava "In final checks 18h ago" lendo `updated_at`, que é a última
 * edição. Corrigir o custo do parceiro reiniciava a contagem, e a mensagem de
 * um job que o time fica ajustando nunca sairia. A coluna da migração 283 é
 * carimbada por TRIGGER na mudança de status, então vale para a tela, para
 * agente e para script.
 *
 * As regras, na ordem em que cortam:
 *
 *   1. status = final_check E entrou há mais de 5 minutos.
 *   2. Uma vez por job: `client_approval_requested_at`. Se o job voltar para
 *      execução e retornar a final check, NÃO pede de novo.
 *   3. A política da conta manda: conta com WhatsApp de cliente desligado não
 *      recebe pedido de aprovação. O cliente final é da conta, não nosso.
 *   4. CLIENT_MESSAGING_ENABLED=1 é o interruptor geral.
 *   5. Só entre 09h e 20h de LONDRES.
 *
 * Mesmo canal e mesmo template da mensagem que já saía, porque o texto sempre
 * foi o certo para este momento: nada novo para aprovar na Meta.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./load-env-local.mjs";
import { createRespondIoClient, phoneIdentifier } from "@/lib/respond-io/client";
import { decidirEnvio, mensagensAoClienteLigadas } from "@/lib/client-confirmation/policy";

loadEnvLocal();

const ENVIAR = process.argv.includes("--enviar");
/** A carência. Em env só para ensaio; a decisão de negócio é 5. */
const CARENCIA_MIN = Number(process.env.FINAL_CHECK_GRACE_MIN ?? 5);
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
const naJanela = horaLondres >= 9 && horaLondres < 20;
if (ENVIAR && !naJanela) {
  console.log(`[aprovacao] fora da janela (9h-20h de Londres, agora ${horaLondres}h): só listando.`);
}
const ENVIAR_AGORA = ENVIAR && naJanela;

if (ENVIAR_AGORA && !mensagensAoClienteLigadas()) {
  console.log("[aprovacao] CLIENT_MESSAGING_ENABLED não é 1: nada sai.");
  process.exit(0);
}
if (ENVIAR_AGORA && !CANAL) {
  throw new Error("RESPONDIO_CONFIRMATION_CHANNEL_ID ausente: sem canal, sem envio");
}

const limite = new Date(Date.now() - CARENCIA_MIN * 60_000).toISOString();

const { data: jobs, error } = await supabase
  .from("jobs")
  .select("id, reference, title, client_id, client_name, final_check_at")
  .eq("status", "final_check")
  .not("final_check_at", "is", null)
  .lte("final_check_at", limite)
  .is("client_approval_requested_at", null)
  .is("deleted_at", null)
  .limit(100);
/** Erro de consulta NÃO vira "nenhum job": coluna faltando devolve null e a
 *  varredura imprimiria "nada a fazer" com gente esperando aprovação. */
if (error) throw new Error(error.message);

const candidatos = jobs ?? [];
console.log(
  `[aprovacao] ${new Date().toISOString().slice(0, 16)} · ${candidatos.length} job(s) em final check há mais de ${CARENCIA_MIN}min · modo ${ENVIAR_AGORA ? "ENVIO" : "ENSAIO"}`,
);
if (!candidatos.length) process.exit(0);

const respond = ENVIAR_AGORA ? createRespondIoClient() : null;
let ok = 0, pulados = 0, falhas = 0;

for (const j of candidatos) {
  const { data: cliente } = j.client_id
    ? await supabase.from("clients").select("full_name, phone, source_account_id").eq("id", j.client_id).maybeSingle()
    : { data: null };
  const { data: conta } = (cliente as { source_account_id?: string } | null)?.source_account_id
    ? await supabase
        .from("accounts")
        .select("company_name, client_confirmation_whatsapp")
        .eq("id", (cliente as { source_account_id: string }).source_account_id)
        .maybeSingle()
    : { data: null };

  const decisao = decidirEnvio({
    politicaDaConta: (conta as { client_confirmation_whatsapp?: boolean | null } | null)?.client_confirmation_whatsapp,
    nomeDaConta: (conta as { company_name?: string | null } | null)?.company_name,
    telefoneDoCliente: (cliente as { phone?: string | null } | null)?.phone ?? null,
    jaEnviadoEm: null,
  });
  if (!decisao.manda) {
    console.log(`· ${j.reference}: pulado — ${decisao.motivo}`);
    pulados++;
    continue;
  }

  const primeiroNome =
    String((cliente as { full_name?: string } | null)?.full_name ?? j.client_name ?? "").trim().split(/\s+/)[0] || "there";

  if (!ENVIAR_AGORA) {
    console.log(`→ ${j.reference}: pediria aprovação a ${primeiroNome} (${decisao.telefone})`);
    continue;
  }

  try {
    const id = phoneIdentifier(decisao.telefone);
    await respond!.createOrUpdateContact(id, { firstName: primeiroNome, phone: decisao.telefone });
    await respond!.sendTemplate(
      id,
      {
        name: TEMPLATE,
        languageCode: IDIOMA,
        components: [{ type: "body", parameters: [{ type: "text", text: primeiroNome }] }],
      },
      CANAL!,
    );
    // A trava só depois do envio aceito: gravar antes deixa job marcado como
    // pedido sem ninguém ter recebido nada.
    await supabase
      .from("jobs")
      .update({ client_approval_requested_at: new Date().toISOString() })
      .eq("id", j.id);
    console.log(`✓ ${j.reference}: aprovação pedida a ${primeiroNome} (${decisao.telefone})`);
    ok++;
  } catch (e) {
    console.log(`✗ ${j.reference}: ${e instanceof Error ? e.message.slice(0, 160) : "erro"}`);
    falhas++;
  }
}

console.log(`[aprovacao] fim: ${ok} enviado(s), ${pulados} pulado(s), ${falhas} falha(s)`);
