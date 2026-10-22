/**
 * O lembrete de véspera: os jobs de AMANHÃ, uma mensagem cada.
 *
 * Regra que separa isto da confirmação de nascimento: aqui só entra job que
 * **tem parceiro**. Confirmar no nascimento é dizer "recebemos e agendamos", e
 * isso é verdade mesmo sem parceiro definido. Lembrar na véspera é dizer
 * "chegamos amanhã", e isso é promessa de que alguém vai. Em 20/08/2026 havia
 * 13 jobs para o dia seguinte e um só com parceiro: mandar os treze teria
 * prometido doze visitas que ninguém ia fazer.
 *
 * Nada aqui roda sozinho. Quem chama é o script, e o script é dry-run por
 * padrão. Rota de cron neste repo já soltou parceiro de 15 jobs e disparou 52
 * convites reais numa chamada de teste, e a lição foi que o caminho perigoso
 * precisa de gesto explícito, não de descuido.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { canalDoClienteConfigurado, canalDoClienteFaltando, enviarAoCliente } from "@/lib/harvey-wa/template-zendesk";
import type { EnvioWhatsApp } from "./send";
import { decidirEnvio, mensagensAoClienteLigadas } from "./policy";
import { getZendeskTicketId, isZendeskConfigured, updateTicket } from "@/lib/zendesk";
import { dataPorExtenso, janelaDeChegada } from "./send";
import { chaveDeEnvio, confirmarEnvio, falhouEnvio, reservarEnvio } from "@/lib/idempotencia/envio";

/**
 * Lidos na hora da chamada, não no import.
 *
 * Como constante de módulo isto quebrava em script: `import` é içado para
 * antes do corpo do arquivo, então a constante capturava o valor ANTES de o
 * `loadEnvLocal()` do script rodar, e o canal chegava nulo. O agendador do
 * lembrete de véspera pularia todo job com "nowhere to send from" sem que
 * nada parecesse errado. Descoberto em 22/08/2026, montando o launchd.
 */
const template = () => process.env.WHATSAPP_TEMPLATE_REMINDER?.trim() || "booking_reminder";
const idioma = () => process.env.WHATSAPP_TEMPLATE_LANG?.trim() || "en_GB";

/** Status em que faz sentido dizer "chegamos amanhã". */
const AGENDADOS = ["scheduled", "late"];

export type LinhaDaVarredura = {
  reference: string;
  cliente: string;
  resultado: "enviado" | "pulado" | "falhou";
  detalhe: string;
};

/** Hora do relógio de Londres (0-23) num instante qualquer. */
export function horaEmLondres(agora: Date): number {
  return Number(
    new Intl.DateTimeFormat("en-GB", {
      timeZone: "Europe/London", hour: "2-digit", hour12: false,
    }).format(agora),
  );
}

/**
 * Horário comercial de Londres, 9h às 17h (dono, 14/10/2026: "o 24 horas na
 * véspera dentro das 9-5 pelo WhatsApp"). Era 18h-22h.
 */
export const LEMBRETE_HORA_INICIO = 9;
export const LEMBRETE_HORA_FIM = 17;

/**
 * O lembrete só sai dentro da janela acima, no relógio de LONDRES, não no da
 * máquina: a diferença de fuso muda duas vezes por ano, e quem decide é esta
 * função. O agendador só precisa acordar o processo perto da hora.
 */
export function dentroDaJanelaDoLembrete(agora: Date): boolean {
  const h = horaEmLondres(agora);
  return h >= LEMBRETE_HORA_INICIO && h < LEMBRETE_HORA_FIM;
}

/**
 * Assign de última hora já falou com o cliente (dono, 26/08): se a confirmação
 * de booking saiu nas últimas 24 horas, ela mesma já disse a data e a janela de
 * amanhã — o lembrete seria a SEGUNDA mensagem da mesma noite dizendo a mesma
 * coisa. Confirmação mais antiga que 24h é outra história: aí o lembrete de
 * véspera trabalha normalmente.
 */
export function confirmacaoRecente(
  sentAt: string | null | undefined,
  agora: Date,
): boolean {
  if (!sentAt) return false;
  const t = new Date(sentAt).getTime();
  if (Number.isNaN(t)) return false;
  return agora.getTime() - t < 24 * 60 * 60 * 1000;
}

/** `2026-08-21`, no fuso de Londres, a partir de um instante qualquer. */
export function amanhaEmLondres(agora: Date): string {
  const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(amanha);
}

