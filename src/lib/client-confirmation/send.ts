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
import {
  createRespondIoClient,
  phoneIdentifier,
  type RespondIoClient,
} from "@/lib/respond-io/client";
import { decidirEnvio, mensagensAoClienteLigadas } from "./policy";

/**
 * Nome e canal do template vivem em env, e não em constante, porque template é
 * de painel: o nome é escolhido por quem submete à Meta, e o canal decide QUAL
 * marca o cliente vê no perfil (539660 é Fixfy, 544116 é Master Services).
 * Mandar pelo canal errado entrega a mensagem certa com o remetente errado.
 */
/**
 * Lidos na hora da chamada, não no import.
 *
 * Como constante de módulo isto quebrava em script: `import` é içado para
 * antes do corpo do arquivo, então a constante capturava o valor ANTES de o
 * `loadEnvLocal()` do script rodar, e o canal chegava nulo. O agendador do
 * lembrete de véspera pularia todo job com "nowhere to send from" sem que
 * nada parecesse errado. Descoberto em 22/08/2026, montando o launchd.
 */
const template = () => process.env.RESPONDIO_CONFIRMATION_TEMPLATE?.trim() || "booking_confirmed";
const idioma = () => process.env.RESPONDIO_CONFIRMATION_LANG?.trim() || "en";
const canal = () => Number(process.env.RESPONDIO_CONFIRMATION_CHANNEL_ID ?? 0) || null;

/**
 * A tag que o Workflow do respond.io escuta para mover a fase para Converted.
 *
 * O nome importa: é o gatilho configurado no painel deles. Mudar aqui sem
 * mudar lá quebra o funil em silêncio, porque a tag continua sendo gravada.
 */
const TAG_CONFIRMADO = "booking_confirmed";

/** Quanto esperar pela confirmação de entrega antes de desistir de esperar. */
const TENTATIVAS_STATUS = 5;
const ESPERA_MS = 3000;

export type ResultadoConfirmacao =
  | { estado: "enviado"; telefone: string; messageId: number }
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
 * Espera a entrega de verdade.
 *
 * `sendTemplate` responder 200 só diz que o respond.io ACEITOU. A entrega é
 * assíncrona e o status vira `failed` segundos depois, com o motivo. Foi assim
 * que 90 leads pagos foram consumidos sem ninguém receber nada. Enquanto o
 * status não for terminal, não se grava `sent_at`.
 */
async function confirmarEntrega(
  respond: RespondIoClient,
  id: ReturnType<typeof phoneIdentifier>,
  messageId: number,
): Promise<{ ok: boolean; detalhe: string }> {
  for (let i = 0; i < TENTATIVAS_STATUS; i++) {
    await new Promise((r) => setTimeout(r, ESPERA_MS));
    const status = await respond.messageStatus(id, messageId).catch(() => []);
    const valores = status.map((s) => String(s.value ?? "").toLowerCase());
    if (valores.some((v) => v === "failed" || v === "rejected")) {
      const erro = status.find((s) => s.message)?.message ?? "no reason given";
      return { ok: false, detalhe: erro };
    }
    if (valores.some((v) => v === "delivered" || v === "read" || v === "sent")) {
      return { ok: true, detalhe: valores.join(",") };
    }
  }
  // Sem status terminal no tempo que demos. Não é falha: o WhatsApp entrega
  // para telefone desligado horas depois. Tratar como enviado e seguir.
  return { ok: true, detalhe: "no terminal status yet" };
}

export async function enviarConfirmacaoDoCliente(
  supabase: SupabaseClient,
  jobId: string,
  opcoes?: { client?: RespondIoClient; simular?: boolean },
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

  // Sem canal configurado NÃO se manda pelo canal padrão: o padrão pode ser o
  // canal de parceiro, e aí o cliente recebe a confirmação com a marca errada
  // no perfil. Melhor virar pendência visível.
  if (!canal()) {
    return anotarPulo("RESPONDIO_CONFIRMATION_CHANNEL_ID is not set: nowhere to send from");
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

  const respond = opcoes?.client ?? createRespondIoClient();
  const id = phoneIdentifier(decisao.telefone);

  try {
    // O contato precisa existir antes da mensagem. Só nome e telefone: o campo
    // `trade` é uma lista fechada e gravar valor fora do enum faz a API recusar
    // o contato INTEIRO, então custom field nenhum entra por aqui.
    await respond.createOrUpdateContact(id, {
      firstName: parametros[0],
      phone: decisao.telefone,
    });

    const { messageId } = await respond.sendTemplate(
      id,
      { name: template(), languageCode: idioma(), components: [
        { type: "body", parameters: parametros.map((text) => ({ type: "text" as const, text })) },
      ] },
      canal()!,
    );

    const entrega = await confirmarEntrega(respond, id, messageId);
    if (!entrega.ok) {
      const motivo = `WhatsApp did not deliver: ${entrega.detalhe}`;
      console.error(`[confirmacao] ${jobId} ${motivo}`);
      await supabase.from("jobs").update({ client_confirmation_skipped: motivo }).eq("id", jobId);
      return { estado: "falhou", motivo };
    }

    await supabase
      .from("jobs")
      .update({ client_confirmation_sent_at: new Date().toISOString(), client_confirmation_skipped: null })
      .eq("id", jobId);

    /**
     * A conversa sai do funil de venda: isto aqui é só confirmação.
     *
     * Quem recebe esta mensagem já é cliente, com job marcado. Deixá-lo em
     * "New Lead" enche o funil de gente que não há o que vender, e o vendedor
     * perde tempo com quem já comprou (pedido do dono, 22/08/2026).
     *
     * A fase se move por tag, e não direto, porque `lifecycle` não tem escrita
     * na API v2: todo caminho responde 404 e o `create_or_update` aceita o
     * campo e o descarta devolvendo 200. No respond.io quem muda fase é
     * Workflow, e a tag é o gatilho que ele enxerga vindo de fora.
     *
     * Sem `await` e engolindo o erro: a mensagem já chegou ao morador, que é o
     * que importa. Falhar em arrumar o funil não pode transformar um envio
     * bem-sucedido em erro.
     */
    void respond
      .addTags(id, [TAG_CONFIRMADO])
      .catch((e) => console.error(`[confirmacao] ${jobId} tag ${TAG_CONFIRMADO} falhou:`, e));

    console.log(`[confirmacao] ${jobId} enviado para ${decisao.telefone} (${entrega.detalhe})`);
    return { estado: "enviado", telefone: decisao.telefone, messageId };
  } catch (err) {
    const motivo = err instanceof Error ? err.message.slice(0, 200) : "unknown error";
    console.error(`[confirmacao] ${jobId} falhou: ${motivo}`);
    await supabase.from("jobs").update({ client_confirmation_skipped: motivo }).eq("id", jobId);
    return { estado: "falhou", motivo };
  }
}
