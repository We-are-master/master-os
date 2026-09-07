/**
 * A plataforma remarcou um job nosso. Aplica a data nova e avisa os dois lados.
 *
 * ─── O que estava acontecendo ────────────────────────────────────────────
 *
 * O e-mail de remarcação traz cliente, endereço e uma data — os três campos
 * que o extrator de booking procura — então o Harvey o lia como job NOVO e
 * tentava criar um duplicado. Não criou nenhum ainda por sorte: faltou dado nos
 * casos que chegaram. Um e-mail mais completo teria criado.
 *
 * E o job de verdade ficava com a data velha. O JOB-9444 é a conta do prejuízo:
 * a Housekeep avisou em 14/08/2026 que a visita passava de sábado 15 para
 * segunda 17, ninguém aplicou, e o job foi executado e cobrado com a data
 * errada no OS. Se um parceiro estivesse alocado, ele teria ido no dia errado.
 *
 * ─── As travas ───────────────────────────────────────────────────────────
 *
 * 1. Só age com match INEQUÍVOCO de job, como o vigia de cancelamentos. Job
 *    errado remarcado é pior que remarcação não aplicada: some da vista.
 * 2. Data nova é obrigatória. Sem ela não há o que aplicar, e "reschedule" sem
 *    data é pedido de contato, não instrução.
 * 3. Se a data e a janela já são as que o e-mail pede, não faz nada e não
 *    avisa ninguém — o reenvio do mesmo e-mail é comum.
 * 4. Nunca mexe em job cuja visita já aconteceu (`in_progress` em diante), nem
 *    aplica data no passado. E-mail antigo reprocessado não pode virar aviso.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Job } from "@/types/database";
import { createServiceClient } from "@/lib/supabase/service";
import { ukWallClockToUtcIso } from "@/lib/utils/uk-time";
import { notifyPartnerJobZendesk } from "@/lib/notify-partner-job-zendesk-server";
import { avisarClienteDaRemarcacao } from "@/lib/notify-client-reschedule-server";
import { acharJobDoTicket } from "./achar-job";

export type ResultadoRemarcacao =
  | { acao: "aplicada"; reference: string; de: string; para: string; como: string; nota: string }
  | { acao: "ja_estava"; reference: string; nota: string }
  | { acao: "nota"; nota: string }
  | { acao: "ensaio"; reference: string; de: string; para: string; como: string; nota: string }
  | { acao: "nada" };

interface Lida {
  isRemarcacao: boolean;
  date: string | null;
  startTime: string | null;
  endTime: string | null;
  postcode: string | null;
  clientName: string | null;
  reason: string | null;
}

async function lerRemarcacao(subject: string, texto: string, apiKey: string): Promise<Lida> {
  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            'You read a helpdesk ticket and decide if a booked job HAS BEEN MOVED to a new date or time slot. Strict JSON: {"is_reschedule":bool,"date":"YYYY-MM-DD"|null,"start_time":"HH:MM"|null,"end_time":"HH:MM"|null,"postcode":str|null,"client_name":str|null,"reason":str|null}.\n\nRules:\n- is_reschedule is true ONLY when the message states the NEW date or the NEW arrival window of an existing booking. A request to reschedule with no new date, a cancellation, or a new booking are all false.\n- date/start_time/end_time describe the NEW schedule, never the old one. "Arrival time: 15:00-18:00 start" means start_time 15:00 and end_time 18:00.\n- Use only values written in the text. Never infer a year, never guess a time.\n- reason: one short phrase if the text gives one, else null.\n- The text may carry SEVERAL updates for the same booking, stacked newest first. When it does, answer with the one at the TOP and ignore every block below it: the last thing the customer asked for is the only one that counts.',
        },
        { role: "user", content: `Subject: ${subject}\n\n${texto}` },
      ],
    }),
  });
  if (!res.ok) throw new Error(`OpenAI remarcacao: HTTP ${res.status}`);
  const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const j = JSON.parse(json.choices?.[0]?.message?.content ?? "{}") as Record<string, unknown>;
  return {
    isRemarcacao: j.is_reschedule === true,
    date: (j.date as string) || null,
    startTime: (j.start_time as string) || null,
    endTime: (j.end_time as string) || null,
    postcode: (j.postcode as string) || null,
    clientName: (j.client_name as string) || null,
    reason: (j.reason as string) || null,
  };
}

/** "Wed 9 Sep 2026" e "3PM – 6PM", para o e-mail dos dois lados. */
const linhaDeData = (ymd: string): string =>
  new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    year: "numeric",
  }).format(new Date(`${ymd}T12:00:00Z`));

