/**
 * Manda a confirmação de agendamento para o cliente final, no WhatsApp dele.
 *
 * Dispara quando o job nasce no OS, que é quando o agendamento passa a existir
 * de verdade. Quem decide SE manda é `policy.ts`, por conta; aqui só se
 * executa e se grava o resultado.
 *
 * O estado mora no JOB, não no respond.io. O respond.io é cano: ele transporta
 * a mensagem e sabe do contato, mas quem sabe se este job já foi confirmado é o
 * OS. Estado em dois lugares é estado que discorda no primeiro dia em que
 * alguém arrasta um card na tela do respond.io.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { sendTemplate, whatsappConfigured } from "@/lib/whatsapp/cloud";
import { decidirEnvio, mensagensAoClienteLigadas } from "./policy";

/**
 * Nome e idioma do template vivem em env, e não em constante, porque template
 * é de painel: quem submete à Meta é que escolhe o nome, e mudar o nome não
 * pode exigir deploy.
 *
 * Lidos na hora da chamada, não no import: como constante de módulo isto
 * quebrava em script, porque `import` é içado para antes do corpo do arquivo e
 * a constante capturava o valor ANTES de o `loadEnvLocal()` rodar. O agendador
 * do lembrete pularia todo job sem que nada parecesse errado (22/08/2026).
 */
const template = () => process.env.WHATSAPP_TEMPLATE_CONFIRMATION?.trim() || "booking_confirmation";
const idioma = () => process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en";

export type ResultadoConfirmacao =
  | { estado: "enviado"; telefone: string; messageId: string }
  | { estado: "pulado"; motivo: string }
  | { estado: "falhou"; motivo: string };

const JOB_SELECT =
  "id, reference, title, status, partner_id, scheduled_date, scheduled_start_at, scheduled_end_at, " +
  "client_id, client_name, client_confirmation_sent_at";

/** `2026-08-21` → `Thursday 21 August`, em Londres, como o cliente lê. */
export function dataPorExtenso(ymd: string | null | undefined): string | null {
  const t = String(ymd ?? "").slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const [y, m, d] = t.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (Number.isNaN(dt.getTime())) return null;
  return new Intl.DateTimeFormat("en-GB", {
    weekday: "long", day: "numeric", month: "long", timeZone: "UTC",
  }).format(dt);
}

/** `09:00 to 12:00`, em Londres. Null quando falta uma das pontas. */
export function janelaDeChegada(
  inicio: string | null | undefined,
  fim: string | null | undefined,
): string | null {
  if (!inicio || !fim) return null;
  const hhmm = (iso: string) => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Europe/London",
    }).format(d);
  };
  const a = hhmm(inicio), b = hhmm(fim);
  return a && b ? `${a} to ${b}` : null;
}

/** Primeiro nome: é como se fala com alguém no WhatsApp. */
function primeiroNome(completo: string | null | undefined): string {
  return String(completo ?? "").trim().split(/\s+/)[0] || "there";
}

/**
 * O que a Cloud API devolve é aceitação, não entrega: a entrega chega depois,
 * por webhook, e ainda não escutamos esse webhook. Então o id da mensagem é o
 * que grava o envio e é por ele que se acha a mensagem no painel da Meta
 * quando alguém disser que não recebeu. Um número inválido, que era a falha
 * comum no canal antigo, aqui volta na hora, como erro da chamada.
 */
export type EnvioWhatsApp = typeof sendTemplate;