const SELECT =
  "id, reference, status, title, scheduled_date, scheduled_start_at, scheduled_end_at, " +
  "partner_id, partner_name, client_id, client_name, property_address, " +
  "client_reminder_sent_at, client_confirmation_sent_at, external_source, external_ref";

export async function varrerLembretesDeVespera(
  supabase: SupabaseClient,
  opcoes?: {
    agora?: Date;
    enviarDeVerdade?: boolean;
    /** Injeção para teste: no ar quem manda é a Cloud API. */
    enviar?: EnvioWhatsApp;
    /** Para envio manual fora da janela. O agendador nunca passa isto. */
    ignorarJanela?: boolean;
  },
): Promise<{ dia: string; linhas: LinhaDaVarredura[]; foraDaJanela: boolean }> {
  const agora = opcoes?.agora ?? new Date();
  const dia = amanhaEmLondres(agora);
  const naJanela = opcoes?.ignorarJanela === true || dentroDaJanelaDoLembrete(agora);
  // Fora da hora a varredura continua LISTANDO, só não manda: quem roda à mão
  // no meio da tarde quer ver o que sairia hoje à noite.
  const enviar = opcoes?.enviarDeVerdade === true && naJanela;
  const foraDaJanela = opcoes?.enviarDeVerdade === true && !naJanela;

  const { data: jobs, error } = await supabase
    .from("jobs")
    .select(SELECT)
    .eq("scheduled_date", dia)
    .in("status", AGENDADOS)
    .is("client_reminder_sent_at", null);

  /**
   * Erro de consulta NÃO vira "nenhum job".
   *
   * Sem este throw, uma coluna faltando devolve `data: null`, o laço não roda e
   * a varredura imprime "nenhum job agendado para amanhã" com dezessete jobs
   * agendados para amanhã. Foi exatamente assim que quatro notificações do
   * Zendesk ficaram mortas sem ninguém perceber, e o teste desta varredura caiu
   * no mesmo buraco na primeira execução.
   */
  if (error) {
    throw new Error(`could not read tomorrow's jobs: ${error.message}`);
  }

  const linhas: LinhaDaVarredura[] = [];
  const manda: EnvioWhatsApp = opcoes?.enviar ?? enviarAoCliente;

  for (const raw of jobs ?? []) {
    const j = raw as unknown as Record<string, unknown>;
    const ref = String(j.reference);
    const nomeCliente = String(j.client_name ?? "");
    const anota = (resultado: LinhaDaVarredura["resultado"], detalhe: string) =>
      linhas.push({ reference: ref, cliente: nomeCliente, resultado, detalhe });

    // Sem parceiro não se promete visita. É a diferença entre este lembrete e
    // a confirmação de nascimento, e é o guarda mais importante daqui.
    if (!j.partner_id) {
      anota("pulado", "no partner assigned: nothing to promise for tomorrow");
      continue;
    }

    if (confirmacaoRecente(j.client_confirmation_sent_at as string | null, agora)) {
      anota("pulado", "booking confirmation went out in the last 24h: one message is enough");
      continue;
    }

    const { data: cliente } = await supabase
      .from("clients")
      .select("full_name, phone, source_account_id")
      .eq("id", String(j.client_id ?? ""))
      .maybeSingle();
    const c = (cliente ?? {}) as Record<string, unknown>;

    let politica: boolean | null | undefined;
    let nomeDaConta: string | null = null;
    if (typeof c.source_account_id === "string") {
      const { data: conta } = await supabase
        .from("accounts")
        .select("company_name, client_confirmation_whatsapp")
        .eq("id", c.source_account_id)
        .maybeSingle();
      politica = (conta as { client_confirmation_whatsapp?: boolean | null } | null)?.client_confirmation_whatsapp;
      nomeDaConta = (conta as { company_name?: string | null } | null)?.company_name ?? null;
    }

    const decisao = decidirEnvio({
      politicaDaConta: politica,
      nomeDaConta,
      telefoneDoCliente: c.phone as string | null,
      jaEnviadoEm: j.client_reminder_sent_at as string | null,
    });
    if (!decisao.manda) {
      anota("pulado", decisao.motivo);
      continue;
    }

    const janela = janelaDeChegada(j.scheduled_start_at as string, j.scheduled_end_at as string);
    const data = dataPorExtenso(j.scheduled_date as string);
    if (!data || !janela) {
      anota("pulado", "no arrival window on the job");
      continue;
    }

    /**
     * {{4}} do template `24hrsbooking_confirmation` (dono, 31/08): a linha
     * "📍 endereço", para o cliente confirmar que vamos à porta certa. A Meta
     * recusa parâmetro vazio ou com quebra de linha, então endereço ausente
     * pula o job (e aparece na varredura) em vez de derrubar o envio inteiro.
     */
    const endereco = String(j.property_address ?? "").replace(/\s+/g, " ").trim();
    if (!endereco) {
      anota("pulado", "no property address on the job: template needs it to confirm the door");
      continue;
    }

    const parametros = [
      String(c.full_name ?? nomeCliente).trim().split(/\s+/)[0] || "there",
      data,
      janela,
      endereco,
    ];

    if (!enviar) {
      const motivo = foraDaJanela
        ? `fora da janela (${LEMBRETE_HORA_INICIO}h-${LEMBRETE_HORA_FIM}h de Londres, agora são ${horaEmLondres(agora)}h)`
        : "dry run";
      anota("pulado", `${motivo}: ${template()} → ${parametros.join(" | ")} → ${decisao.telefone}`);
      continue;
    }
    if (!mensagensAoClienteLigadas()) {
      anota("pulado", "client messaging is off (CLIENT_MESSAGING_ENABLED)");
      continue;
    }
    // Sai pelo número do Zendesk desde 08/10/2026 (a Cloud API direta dava #200).
    if (!canalDoClienteConfigurado()) {
      anota("pulado", canalDoClienteFaltando());
      continue;
    }

    // Reserva antes de mandar (22/10/2026): duas rodadas ao mesmo tempo, ou o carimbo
    // falhando depois da entrega, mandavam de novo. A chave leva o horário marcado: remarcar
    // para outro horário gera lembrete novo; voltar ao mesmo horário não repete.
    const chaveDoLembrete = chaveDeEnvio("lembrete-24h", String(j.id), String(j.scheduled_start_at ?? j.scheduled_date ?? ""));
    const reserva = await reservarEnvio(supabase, { chave: chaveDoLembrete, finalidade: "lembrete-24h", canal: "whatsapp", jobId: String(j.id), destinatario: decisao.telefone, template: template(), motivo: "job scheduled for tomorrow" });
    if (!reserva.reservado) {
      anota("pulado", `reminder already handled (${reserva.motivo ?? "reserved"})`);
      continue;
    }

    try {
      const mandarCom = (params: string[]) =>
        manda({ to: decisao.telefone, name: template(), language: idioma(), bodyParams: params });
      let semEndereco = false;
      try {
        await mandarCom(parametros);
      } catch (err) {
        /**
         * Corrida de aprovação da Meta (31/08): a versão do template com o
         * endereço ({{4}}) fica "pending" e a Meta continua servindo a
         * aprovada de 3 variáveis — mandar 4 contra ela é rejeitado por
         * contagem. SÓ quando o erro é claramente de template/parâmetro
         * (rejeição ANTES de entregar) vale reenviar com 3; qualquer outro
         * erro pode ser pós-entrega, e reenviar duplicaria a mensagem.
         */
        const msg = err instanceof Error ? err.message : "";
        const erroDeTemplate = /param|template|132000|localizable|number of/i.test(msg);
        if (!erroDeTemplate || parametros.length < 4) throw err;
        await mandarCom(parametros.slice(0, 3));
        semEndereco = true;
      }
      await confirmarEnvio(supabase, chaveDoLembrete);
      await supabase
        .from("jobs")
        .update({ client_reminder_sent_at: new Date().toISOString() })
        .eq("id", String(j.id));
      // Registro no ticket do job (dono, 14/10/2026: "envia dentro do mesmo
      // ticket"): a mensagem sai pelo WhatsApp, a nota fica no pedido.
      const ticketDoJob = isZendeskConfigured() ? getZendeskTicketId(j as never) : null;
      if (ticketDoJob) {
        await updateTicket({
          ticketId: ticketDoJob,
          commentBody: `📱 Day-before reminder sent on WhatsApp to ${decisao.telefone}: ${data}, arrival ${janela}, ${endereco}.`,
          publicComment: false,
        }).catch((e) => console.warn("[lembrete-24h] nota no ticket:", e instanceof Error ? e.message : e));
      }
      anota(
        "enviado",
        `${decisao.telefone} · ${janela}${semEndereco ? " · sem endereço (template {{4}} ainda pending na Meta)" : ""}`,
      );
    } catch (err) {
      await falhouEnvio(supabase, chaveDoLembrete, err).catch(() => undefined);
      anota("falhou", err instanceof Error ? err.message.slice(0, 140) : "unknown error");
    }
  }

  return { dia, linhas, foraDaJanela };
}
