"use client";

import { PriceBreakdown } from "./components/PriceBreakdown";
import { parseMaterialExtra, recibosDoMaterial } from "@/lib/report-material-extra";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinanceCards } from "./components/FinanceCards";
import { MarginHero } from "./components/MarginHero";
import { ModalFooter } from "./components/ModalFooter";
import { ModalHeader } from "./components/ModalHeader";
import { AddExtraModal } from "./components/AddExtraModal";
import { ResponsibilityCheck } from "./components/ResponsibilityCheck";
import { PaymentScheduleSection } from "./components/PaymentScheduleSection";
import { StepsTimeline } from "./components/StepsTimeline";
import type { EstadoEnvioExterno } from "./components/ExternalReportStep";
import type { FinalReviewModalProps } from "./types";
import { JobReportV2Card } from "@/components/jobs/job-report-v2-card";
import { confirmAndRemoveJobVisit } from "@/services/job-visits-api";
import { toast } from "sonner";

type EnvioExterno = EstadoEnvioExterno;

/**
 * Estado do envio do relatório para a plataforma de origem.
 *
 * Pergunta de 3 em 3 segundos enquanto o modal está aberto, e só para quando o
 * envio TERMINOU. A versão anterior só perguntava depois de ver "enviando" uma
 * vez — mas o POST dispara e devolve na hora, e o `started_at` cai no banco um
 * instante DEPOIS da primeira releitura: o passo 3 congelava no chip neutro
 * com o envio acontecendo por baixo (visto em 26/08, JOB-9475). Um GET local a
 * cada 3s por modal aberto é barato; um passo que mente é caro.
 */
function useEnvioExterno(
  jobUuid: string | null | undefined,
  aberto: boolean,
): { envio: EnvioExterno | undefined; recarregar: () => void } {
  const [envio, setEnvio] = useState<EnvioExterno | undefined>(undefined);
  // Ref e não dep do efeito: com `envio?.estado` na lista, cada resposta
  // remontava o intervalo, e o polling dependia de o estado ter mudado.
  const estadoRef = useRef<EnvioExterno["estado"] | undefined>(undefined);
  const buscarRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!aberto || !jobUuid) return;
    let vivo = true;

    const buscar = async () => {
      try {
        const r = await fetch(`/api/jobs/${jobUuid}/submit-external-report`);
        if (!vivo) return;
        // Rota fora do ar não pode virar passo em branco: o estado indisponível
        // é um estado, e a faixa diz isso em vez de sumir.
        if (!r.ok) {
          setEnvio({ estado: "nao_enviado", indisponivel: true });
          return;
        }
        const d = (await r.json()) as {
          estado: EnvioExterno["estado"];
          report_link?: string | null;
          error?: string | null;
          bloqueio?: string | null;
          attempts?: number;
          submitted_at?: string | null;
        };
        if (!vivo) return;
        estadoRef.current = d.estado;
        setEnvio({
          estado: d.estado,
          link: d.report_link ?? null,
          erro: d.error ?? null,
          bloqueio: d.bloqueio ?? null,
          attempts: d.attempts ?? 0,
          submittedAt: d.submitted_at ?? null,
          manualAt: (d as { manual_at?: string | null }).manual_at ?? null,
        });
      } catch {
        // Falha de rede também é estado. O modal segue utilizável; o que muda é
        // que o passo 3 para de fingir que não havia nada a mostrar ali.
        if (vivo) setEnvio({ estado: "nao_enviado", indisponivel: true });
      }
    };
    buscarRef.current = () => void buscar();

    void buscar();
    const t = setInterval(() => {
      if (estadoRef.current !== "enviado") void buscar();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [jobUuid, aberto]);

  return { envio, recarregar: () => buscarRef.current() };
}

