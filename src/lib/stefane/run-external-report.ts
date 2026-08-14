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
import { photoSlotsForTemplate, type ReportTemplate } from "@/lib/public-report-templates";
import { isReportTemplate } from "@/lib/report-submission";

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

/**
 * Achata as fotos de um report para uma lista de URLs.
 *
 * O envelope guarda duas formas: array plano (general, gardener) e mapa por
 * cômodo (cleaner, certificate). Aqui os dois viram lista, na ordem em que
 * foram gravados.
 */
export function urlsDeFoto(report: unknown): string[] {
  const p = (report as { photos?: unknown } | null)?.photos;
  const limpa = (v: unknown): string[] =>
    Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];
  if (Array.isArray(p)) return limpa(p);
  if (p && typeof p === "object") return Object.values(p as Record<string, unknown>).flatMap(limpa);
  return [];
}

const BUCKET_FOTOS = "job-reports";

/**
 * Troca as URLs guardadas no report por URLs assinadas, que abrem de fato.
 *
 * O bucket `job-reports` é privado, mas o que fica gravado no envelope é o
 * `getPublicUrl` — um endereço que responde 400 para quem não é o service role.
 * Sem assinar, o Playwright baixava zero foto e o relatório subia vazio.
 *
 * Dez minutos bastam: o envio inteiro leva de 25 a 35 segundos.
 */
async function assinarFotos(supabase: SupabaseClient, urls: string[]): Promise<string[]> {
  if (urls.length === 0) return [];
  const marcador = `/${BUCKET_FOTOS}/`;
  const caminhos = urls
    .map((u) => {
      const i = u.indexOf(marcador);
      return i === -1 ? null : decodeURIComponent(u.slice(i + marcador.length).split("?")[0]);
    })
    .filter((p): p is string => !!p);
  if (caminhos.length === 0) return urls;

  const { data, error } = await supabase.storage.from(BUCKET_FOTOS).createSignedUrls(caminhos, 600);
  if (error) {
    console.error("[stefane] não consegui assinar as fotos:", error.message);
    return [];
  }
  return (data ?? [])
    .map((d) => d.signedUrl)
    .filter((u): u is string => typeof u === "string" && u.length > 0);
}

/**
 * Template gravado no envelope do relatório, com `general` como padrão.
 *
 * Serve só para saber se aquele template tem seção de chegada, ou seja, se faz
 * sentido exigir foto de "antes".
 */
function templateDoReport(job: { final_report?: unknown; start_report?: unknown }): ReportTemplate {
  for (const r of [job.final_report, job.start_report]) {
    const t = (r as { template?: unknown } | null)?.template;
    if (typeof t === "string" && isReportTemplate(t)) return t;
  }
  return "general";
}

/** Motivo pelo qual o job não pode ser enviado agora, ou null se pode. */
export function motivoNaoElegivel(job: {
  status?: string | null;
  report_link?: string | null;
  final_report_submitted?: boolean | null;
  external_report_submitted_at?: string | null;
  external_report_attempts?: number | null;
  start_report?: unknown;
  final_report?: unknown;
}): string | null {
  if (job.external_report_submitted_at) return "the report has already been sent";
  if (!job.final_report_submitted) return "the partner has not sent the final report yet";
  if (!job.report_link) return "this job has no platform link: nowhere to upload";
  if (!ehHousekeep(job.report_link)) return "platform not automated yet (Housekeep only for now)";
  // A Housekeep pede foto de antes E de depois em todo relatório, e mandar sem
  // uma das metades é como o relatório volta recusado. O guarda antigo somava as
  // duas e só exigia que o total passasse de zero, então três fotos do antes e
  // nenhuma do depois passava direto: bloqueava o caso vazio e deixava passar
  // justamente o caso pela metade.
  //
  // A exigência do "antes" só vale para template que TEM seção de chegada. O de
  // certificado não tem: o anexo dele mora na conclusão, e exigir antes ali
  // recusaria todo certificado por um motivo que não existe.
  const antes = urlsDeFoto(job.start_report).length;
  const depois = urlsDeFoto(job.final_report).length;
  const temSecaoDeChegada = photoSlotsForTemplate(templateDoReport(job)).start.length > 0;
  if (antes === 0 && depois === 0) {
    return "no photos on the report: Housekeep requires before and after";
  }
  if (temSecaoDeChegada && antes === 0) return "no before photos: Housekeep requires both";
  if (depois === 0) return "no after photos: Housekeep requires both";
  if ((job.external_report_attempts ?? 0) >= MAX_TENTATIVAS) return "out of attempts: needs a person";
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
  if (!job) return { estado: "nao_elegivel", motivo: "job not found" };

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
  if (!travado) return { estado: "enviando", motivo: "a submission is already running" };

  // O bloco "before" da Housekeep é o report de chegada; o "after", o final.
  const [fotosAntes, fotosDepois] = await Promise.all([
    assinarFotos(supabase, urlsDeFoto(j.start_report)),
    assinarFotos(supabase, urlsDeFoto(j.final_report)),
  ]);

  const res = await submeterRelatorioHousekeep({
    url: String(j.report_link).split("?")[0],
    payload: montado.payload,
    fotos: { antes: fotosAntes, depois: fotosDepois },
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
  if (!job) return { ok: false, motivo: "job not found" };

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
    { rotulo: "Start time", valor: String(p.inicio ?? "(blank)") },
    { rotulo: "Finish time", valor: String(p.fim ?? "(blank)") },
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
      { rotulo: "What still needs completing?", valor: String(p.faltaFazer ?? "(blank)") },
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
    avisos.push(`the work description is only ${desc.trim().length} characters: "${desc.trim()}"`);
  }
  if (p.inicio && p.fim && String(p.fim) < String(p.inicio)) {
    avisos.push(`the finish time is before the start (${p.inicio} → ${p.fim}): the partner timer was left running`);
  }
  if (!p.inicio || !p.fim) {
    avisos.push("no start or finish time: the client platform will get the field blank");
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
