/**
 * STEFANE — orquestra um envio: monta o payload, submete, grava e avisa.
 *
 * Só entra job em `final_check` cujo relatório final chegou hoje. As duas
 * condições existem pelo mesmo motivo: em 2026-08-13 a fila crua tinha dez jobs
 * `completed` de semanas atrás, e submeter relatório retroativo por cima de um
 * que já foi entregue à mão cria confusão do lado deles. A Housekeep pede o
 * relatório no mesmo dia da visita, então "hoje" também é a regra deles.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { Resend } from "resend";
import { payloadDoReport, payloadLimpeza } from "./housekeep-report-form";
import { submeterRelatorioHousekeep } from "./submit-housekeep-report";

const AVISAR = "victor@getfixfy.com";
const MAX_TENTATIVAS = 3;

export type EstadoEnvio = "enviando" | "enviado" | "falhou" | "nao_elegivel";

const JOB_SELECT =
  "id, reference, title, status, report_link, start_report, final_report, final_report_submitted, " +
  "partner_timer_started_at, partner_timer_ended_at, partner_name, client_name, property_address, " +
  "external_report_started_at, external_report_submitted_at, external_report_attempts";

/** É trabalho de limpeza? Decide qual dos dois formulários da Housekeep usar. */
function ehLimpeza(titulo: string | null): boolean {
  return /clean|tenancy|domestic|housekeep/i.test(String(titulo ?? ""));
}

function ehHousekeep(link: string | null): boolean {
  return /housekeep\.com\/job-reports/i.test(String(link ?? ""));
}

/** Motivo pelo qual o job não pode ser enviado agora, ou null se pode. */
export function motivoNaoElegivel(job: {
  status?: string | null;
  report_link?: string | null;
  final_report_submitted?: boolean | null;
  external_report_submitted_at?: string | null;
  external_report_attempts?: number | null;
}): string | null {
  if (job.external_report_submitted_at) return "relatório já foi enviado";
  if (!job.final_report_submitted) return "o parceiro ainda não enviou o relatório final";
  if (!job.report_link) return "job sem link de plataforma: não há onde subir";
  if (!ehHousekeep(job.report_link)) return "plataforma ainda não automatizada (só Housekeep por enquanto)";
  if ((job.external_report_attempts ?? 0) >= MAX_TENTATIVAS) return "tentativas esgotadas: precisa de uma pessoa";
  return null;
}

async function avisar(assunto: string, html: string): Promise<void> {
  const key = process.env.RESEND_API_KEY?.trim();
  if (!key) return;
  try {
    await new Resend(key).emails.send({
      from: process.env.RESEND_FROM_EMAIL?.trim() || "Fixfy <ops@getfixfy.com>",
      to: [AVISAR],
      subject: assunto,
      html,
    });
  } catch (err) {
    console.error("[stefane] email falhou:", err);
  }
}

/**
 * Roda o envio de um job. Retorna quando termina, e quem chama decide se
 * espera: a rota HTTP dispara sem aguardar para não segurar o clique por meio
 * minuto, e o card acompanha pelas colunas.
 */