function linhaDeHora(startIso: string | null, endIso: string | null): string | null {
  if (!startIso) return null;
  const h = (iso: string) =>
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "numeric", minute: "2-digit", hour12: true })
      .format(new Date(iso))
      .toUpperCase()
      .replace(":00", "");
  return endIso ? `${h(startIso)} – ${h(endIso)}` : h(startIso);
}

/**
 * A visita já aconteceu? A data pedida é do passado?
 *
 * Fica separado e puro porque é a trava que impede o pior resultado desta
 * rotina: mexer num job já executado e mandar "sua visita mudou" ao parceiro e
 * à conta semanas depois de ele ter ido lá.
 *
 * A janela "vivo" do matcher não serve aqui. Ela foi escrita para cancelamento
 * e só tira cancelado, concluído e apagado. O JOB-9444 estava em
 * `awaiting_payment` — visita feita, cobrança aberta — e casou com um e-mail de
 * remarcação de 14/08/2026.
 */
const VISITA_JA_ACONTECEU = new Set([
  "in_progress",
  "final_check",
  "awaiting_payment",
  "completed",
  "on_hold",
]);

export type Veredito = { pode: true } | { pode: false; motivo: "ja_aconteceu" | "data_no_passado" };

export function podeRemarcar(status: string, dataNova: string, hoje: string): Veredito {
  if (VISITA_JA_ACONTECEU.has(status)) return { pode: false, motivo: "ja_aconteceu" };
  if (dataNova < hoje) return { pode: false, motivo: "data_no_passado" };
  return { pode: true };
}

/** Hoje no fuso de Londres, em YYYY-MM-DD. O job é lá, não onde o servidor roda. */
export function hojeEmLondres(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(agora);
}

/**
 * `simular` faz o caminho INTEIRO — modelo, matcher, comparação, texto do
 * "de → para" — e para na porta do banco. É o único ensaio que vale: o que só
 * testava o matcher deixava a leitura do modelo, que é a parte que erra, fora
 * do alcance do teste.
 */
