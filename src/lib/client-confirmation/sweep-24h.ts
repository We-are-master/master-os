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

const TEMPLATE = process.env.RESPONDIO_REMINDER_TEMPLATE?.trim() || "24hrs_confirmation";
const IDIOMA = process.env.RESPONDIO_CONFIRMATION_LANG?.trim() || "en";
const CANAL = Number(process.env.RESPONDIO_CONFIRMATION_CHANNEL_ID ?? 0) || null;

/** Status em que faz sentido dizer "chegamos amanhã". */
const AGENDADOS = ["scheduled", "late"];

export type LinhaDaVarredura = {
  reference: string;
  cliente: string;
  resultado: "enviado" | "pulado" | "falhou";
  detalhe: string;
};

/** `2026-08-21`, no fuso de Londres, a partir de um instante qualquer. */
export function amanhaEmLondres(agora: Date): string {
  const amanha = new Date(agora.getTime() + 24 * 60 * 60 * 1000);
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(amanha);
}

const SELECT =
  "id, reference, status, title, scheduled_date, scheduled_start_at, scheduled_end_at, " +
  "partner_id, partner_name, client_id, client_name, client_reminder_sent_at";

export async function varrerLembretesDeVespera(
  supabase: SupabaseClient,
  opcoes?: { agora?: Date; enviarDeVerdade?: boolean; client?: RespondIoClient },
): Promise<{ dia: string; linhas: LinhaDaVarredura[] }> {
  const agora = opcoes?.agora ?? new Date();
  const dia = amanhaEmLondres(agora);
  const enviar = opcoes?.enviarDeVerdade === true;

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

    const parametros = [
      String(c.full_name ?? nomeCliente).trim().split(/\s+/)[0] || "there",
      data,
      janela,
    ];

    if (!enviar) {
      anota("pulado", `dry run: ${TEMPLATE} → ${parametros.join(" | ")} → ${decisao.telefone}`);
      continue;
    }
    if (!mensagensAoClienteLigadas()) {
      anota("pulado", "client messaging is off (CLIENT_MESSAGING_ENABLED)");
      continue;
    }
    if (!CANAL || !respond) {
      anota("pulado", "RESPONDIO_CONFIRMATION_CHANNEL_ID is not set");
      continue;
    }

    try {
      const id = phoneIdentifier(decisao.telefone);
      await respond.createOrUpdateContact(id, { firstName: parametros[0], phone: decisao.telefone });
      await respond.sendTemplate(
        id,
        { name: TEMPLATE, languageCode: IDIOMA, components: [
          { type: "body", parameters: parametros.map((text) => ({ type: "text" as const, text })) },
        ] },
        CANAL,
      );
      await supabase
        .from("jobs")
        .update({ client_reminder_sent_at: new Date().toISOString() })
        .eq("id", String(j.id));
      anota("enviado", `${decisao.telefone} · ${janela}`);
    } catch (err) {
      anota("falhou", err instanceof Error ? err.message.slice(0, 140) : "unknown error");
    }
  }

  return { dia, linhas };
}