export async function enviarRelatorioExterno(
  supabase: SupabaseClient,
  jobId: string,
  opcoes?: { simular?: boolean },
): Promise<{ estado: EstadoEnvio; motivo?: string; segundos?: number }> {
  const { data: job } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return { estado: "nao_elegivel", motivo: "job não encontrado" };

  const bloqueio = motivoNaoElegivel(job as never);
  if (bloqueio) return { estado: "nao_elegivel", motivo: bloqueio };

  const j = job as unknown as Record<string, unknown>;
  const limpeza = ehLimpeza(j.title as string | null);
  const base = {
    inicio: (j.partner_timer_started_at as string | null) ?? null,
    fim: (j.partner_timer_ended_at as string | null) ?? null,
  };
  const montado = limpeza
    ? payloadLimpeza({ start: j.start_report as never, final: j.final_report as never, ...base })
    : payloadDoReport({ final: j.final_report as never, ...base });

  if (!montado.ok) return { estado: "nao_elegivel", motivo: montado.motivo };

  // Trava de concorrência: só um envio por job por vez. `started_at` nulo é a
  // condição, então dois cliques seguidos não viram dois preenchimentos.
  const { data: travado } = await supabase
    .from("jobs")
    .update({ external_report_started_at: new Date().toISOString(), external_report_error: null })
    .eq("id", jobId)
    .is("external_report_started_at", null)
    .select("id")
    .maybeSingle();
  if (!travado) return { estado: "enviando", motivo: "envio já em andamento" };

  const res = await submeterRelatorioHousekeep({
    url: String(j.report_link).split("?")[0],
    payload: montado.payload,
    simular: opcoes?.simular,
  });

  const ref = String(j.reference);
  const link = String(j.report_link).split("?")[0];

  if (res.ok) {
    await supabase
      .from("jobs")
      .update({
        external_report_submitted_at: new Date().toISOString(),
        external_report_started_at: null,
        external_report_error: null,
      })
      .eq("id", jobId);

    const jaEstava = "jaEstava" in res && res.jaEstava;
    await avisar(
      `${ref} · relatório ${jaEstava ? "já estava" : "enviado"} na Housekeep`,
      `<p><strong>${ref}</strong> · ${j.title ?? ""} · ${j.client_name ?? ""}</p>
       <p>${jaEstava ? "A Housekeep já tinha este relatório. Nada foi reenviado." : `Enviado em ${res.segundos}s.`}</p>
       <p><a href="${link}">Abrir o relatório na Housekeep</a></p>`,
    );
    return { estado: "enviado", segundos: res.segundos };
  }

  const tentativas = Number(j.external_report_attempts ?? 0) + 1;
  await supabase
    .from("jobs")
    .update({
      external_report_started_at: null,
      external_report_error: res.motivo,
      external_report_attempts: tentativas,
    })
    .eq("id", jobId);

  await avisar(
    `${ref} · relatório NÃO subiu na Housekeep`,
    `<p><strong>${ref}</strong> · ${j.title ?? ""} · ${j.client_name ?? ""}</p>
     <p><strong>Motivo:</strong> ${res.motivo}</p>
     <p>Tentativa ${tentativas} de ${MAX_TENTATIVAS}.</p>
     <p><a href="${link}">Abrir o formulário e enviar à mão</a></p>`,
  );
  return { estado: "falhou", motivo: res.motivo, segundos: res.segundos };
}

/**
 * O que a Stefane vai preencher, sem abrir browser e sem tocar na Housekeep.
 *
 * Existe para os primeiros jobs, em que ver antes vale mais que velocidade: o
 * dono confere campo a campo na tela do OS e só então manda enviar. Depois de
 * confiar, o mesmo botão pode ir direto.
 */
export async function previewEnvio(
  supabase: SupabaseClient,
  jobId: string,
): Promise<
  | { ok: true; forma: "trade" | "limpeza"; campos: Array<{ rotulo: string; valor: string }>; avisos: string[] }
  | { ok: false; motivo: string }