export async function tratarRemarcacao(
  ticket: { id: number; subject: string; texto: string; html: string },
  apiKey: string,
  client?: SupabaseClient,
  opcoes?: { simular?: boolean },
): Promise<ResultadoRemarcacao> {
  const supabase = client ?? createServiceClient();
  const r = await lerRemarcacao(ticket.subject, ticket.texto, apiKey);
  if (!r.isRemarcacao) return { acao: "nada" };

  if (!r.date) {
    return {
      acao: "nota",
      nota:
        "🤖 HARVEY — this reads as a reschedule, but the message does not state a new date. " +
        "Nothing changed on the job. Reply asking for the new date, or move it by hand.",
    };
  }

  const { job, como, ambiguos } = await acharJobDoTicket(
    {
      texto: `${ticket.subject}\n${ticket.texto}`,
      html: ticket.html,
      postcode: r.postcode,
      clientName: r.clientName,
    },
    "vivo",
  );

  if (!job) {
    const lista = (ambiguos ?? []).map((j) => `- ${j.reference} · ${j.property_address} · ${j.scheduled_date}`).join("\n");
    return {
      acao: "nota",
      nota: [
        "🤖 HARVEY — a reschedule arrived, but I could not tell which job it is.",
        "",
        `New schedule in the email: ${r.date}${r.startTime ? ` ${r.startTime}${r.endTime ? `–${r.endTime}` : ""}` : ""}`,
        `Why: ${como}`,
        ...(lista ? ["", "Closest candidates:", lista] : []),
        "",
        "Move the right job by hand. Nothing was changed.",
      ].join("\n"),
    };
  }

  const j = job as Job;

  /**
   * Trabalho que já aconteceu não se remarca.
   *
   * A janela "vivo" do matcher só tira cancelado, concluído e apagado — ela foi
   * escrita para cancelamento. Para remarcação isso é largo demais: o
   * JOB-9444 estava em `awaiting_payment` (visita feita, cobrança aberta) e
   * casou com um e-mail de remarcação de 14/08. Aplicar teria mudado a data de
   * um job executado e mandado "sua visita mudou" ao parceiro e à Housekeep
   * três semanas depois de ele ter ido lá.
   *
   * Vale para reenvio de e-mail antigo e para thread velha que alguém reabre.
   */
  const hoje = hojeEmLondres();
  const veredito = podeRemarcar(String(j.status), r.date, hoje);
  if (!veredito.pode) {
    const quando = `${r.date}${r.startTime ? ` ${r.startTime}${r.endTime ? `–${r.endTime}` : ""}` : ""}`;
    return {
      acao: "nota",
      nota:
        veredito.motivo === "ja_aconteceu"
          ? `🤖 HARVEY — this reschedule points at ${j.reference}, which is already \`${j.status}\`. ` +
            `The visit has happened, so I did not move it and told nobody. New schedule in the email: ${quando}.`
          : `🤖 HARVEY — this reschedule asks for ${r.date}, which is in the past (today is ${hoje}). ` +
            `Reads like an old email coming back. ${j.reference} was left alone.`,
    };
  }

  const startIso = r.startTime ? ukWallClockToUtcIso(r.date, r.startTime) : null;
  const endIso = r.endTime ? ukWallClockToUtcIso(r.date, r.endTime) : null;

  /**
   * Compara INSTANTE, não texto.
   *
   * O banco devolve `2026-09-09T08:00:00+00:00` e o `ukWallClockToUtcIso`
   * produz `2026-09-09T08:00:00.000Z`. É o mesmo momento e são strings
   * diferentes, então `===` dizia "mudou" para uma remarcação que não mudava
   * nada — e o Harvey escrevia uma nota anunciando um movimento inexistente.
   */
  const instante = (iso: string | null | undefined) => (iso ? new Date(iso).getTime() : null);
  const mesmaData = j.scheduled_date === r.date;
  const mesmaHora = !startIso || instante(j.scheduled_start_at) === instante(startIso);
  if (mesmaData && mesmaHora) {
    return {
      acao: "ja_estava",
      reference: j.reference,
      nota: `🤖 HARVEY — ${j.reference} is already on ${r.date}${r.startTime ? ` at ${r.startTime}` : ""} (matched via ${como}). Nothing to change, nobody was told again.`,
    };
  }

  const deData = linhaDeData(String(j.scheduled_date ?? r.date));
  const deHora = linhaDeHora(j.scheduled_start_at ?? null, j.scheduled_end_at ?? null);
  const paraData = linhaDeData(r.date);
  const paraHora = linhaDeHora(startIso, endIso);

  const patch: Record<string, unknown> = { scheduled_date: r.date, updated_at: new Date().toISOString() };
  if (startIso) patch.scheduled_start_at = startIso;
  if (endIso) patch.scheduled_end_at = endIso;
  /**
   * O lembrete de véspera e o carimbo de aviso ao cliente voltam à estaca zero.
   *
   * Sem isto o job remarcado nunca receberia lembrete da data NOVA: a varredura
   * pula quem já tem `client_reminder_sent_at` preenchido.
   */
  patch.client_reminder_sent_at = null;

  if (opcoes?.simular) {
    return {
      acao: "ensaio",
      reference: j.reference,
      de: `${deData} · ${deHora}`,
      para: `${paraData} · ${paraHora}`,
      como,
      nota: `ENSAIO — ${j.reference} iria de ${deData} · ${deHora} para ${paraData} · ${paraHora} (${como}). Nada gravado, ninguém avisado.`,
    };
  }

  const { error } = await supabase.from("jobs").update(patch).eq("id", j.id);
  if (error) {
    return { acao: "nota", nota: `🤖 HARVEY — matched ${j.reference} via ${como}, but I could not move it: ${error.message}` };
  }

  // ── Os dois lados, do servidor, sem depender de tela ────────────────────
  const avisos: string[] = [];
  if (j.partner_id) {
    /**
     * `notifyPartnerJobZendesk` devolve `{ status, body }` — nunca um `ok`.
     * Ler `.ok` aqui dava `undefined` e a nota anunciava "partner: FAILED" em
     * cima de um aviso que tinha saído. O sucesso é o status HTTP, e o `body`
     * ainda diz `skipped` quando o parceiro existe mas não havia canal.
     */
    const p = await notifyPartnerJobZendesk(supabase, j.id, {
      kind: "rescheduled",
      oldDateLine: deData,
      oldTimeLine: deHora,
      newDateLine: paraData,
      newTimeLine: paraHora,
    }).catch((e) => ({ status: 500, body: { error: String(e) } as Record<string, unknown> }));
    const corpo = (p.body ?? {}) as Record<string, unknown>;
    const pulou = typeof corpo.skipped === "string" ? corpo.skipped : null;
    avisos.push(
      `partner: ${p.status < 300 ? (pulou ? `skipped — ${pulou}` : "told") : `FAILED — ${corpo.error ?? p.status}`}`,
    );
  } else {
    avisos.push("partner: none assigned yet");
  }

  const c = await avisarClienteDaRemarcacao(
    j.id,
    { oldDateLine: deData, oldTimeLine: deHora, newDateLine: paraData, newTimeLine: paraHora, reason: r.reason },
    supabase,
  ).catch((e) => ({ ok: false, error: String(e) }) as never);
  avisos.push(
    `customer: ${c.ok ? `told (${c.layout})` : "skipped" in c ? `skipped — ${c.skipped}` : `FAILED — ${c.error}`}`,
  );

  return {
    acao: "aplicada",
    reference: j.reference,
    de: `${deData}${deHora ? ` ${deHora}` : ""}`,
    para: `${paraData}${paraHora ? ` ${paraHora}` : ""}`,
    como,
    nota: [
      `🤖 HARVEY — ${j.reference} moved (matched via ${como}).`,
      "",
      `From: ${deData}${deHora ? ` · ${deHora}` : ""}`,
      `To:   ${paraData}${paraHora ? ` · ${paraHora}` : ""}`,
      ...(r.reason ? [`Reason given: ${r.reason}`] : []),
      "",
      avisos.map((a) => `- ${a}`).join("\n"),
    ].join("\n"),
  };
}

