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
import {
  createRespondIoClient,
  phoneIdentifier,
  type RespondIoClient,
} from "@/lib/respond-io/client";
import { decidirEnvio, mensagensAoClienteLigadas } from "./policy";
import { dataPorExtenso, janelaDeChegada } from "./send";

/**
 * Lidos na hora da chamada, não no import.
 *
 * Como constante de módulo isto quebrava em script: `import` é içado para
 * antes do corpo do arquivo, então a constante capturava o valor ANTES de o
 * `loadEnvLocal()` do script rodar, e o canal chegava nulo. O agendador do
 * lembrete de véspera pularia todo job com "nowhere to send from" sem que
 * nada parecesse errado. Descoberto em 22/08/2026, montando o launchd.
 */
const template = () => process.env.RESPONDIO_REMINDER_TEMPLATE?.trim() || "24hrs_confirmation";
const idioma = () => process.env.RESPONDIO_CONFIRMATION_LANG?.trim() || "en";
const canal = () => Number(process.env.RESPONDIO_CONFIRMATION_CHANNEL_ID ?? 0) || null;

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

/** Cedo demais para prometer "chegamos amanhã", e tarde demais para incomodar. */
export const LEMBRETE_HORA_INICIO = 18;
export const LEMBRETE_HORA_FIM = 22;

/**
 * O lembrete só sai das 18h aos 22h de Londres.
 *
 * Antes disso o dia ainda está sendo arrumado: alocação muda, parceiro cai,
 * horário anda. Mandar "chegamos amanhã às 9h" às 10h da manhã da véspera
 * promete um plano que ainda vai mudar, e o cliente recebe a correção depois —
 * ou pior, não recebe. Às 18h o dia seguinte já está fechado.
 *
 * A janela é do relógio de LONDRES, não do relógio da máquina. O launchd dispara
 * no horário local do Mac (São Paulo), e a diferença para Londres muda de 3 para
 * 4 horas duas vezes por ano: um horário fixo no plist andaria sozinho. Quem
 * decide é esta função; o plist só precisa acordar o processo perto da hora.
 *
 * O limite das 22h existe para o Mac que acordou tarde: um WhatsApp à meia-noite
 * não vale o susto. Nesse caso ninguém recebe, e é melhor assim.
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
  "client_reminder_sent_at, client_confirmation_sent_at";

export async function varrerLembretesDeVespera(
  supabase: SupabaseClient,
  opcoes?: {
    agora?: Date;
    enviarDeVerdade?: boolean;
    client?: RespondIoClient;
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
  const respond = opcoes?.client ?? (enviar ? createRespondIoClient() : null);

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
    if (!canal() || !respond) {
      anota("pulado", "RESPONDIO_CONFIRMATION_CHANNEL_ID is not set");
      continue;
    }

    try {
      const id = phoneIdentifier(decisao.telefone);
      await respond.createOrUpdateContact(id, { firstName: parametros[0], phone: decisao.telefone });
      const manda = (params: string[]) =>
        respond!.sendTemplate(
          id,
          { name: template(), languageCode: idioma(), components: [
            { type: "body", parameters: params.map((text) => ({ type: "text" as const, text })) },
          ] },
          canal()!,
        );
      let semEndereco = false;
      try {
        await manda(parametros);
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
        await manda(parametros.slice(0, 3));
        semEndereco = true;
      }
      await supabase
        .from("jobs")
        .update({ client_reminder_sent_at: new Date().toISOString() })
        .eq("id", String(j.id));
      anota(
        "enviado",
        `${decisao.telefone} · ${janela}${semEndereco ? " · sem endereço (template {{4}} ainda pending na Meta)" : ""}`,
      );
    } catch (err) {
      anota("falhou", err instanceof Error ? err.message.slice(0, 140) : "unknown error");
    }
  }

  return { dia, linhas, foraDaJanela };
}