> {
  const { data: job } = await supabase.from("jobs").select(JOB_SELECT).eq("id", jobId).maybeSingle();
  if (!job) return { ok: false, motivo: "job não encontrado" };

  const bloqueio = motivoNaoElegivel(job as never);
  if (bloqueio) return { ok: false, motivo: bloqueio };

  const j = job as unknown as Record<string, unknown>;
  const limpeza = ehLimpeza(j.title as string | null);
  const base = {
    inicio: (j.partner_timer_started_at as string | null) ?? null,
    fim: (j.partner_timer_ended_at as string | null) ?? null,
  };
  const montado = limpeza
    ? payloadLimpeza({ start: j.start_report as never, final: j.final_report as never, ...base })
    : payloadDoReport({ final: j.final_report as never, ...base });
  if (!montado.ok) return { ok: false, motivo: montado.motivo };

  const p = montado.payload as Record<string, unknown>;
  const simNao = (v: unknown) => (v ? "Yes" : "No");
  const CONCLUSOES = [
    "Yes, no further work required",
    "No, more time is needed",
    "No, specialist materials needed",
    "No, job scope different to booked work",
  ];
  const FEEDBACKS = ["Bad", "Okay", "Good"];

  const campos: Array<{ rotulo: string; valor: string }> = [
    { rotulo: "Start time", valor: String(p.inicio ?? "(em branco)") },
    { rotulo: "Finish time", valor: String(p.fim ?? "(em branco)") },
  ];

  if (limpeza) {
    campos.push(
      { rotulo: "Changes to original job scope?", valor: simNao(p.escopoMudou) },
      { rotulo: "Any pre-existing damage?", valor: simNao(p.danoPrevio) },
      { rotulo: "Customer refused photos?", valor: simNao(p.recusouFotos) },
      { rotulo: "Is the job complete?", valor: simNao(p.jobCompleto) },
      { rotulo: "Customer/landlord inspected?", valor: simNao(p.clienteInspecionou) },
    );
  } else {
    campos.push(
      { rotulo: "Description of work done", valor: String(p.descricao ?? "") },
      { rotulo: "Any additional charges?", valor: simNao(p.cobrancaExtra) },
      { rotulo: "Job complete?", valor: CONCLUSOES[Number(p.conclusao) || 0] },
      { rotulo: "What still needs completing?", valor: String(p.faltaFazer ?? "(em branco)") },
      { rotulo: "Follow up required?", valor: simNao(p.precisaRetorno) },
    );
  }

  campos.push(
    { rotulo: "Recommend additional services?", valor: simNao(p.recomendaServicos) },
    { rotulo: "Feedback for Housekeep", valor: FEEDBACKS[Number(p.feedback) ?? 2] },
  );

  // Dado que passa na validação mas embaraça na frente do cliente. Não bloqueia
  // o envio, porque a decisão é do dono: o JOB-9123 tinha "K" como descrição do
  // trabalho e o timer terminando antes de começar, e nenhum dos dois é
  // impedimento técnico, só coisa que ninguém quer mandar para a Housekeep.
  const avisos: string[] = [];
  const desc = String(p.descricao ?? "");
  if (!limpeza && desc.length > 0 && desc.trim().length < 15) {
    avisos.push(`a descrição do trabalho tem ${desc.trim().length} caracteres: "${desc.trim()}"`);
  }
  if (p.inicio && p.fim && String(p.fim) < String(p.inicio)) {
    avisos.push(`o horário termina antes de começar (${p.inicio} → ${p.fim}): o timer do parceiro ficou aberto`);
  }
  if (!p.inicio || !p.fim) {
    avisos.push("sem horário de início ou fim: a Housekeep vai receber o campo em branco");
  }

  return { ok: true, forma: limpeza ? "limpeza" : "trade", campos, avisos };
}

/**
 * A fila do dia: job em `final_check` cujo relatório final chegou hoje e que
 * ainda não subiu. É o que o botão do card oferece e o que uma varredura futura
 * poderia percorrer sem tocar em histórico antigo.
 */
export async function filaDeHoje(supabase: SupabaseClient): Promise<Array<{ id: string; reference: string }>> {
  const hoje = new Date();
  const inicioDoDia = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate()).toISOString();
  const { data } = await supabase
    .from("jobs")
    .select("id, reference, final_report_submitted, report_link, external_report_submitted_at, updated_at")
    .eq("status", "final_check")
    .eq("final_report_submitted", true)
    .is("external_report_submitted_at", null)
    .not("report_link", "is", null)
    .gte("updated_at", inicioDoDia);
  return (data ?? []).map((j) => ({ id: String(j.id), reference: String(j.reference) }));
}