/**
 * Só a MENSAGEM MAIS NOVA do ticket, sem o histórico citado.
 *
 * Não dá para usar a thread inteira: o histórico colado embaixo traz o
 * agendamento ORIGINAL, e o modelo devolve a hora velha achando que é a nova.
 * Foi exatamente isso no ticket 50154 — o e-mail pedia 15:00–18:00 e o modelo
 * leu 09:00–12:00, que era a hora que o job já tinha.
 *
 * E não dá para usar o `soOqueENovo` tampouco: ele corta no marcador
 * "##- Please type your reply above this line -##", e a notificação da
 * Housekeep põe esse marcador na PRIMEIRA linha, com o conteúdo de verdade
 * embaixo. O resultado é uma thread nova vazia.
 *
 * O comentário mais recente é a unidade certa aqui: aviso de remarcação é uma
 * mensagem só, e o que ela diz é o que vale.
 *
 * Um comentário ainda pode trazer mais de uma remarcação: a Housekeep manda
 * um resumo do próprio helpdesk dela, com as atualizações empilhadas, a mais
 * nova em cima. O 50154 tinha duas para o mesmo job no mesmo dia (15:00-18:00
 * às 11:06, depois 09:00-12:00 às 13:22). Por isso o prompt manda ficar com o
 * bloco de cima: dentro de uma mensagem, o topo é o que vale.
 */
export async function mensagemMaisNova(ticketId: number): Promise<string> {
  const base = `https://${process.env.ZENDESK_SUBDOMAIN}.zendesk.com/api/v2`;
  const auth = `Basic ${Buffer.from(`${process.env.ZENDESK_EMAIL}/token:${process.env.ZENDESK_API_TOKEN}`).toString("base64")}`;
  const res = await fetch(`${base}/tickets/${ticketId}/comments.json`, { headers: { Authorization: auth } });
  if (!res.ok) return "";
  const j = (await res.json()) as { comments?: Array<{ body?: string; plain_body?: string; public?: boolean }> };
  const publicos = (j.comments ?? []).filter((c) => c.public !== false);
  const ultimo = publicos[publicos.length - 1] ?? (j.comments ?? [])[(j.comments ?? []).length - 1];
  const corpo = String(ultimo?.plain_body ?? ultimo?.body ?? "");
  return corpo
    .split("\n")
    .filter((l) => !/^\s*>+/.test(l))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 4000);
}