export function FinalReviewModal(props: FinalReviewModalProps) {
  const {
    isOpen,
    onClose,
    reviewSummary,
    jobId,
    jobUuid,
    jobTitle,
    clientName,
    partnerName,
    currentUserName,
    jobValue,
    partnerPayout,
    margin,
    marginPct,
    received,
    paidOut,
    clientOutstanding,
    partnerOutstanding,
    invoiceStatus,
    selfBillStatus,
    invoiceReference,
    selfBillReference,
    reports,
    confirmed,
    onConfirmedChange,
    onApprove,
    onVisitRemoved,
    breakdown,
    submitting,
    hourlySlot,
    cardCharge,
    paymentSchedule,
    rawFinalReport,
    rawStartReport,
    timerStartedAt,
    timerEndedAt,
    onEditReport,
    extra,
  } = props;
  const [addExtraOpen, setAddExtraOpen] = useState(false);

  /**
   * Duas etapas, nesta ordem: o relatório e depois o dinheiro.
   *
   * Aprovar sem ter visto o relatório era o buraco: o botão dizia "Review &
   * approve" e abria direto no financeiro, então "review" queria dizer conferir
   * margem e datas, nunca o que o parceiro escreveu. Agora a primeira tela é o
   * relatório inteiro, com as fotos, e dela se sai por "Edit" ou seguindo.
   *
   * Só aparece quando há relatório. Job sem relatório abre direto no
   * financeiro, como antes: não há o que conferir e uma tela vazia no caminho
   * seria só um clique a mais.
   */
  const temRelatorio = !!rawFinalReport && Object.keys(rawFinalReport as object).length > 0;
  const [etapa, setEtapa] = useState<"relatorio" | "financeiro">(
    temRelatorio ? "relatorio" : "financeiro",
  );
  // O componente continua montado com o modal fechado, então a etapa volta ao
  // começo no fechamento e não na abertura: é handler, roda uma vez, e não
  // precisa de efeito nem de ref no render, que este repo proíbe.
  const fechar = () => {
    setEtapa(temRelatorio ? "relatorio" : "financeiro");
    // Forçar é decisão para um job, não um modo. Sem isto, quem liberou uma vez
    // sairia com o bloqueio desligado no próximo job sem ter escolhido isso.
    setForcarSemEnvio(false);
    setRelatorioAprovado(false);
    onClose();
  };

  const { envio: envioExterno, recarregar } = useEnvioExterno(jobUuid, isOpen);
  /** Relatórios das visitas extras (19/10/2026): aparecem no passo 3, junto do da V1. */
  const [relatoriosDasVisitas, setRelatoriosDasVisitas] = useState<
    {
      id: string;
      index: number;
      partner: string;
      enviado: boolean;
      aprovado: boolean;
      final: Record<string, unknown> | null;
      partnerCost: number;
      clientPrice: number;
    }[]
  >([]);
  /** Recarrega a lista de visitas depois de uma remoção. */
  const [visitasNonce, setVisitasNonce] = useState(0);
  const [removendoVisita, setRemovendoVisita] = useState<string | null>(null);
  useEffect(() => {
    if (!isOpen || !jobUuid) return;
    let vivo = true;
    void fetch(`/api/jobs/${jobUuid}/visits`)
      .then((r) => r.json())
      .then((d: { visits?: Array<Record<string, unknown>> }) => {
        if (!vivo) return;
        setRelatoriosDasVisitas(
          (d.visits ?? [])
            .filter((v) => v.status !== "cancelled")
            .map((v) => ({
              id: String(v.id),
              index: Number(v.visit_index),
              partner: String(v.partner_name ?? ""),
              partnerCost: Number(v.partner_cost ?? 0),
              clientPrice: Number(v.client_price ?? 0),
              enviado: !!v.report_submitted_at,
              aprovado: !!v.report_approved_at,
              final: (v.final_report as Record<string, unknown> | null) ?? null,
            })),
        );
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [isOpen, jobUuid, visitasNonce]);

  /** Remover visita que não aconteceu (22/10/2026): pergunta sempre; self-bill e fatura acertam na hora. */
  const removerVisita = async (v: (typeof relatoriosDasVisitas)[number]) => {
    setRemovendoVisita(v.id);
    try {
      const removida = await confirmAndRemoveJobVisit(jobUuid, {
        id: v.id,
        visit_index: v.index,
        partner_name: v.partner,
        partner_cost: v.partnerCost,
        client_price: v.clientPrice,
      });
      if (!removida) return;
      toast.success(`Visit ${v.index} removed · self-bill and invoice updated`);
      setVisitasNonce((n) => n + 1);
      onVisitRemoved?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not remove the visit");
    } finally {
      setRemovendoVisita(null);
    }
  };
  const faltaRelatorioDeVisita = relatoriosDasVisitas.some((v) => !v.enviado);
  /**
   * Material comprado na casa, de TODAS as visitas (19/10/2026): uma linha por
   * visita e o total que o cliente paga. Pergunta sem resposta ou Yes sem recibo
   * aparece como aviso, para nunca fechar o job esquecendo o material.
   */
  const materialPorVisita = (() => {
    const linha = (index: number, rel: unknown) => {
      if (!rel || typeof rel !== "object") return null;
      const env = rel as Record<string, unknown>;
      const d = ((env.data as Record<string, unknown> | undefined) ?? env) as Record<string, unknown>;
      const pergunta = d.materials_bought ?? d.materials_charges;
      const m = parseMaterialExtra(d);
      const comprou = pergunta === true || m.cost > 0;
      return { index, ...m, comprou, semResposta: pergunta === undefined && m.cost === 0, recibos: recibosDoMaterial(d).length };
    };
    return [linha(1, rawFinalReport), ...relatoriosDasVisitas.map((v) => linha(v.index, v.final))].filter(
      (x): x is NonNullable<typeof x> => !!x,
    );
  })();
  const materialTotal = materialPorVisita.reduce((n, v) => n + v.charge, 0);

  /**
   * Manda o relatório assim que ele é aprovado, não no fim.
   *
   * Aprovar o relatório é o instante em que se disse "está bom": é aí que ele
   * tem que sair. Deixar para o Finalise atrasava o envio até o fim do
   * financeiro sem ganhar nada, e a espera de 8 a 35 segundos caía toda em cima
   * do último clique.
   *
   * Agora ela acontece por baixo, enquanto se confere margem e datas, e quando
   * se chega no Finalise o passo 3 já diz "Submitted · HH:MM" ou "Try again".
   * Ninguém fecha a tela sem saber, que era o problema.
   *
   * O bloqueio é respeitado: sem foto, ou sem relatório, nem tenta. A nota na
   * aba já tinha dito isso antes.
   */
  const dispararEnvio = () => {
    const podeEnviar =
      jobUuid && envioExterno && !envioExterno.bloqueio &&
      envioExterno.estado !== "enviado" && envioExterno.estado !== "enviando";
    if (!podeEnviar) return;
    jaDisparouRef.current = true;
    void fetch(`/api/jobs/${jobUuid}/submit-external-report`, { method: "POST" })
      .then(() => recarregar())
      .catch((err) => console.error("[final-review] envio externo falhou:", err));
  };

  /**
   * A aprovação vale mesmo quando o clique veio ANTES de o estado carregar.
   *
   * O disparo no "Approve report →" checa bloqueio, e para isso precisa do GET
   * já respondido. Quem revisa rápido clicava antes disso: o disparo era
   * engolido em silêncio, nada tentava de novo, e o passo 3 dizia "goes when
   * you approve" com a aprovação já dada (26/08, JOB-9475). O clique agora fica
   * registrado, e o disparo acontece quando o estado chegar — uma vez só.
   */
  const [relatorioAprovado, setRelatorioAprovado] = useState(false);
  const jaDisparouRef = useRef(false);
  useEffect(() => {
    if (!isOpen) {
      jaDisparouRef.current = false;
      return;
    }
    if (!relatorioAprovado || jaDisparouRef.current) return;
    if (!envioExterno || envioExterno.bloqueio || envioExterno.estado !== "nao_enviado") return;
    dispararEnvio();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dispara quando o estado chega após a aprovação
  }, [isOpen, relatorioAprovado, envioExterno]);

  /**
   * UM clique: manda o relatório, espera a plataforma confirmar, e finaliza.
   *
   * Antes eram três movimentos e um beco. O envio saía ao aprovar o relatório,
   * o Finalise ficava DESABILITADO enquanto ele não chegasse, e a tela pedia
   * "Send the report first" com o botão que faria isso apagado. Quem estava
   * fechando o job via um aviso, um botão morto e nenhuma saída óbvia — a
   * reclamação do dono em 20/08 foi exatamente essa.
   *
   * Agora o botão assume o trabalho. Só espera quando há o que esperar: com
   * bloqueio de verdade (foto faltando) nada disso roda, porque aí o caminho é
   * consertar o relatório, e é o passo 3 que diz como.
   */
  const aprovarEEnviar = async () => {
    const precisaEnviar =
      !!jobUuid && !!envioExterno && !envioExterno.bloqueio && envioExterno.estado !== "enviado";

    if (!precisaEnviar) {
      dispararEnvio();
      // Forçado (sem relatório, ou envio bloqueado): o card fecha sem o portão do relatório.
      onApprove({ forced: aprovandoForcado });
      return;
    }

    /**
     * Dispara e SAI — o envio termina em segundo plano (dono, 27/08).
     *
     * A espera de até 6 minutos aqui dentro nunca fez o envio acontecer: a
     * rota devolve 202 na hora e o preenchimento roda no servidor de qualquer
     * jeito. O laço só ficava OLHANDO, e o preço era a tela inteira travada em
     * "Sending report…" com a pessoa parada na frente dela — às vezes minutos,
     * às vezes para sempre quando o processo do envio morria no meio.
     *
     * Quem conta o desfecho é o passo 3, que já se atualiza sozinho enquanto o
     * card está aberto, e o chip vivo do card depois de fechado. Falha grava
     * `external_report_error` e dispara o email de aviso, então nada some em
     * silêncio por ninguém estar olhando.
     */
    if (envioExterno?.estado !== "enviando") {
      void fetch(`/api/jobs/${jobUuid}/submit-external-report`, { method: "POST" })
        .catch(() => {})
        .finally(() => recarregar());
    }
    onApprove({ forced: aprovandoForcado });
  };

  // Docs must exist; report upload/approve is no longer a hard gate —
  // office attests “report submitted to the customer” (partners rarely use the app).
  // Job a £0 (refação, cortesia) não tem o que faturar: a fatura não segura o fechamento (19/10/2026).
  const docsReady = (invoiceStatus === "issued" || jobValue <= 0.02) && selfBillStatus === "issued";
  /**
   * Só resta UMA atestação humana: a de responsabilidade.
   *
   * A outra ("confirmo que o relatório foi submetido ao cliente") pedia à
   * pessoa um fato que a API da Housekeep prova. Ela saiu em 20/08/2026 e o
   * seu lugar é o `envioResolvido` abaixo, que lê `submitted_at` da fonte.
   */
  const attestationsOk = confirmed;

  /**
   * Finalizar com o relatório pendente é o que faz ele sumir.
   *
   * O job fecha, sai da fila de quem olha relatório, e o pendente só volta se
   * alguém for procurar. Foi assim que o JOB-9428 virou awaiting_payment com o
   * relatório nunca enviado, e é o tipo de perda que ninguém percebe no dia.
   *
   * Só trava quando o envio é possível: com bloqueio de verdade (sem foto,
   * plataforma não automatizada, sem link) não há o que esperar, e travar ali
   * congelaria fatura, self-bill e pagamento por causa de coisa que este botão
   * não resolve. A saída explícita existe pelo mesmo motivo, para o dia em que
   * a Housekeep estiver fora do ar ou alguém já tiver mandado à mão.
   */
  const [forcarSemEnvio, setForcarSemEnvio] = useState(false);
  /** Dá para mandar e ainda não foi: é o que o botão faz sozinho. */
  const envioPendente =
    !!envioExterno &&
    !envioExterno.bloqueio &&
    envioExterno.estado !== "enviado";
  /**
   * NÃO dá para mandar, e nenhum clique aqui muda isso: relatório sem foto,
   * sem descrição, horário impossível. É o único caso que ainda trava o
   * Finalise, e o passo 3 mostra o que consertar.
   */
  // Job sem plataforma (cliente direto) não tem para onde mandar: isso não bloqueia (19/10/2026).
  const envioBloqueado =
    !!envioExterno?.bloqueio &&
    !/queued for the Express robot|already been sent|marked as sent manually|no platform link/i.test(
      envioExterno.bloqueio,
    );
  /**
   * Envio PENDENTE não desabilita mais o botão: ele vira o trabalho do botão.
   *
   * O que ainda bloqueia é envio IMPOSSÍVEL — foto faltando, relatório sem
   * descrição —, porque aí nenhum clique resolve e o caminho é o passo 3.
   */
  const canApprove =
    attestationsOk && docsReady && !submitting && (!envioBloqueado || forcarSemEnvio);

  /**
   * O botão diz o que está acontecendo: "Finalise & approve" quando o
   * relatório chegou (ou vai chegar sozinho — fila do Express, marcado como
   * manual), "Force approve" quando se está fechando o job SEM o relatório
   * ter saído — sem report, bloqueado, ou liberado à força. Chamar os dois
   * pelo mesmo nome era como o forçado passava despercebido.
   */
  const envioResolvido =
    envioExterno?.estado === "enviado" ||
    !!envioExterno?.manualAt ||
    /queued for the Express robot|already been sent|marked as sent manually|no platform link/i.test(
      envioExterno?.bloqueio ?? "",
    );
  const aprovandoForcado =
    forcarSemEnvio || !temRelatorio || faltaRelatorioDeVisita || (!!envioExterno?.bloqueio && !envioResolvido);

  return (
    <AnimatePresence>
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto overscroll-contain py-4 sm:items-center sm:py-6 px-3 sm:px-4">
          <motion.div
            variants={overlayTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            onClick={submitting ? undefined : fechar}
            className="final-review-modal-overlay absolute inset-0 bg-black/30 dark:bg-black/65 glass"
          />
          <motion.div
            variants={modalTransition}
            initial="hidden"
            animate="visible"
            exit="exit"
            className="final-review-modal-panel relative w-full h-fit max-h-[min(90dvh,100dvh-2rem)] flex flex-col bg-card border border-fx-line overflow-hidden my-auto rounded-2xl shadow-modal"
            style={{ maxWidth: "620px" }}
          >
            <ModalHeader
              jobId={jobId}
              jobTitle={jobTitle}
              clientName={clientName}
              onClose={fechar}
              reviewSummary={reviewSummary ?? null}
              onAddExtra={extra && etapa !== "relatorio" ? () => setAddExtraOpen(true) : undefined}
            />
            {extra ? (
              <AddExtraModal
                open={addExtraOpen}
                onClose={() => setAddExtraOpen(false)}
                initial={extra.pending}
                defaults={extra.defaults}
                base={extra.base}
                onConfirm={(e) => {
                  extra.onChange(e);
                  setAddExtraOpen(false);
                }}
              />
            ) : null}

            {etapa === "relatorio" ? (
              <>
                <div className="min-h-0 overflow-y-auto overscroll-contain p-4">
                  <p className="mb-2 text-[11px]" style={{ color: "#6B6B70" }}>
                    This is the report as it was filled in. Check it before the money.
                  </p>
                  {/* UM card só, a pedido: a visita é uma e o relatório é um.
                      A chegada entra DENTRO dele — fotos Before/After lado a
                      lado, campos das duas metades juntos. */}
                  <JobReportV2Card
                    jobId={jobUuid}
                    kind="final"
                    rawReport={rawFinalReport}
                    rawStartReport={rawStartReport}
                    approvedAt={null}
                    readOnly
                    timerStartedAt={timerStartedAt}
                    timerEndedAt={timerEndedAt}
                  />
                </div>
                <div
                  className="flex items-center justify-between gap-2 px-4 py-3"
                  style={{ borderTop: "0.5px solid #E4E4E8" }}
                >
                  <button
                    type="button"
                    onClick={onEditReport}
                    disabled={!onEditReport}
                    className="rounded-[6px] px-3 py-[6px] text-[12px] font-medium cursor-pointer disabled:opacity-40"
                    style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                  >
                    Edit report
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setRelatorioAprovado(true);
                      dispararEnvio();
                      setEtapa("financeiro");
                    }}
                    className="rounded-[6px] px-3.5 py-[6px] text-[12px] font-semibold text-white cursor-pointer"
                    style={{ background: "#020040" }}
                  >
                    {/* Aprovar o relatório JÁ dispara o envio: o rótulo diz o
                        que o clique faz, e o resumo seguinte mostra o envio
                        acontecendo. */}
                    Approve report →
                  </button>
                </div>
              </>
            ) : (
            <div className="min-h-0 overflow-y-auto overscroll-contain">
              {/* A faixa do envio saiu daqui (19/08). Ela dizia a mesma frase
                  do passo 3 com botões diferentes, e o passo 3 é onde a
                  pergunta mora: o relatório existe onde precisa existir? */}
              <MarginHero
                margin={margin}
                marginPct={marginPct}
                partnerPayout={partnerPayout}
                jobValue={jobValue}
              />

              {breakdown ? <PriceBreakdown b={breakdown} materialFromReports={materialTotal} /> : null}

              <StepsTimeline
                invoiceStatus={invoiceStatus}
                selfBillStatus={selfBillStatus}
                invoiceReference={invoiceReference}
                selfBillReference={selfBillReference}
                jobValue={jobValue}
                partnerPayout={partnerPayout}
                reports={reports}
                envioExterno={envioExterno}
                jobUuid={jobUuid}
                onEnvioDisparado={recarregar}
                onEditReport={onEditReport}
                relatorioAprovado={relatorioAprovado}
              />

              {materialPorVisita.length ? (
                <div className="rounded-xl px-3 py-2.5 text-[12px]" style={{ background: "#FFF6EC", border: "0.5px solid #F0D6B8", color: "#4A2A00" }}>
                  <p className="m-0 mb-1 flex justify-between text-[11px] font-semibold" style={{ color: "#7A3D00" }}>
                    <span>Materials on site</span>
                    <span className="tabular-nums">Client pays £{materialTotal.toFixed(2)}</span>
                  </p>
                  {materialPorVisita.map((v) => (
                    <p key={v.index} className="m-0 flex justify-between gap-2">
                      <span>Visit {v.index}</span>
                      <span className="tabular-nums" style={{ color: v.semResposta || (v.comprou && !v.recibos) ? "#B42318" : undefined }}>
                        {v.semResposta
                          ? "Report does not say"
                          : v.comprou
                            ? `£${v.cost.toFixed(2)} paid · £${v.charge.toFixed(2)} to client${v.recibos ? "" : " · no receipt"}`
                            : "None"}
                      </span>
                    </p>
                  ))}
                  {materialTotal > 0 ? (
                    <p className="m-0 mt-1 text-[11px]">Already added to the invoice and to each partner&apos;s self-bill.</p>
                  ) : null}
                </div>
              ) : null}

              {relatoriosDasVisitas.length ? (
                <div className="rounded-xl px-3 py-2.5 text-[12px]" style={{ background: "#F7F7FB", border: "0.5px solid #E4E4E7" }}>
                  <p className="m-0 mb-1 text-[11px] font-semibold" style={{ color: "#020040" }}>Visit reports</p>
                  {relatoriosDasVisitas.map((v) => (
                    <p key={v.id} className="m-0 flex items-center justify-between gap-2" style={{ color: "#4A4A55" }}>
                      <span>Visit {v.index}{v.partner ? ` · ${v.partner}` : ""}</span>
                      <span className="flex items-center gap-2">
                        <span style={{ color: v.aprovado ? "#047857" : v.enviado ? "#020040" : "#B45309" }}>
                          {v.aprovado ? "Approved" : v.enviado ? "Sent, not approved" : "Missing"}
                        </span>
                        <button
                          type="button"
                          disabled={removendoVisita === v.id}
                          onClick={() => void removerVisita(v)}
                          className="text-[11px] font-medium underline-offset-2 hover:underline disabled:opacity-50"
                          style={{ color: "#B91C1C" }}
                          title="Remove this visit: it comes off the partner self-bill and the invoice"
                        >
                          {removendoVisita === v.id ? "Removing…" : "Remove"}
                        </button>
                      </span>
                    </p>
                  ))}
                  {faltaRelatorioDeVisita ? (
                    <p className="m-0 mt-1 text-[11px]" style={{ color: "#B45309" }}>
                      A visit has no report. Finalising now is a force approve.
                    </p>
                  ) : null}
                </div>
              ) : null}

              <FinanceCards
                clientName={clientName}
                partnerName={partnerName}
                received={received}
                paidOut={paidOut}
                clientOutstanding={clientOutstanding}
                partnerOutstanding={partnerOutstanding}
              />

              {extra?.pending ? (
                <div className="mx-6 mb-[18px] flex flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-2.5" style={{ background: "#F2F0FA" }}>
                  <p className="m-0 text-[13px]" style={{ color: "#020040" }}>
                    <b>Extra</b>
                    {extra.pending.kind === "hours" && extra.pending.hours ? ` · ${extra.pending.hours}h` : ""}
                    {` · +£${extra.pending.clientAmount.toFixed(2)} client · +£${extra.pending.partnerAmount.toFixed(2)} partner`}
                    <span style={{ color: "#6B6B70" }}> · saved when you finalise</span>
                  </p>
                  <span className="flex gap-2 text-[12px] font-medium">
                    <button type="button" onClick={() => setAddExtraOpen(true)} style={{ color: "#020040" }}>Edit</button>
                    <button type="button" onClick={() => extra.onChange(null)} style={{ color: "#B42318" }}>Remove</button>
                  </span>
                </div>
              ) : null}

              {hourlySlot ? <div className="px-6 pb-[18px]">{hourlySlot}</div> : null}

              {cardCharge && cardCharge.amountGbp > 0.02 ? (
                <div className="mx-6 mb-[18px] rounded-xl border border-border-light bg-surface/60 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
                  <p className="text-[13px] text-text-primary min-w-0">
                    {cardCharge.onHold ? (
                      <>Card charge on hold: approving will <b>not</b> charge the saved card.</>
                    ) : (
                      <>
                        On approve we charge <b>£{cardCharge.amountGbp.toFixed(2)}</b> to the saved card
                        {cardCharge.last4 ? (
                          <> {cardCharge.brand ? `${cardCharge.brand.toUpperCase()} ` : ""}ending <b>{cardCharge.last4}</b></>
                        ) : null}
                        . If it is refused, the job stays in final check.
                      </>
                    )}
                  </p>
                  <label htmlFor="final-review-card-hold" className="flex items-center gap-2 text-[12.5px] text-text-secondary cursor-pointer">
                    <input
                      id="final-review-card-hold"
                      type="checkbox"
                      className="rounded border-border"
                      checked={cardCharge.onHold}
                      onChange={(e) => cardCharge.onHoldChange(e.target.checked)}
                    />
                    Hold the charge
                  </label>
                </div>
              ) : null}

              {paymentSchedule ? (
                <PaymentScheduleSection
                  invoiceDueYmd={paymentSchedule.invoiceDueYmd}
                  onInvoiceDueYmdChange={paymentSchedule.onInvoiceDueYmdChange}
                  invoiceDueSource={paymentSchedule.invoiceDueSource}
                  partnerDueYmd={paymentSchedule.partnerDueYmd}
                  onPartnerDueYmdChange={paymentSchedule.onPartnerDueYmdChange}
                  partnerDueSource={paymentSchedule.partnerDueSource}
                  showPartner={paymentSchedule.showPartner}
                  partnerTermsLabel={paymentSchedule.partnerTermsLabel}
                  orgStandardTerms={paymentSchedule.orgStandardTerms}
                  orgPayoutReferenceYmd={paymentSchedule.orgPayoutReferenceYmd}
                  loading={paymentSchedule.loading}
                />
              ) : null}
            </div>
            )}

            {/* Aceite e aprovação só na etapa do dinheiro: assinar
                responsabilidade enquanto ainda se está lendo o relatório é
                assinar antes de ter conferido. */}
            {etapa === "financeiro" ? (
              <>
                <ResponsibilityCheck
                  confirmed={confirmed}
                  onChange={onConfirmedChange}
                  // Sem plataforma não há o que confirmar "do lado deles": a linha verde não aparece.
                  envioResolvido={envioResolvido && !/no platform link/i.test(envioExterno?.bloqueio ?? "")}
                  envioQuando={envioExterno?.submittedAt ?? envioExterno?.manualAt ?? null}
                  envioNota={
                    envioExterno?.manualAt
                      ? "marked as sent by hand"
                      : /queued for the Express robot/i.test(envioExterno?.bloqueio ?? "")
                        ? "the Express robot completes it on its next pass"
                        : null
                  }
                  currentUserName={currentUserName}
                  bloqueadoPeloEnvio={envioBloqueado && !forcarSemEnvio}
                  onForcar={() => setForcarSemEnvio(true)}
                />
                <ModalFooter
                  canApprove={canApprove}
                  submitting={submitting}
                  onCancel={fechar}
                  onApprove={aprovarEEnviar}
                  forcado={aprovandoForcado}
                  rotulo={
                    aprovandoForcado
                      ? "Force approve"
                      : envioPendente
                        ? "Send report & finalise"
                        : "Finalise & approve"
                  }
                />
              </>
            ) : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