export async function enviarConfirmacaoDoCliente(
  supabase: SupabaseClient,
  jobId: string,
  opcoes?: { enviar?: EnvioWhatsApp; simular?: boolean },
): Promise<ResultadoConfirmacao> {
  // Rastro no log para os primeiros dias: sem isto, "não mandou" e "mandou e
  // não entregou" ficam iguais na tela de quem opera, e o motivo só existiria
  // dentro do card de um job que ninguém pensou em abrir.
  const anotarPulo = async (motivo: string): Promise<ResultadoConfirmacao> => {
    console.log(`[confirmacao] ${jobId} pulado: ${motivo}`);
    await supabase.from("jobs").update({ client_confirmation_skipped: motivo }).eq("id", jobId);
    return { estado: "pulado", motivo };
  };

  // A trava vem antes de tudo, inclusive antes de ler o job: desligada, este
  // caminho não toca no banco nem no respond.io.
  if (!mensagensAoClienteLigadas() && !opcoes?.simular) {
    return { estado: "pulado", motivo: "client messaging is off (CLIENT_MESSAGING_ENABLED)" };
  }

  const { data: job } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return { estado: "falhou", motivo: "job not found" };
  const j = job as unknown as Record<string, unknown>;

  /**
   * SEM PARCEIRO NÃO SE FALA COM O CLIENTE. Regra do dono (26/08/2026).
   *
   * Esta função nasceu disparando no nascimento do job, com o argumento de que
   * "recebemos e agendamos" é verdade mesmo sem parceiro definido. Na prática
   * não é o que o cliente lê: ele recebe um `booking_confirmed`, a mensagem
   * dispara o workflow "Booking - Confirmed" do respond.io, o contato vira
   * Converted, e ele responde "Hi, I would like to cancel this order" — porque
   * para ele acabou de nascer um pedido que ele não reconhece.
   *
   * E o custo é maior que o susto: job `unassigned` é job que ainda estamos
   * tentando colocar. Confirmar antes de ter quem vá é prometer uma visita que
   * pode não existir, e transforma um job que talvez fosse devolvido em
   * silêncio numa reclamação com o cliente final no meio.
   *
   * Agora o gatilho é o parceiro, não o nascimento. Os três chamadores
   * continuam chamando; o portão é aqui, uma vez só, porque a regra é uma só e
   * espalhá-la por três lugares é garantir que um deles fique para trás.
   * Quando o parceiro aceita, `job-partner-acceptance` chama de novo e a
   * confirmação sai — no momento em que ela é verdade.
   */
  if (!j.partner_id) {
    return anotarPulo("no partner assigned yet: nothing to confirm to the client");
  }

  const clientId = typeof j.client_id === "string" ? j.client_id : null;
  if (!clientId) return anotarPulo("job has no client record");

  const { data: cliente } = await supabase
    .from("clients")
    .select("id, full_name, phone, source_account_id")
    .eq("id", clientId)
    .maybeSingle();
  const c = (cliente ?? {}) as Record<string, unknown>;

  // A conta do cliente é quem manda na decisão. `company_name`, não `name`:
  // nenhuma tabela deste banco chama a coluna de nome de `name`.
  let politica: boolean | null | undefined;
  let nomeDaConta: string | null = null;
  const accountId = typeof c.source_account_id === "string" ? c.source_account_id : null;
  if (accountId) {
    const { data: conta } = await supabase
      .from("accounts")
      .select("id, company_name, client_confirmation_whatsapp")
      .eq("id", accountId)
      .maybeSingle();
    politica = (conta as { client_confirmation_whatsapp?: boolean | null } | null)?.client_confirmation_whatsapp;
    nomeDaConta = (conta as { company_name?: string | null } | null)?.company_name ?? null;
  }

  const decisao = decidirEnvio({
    politicaDaConta: politica,
    nomeDaConta,
    telefoneDoCliente: c.phone as string | null,
    jaEnviadoEm: j.client_confirmation_sent_at as string | null,
  });
  if (!decisao.manda) return anotarPulo(decisao.motivo);

  // Sem número configurado não se inventa remetente: vira pendência visível.
  if (!whatsappConfigured()) {
    return anotarPulo("WhatsApp is not configured (WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID)");
  }

  const data = dataPorExtenso((j.scheduled_date as string) ?? (j.scheduled_start_at as string));
  const janela = janelaDeChegada(j.scheduled_start_at as string, j.scheduled_end_at as string);
  const servico = String(j.title ?? "").trim();
  if (!data || !janela) {
    return anotarPulo(
      !data ? "job has no scheduled date" : "job has no arrival window: nothing to confirm",
    );
  }

  const parametros = [
    primeiroNome((c.full_name as string) ?? (j.client_name as string)),
    data,
    janela,
    servico || "your booking",
  ];

  if (opcoes?.simular) {
    return { estado: "pulado", motivo: `dry run: would send ${template()} → ${parametros.join(" | ")}` };
  }

  const enviar = opcoes?.enviar ?? sendTemplate;

  try {
    const { messageId } = await enviar({
      to: decisao.telefone,
      name: template(),
      language: idioma(),
      bodyParams: parametros,
    });

    await supabase
      .from("jobs")
      .update({ client_confirmation_sent_at: new Date().toISOString(), client_confirmation_skipped: null })
      .eq("id", jobId);

    console.log(`[confirmacao] ${jobId} enviado para ${decisao.telefone} (${messageId})`);
    return { estado: "enviado", telefone: decisao.telefone, messageId };
  } catch (err) {
    const motivo = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(`[confirmacao] ${jobId} falhou: ${motivo}`);
    await supabase.from("jobs").update({ client_confirmation_skipped: motivo }).eq("id", jobId);
    return { estado: "falhou", motivo };
  }
}
