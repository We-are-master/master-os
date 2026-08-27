"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinanceCards } from "./components/FinanceCards";
import { MarginHero } from "./components/MarginHero";
import { ModalFooter } from "./components/ModalFooter";
import { ModalHeader } from "./components/ModalHeader";
import { ResponsibilityCheck } from "./components/ResponsibilityCheck";
import { PaymentScheduleSection } from "./components/PaymentScheduleSection";
import { StepsTimeline } from "./components/StepsTimeline";
import type { EstadoEnvioExterno } from "./components/ExternalReportStep";
import type { FinalReviewModalProps } from "./types";
import { JobReportV2Card } from "@/components/jobs/job-report-v2-card";

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
    submitting,
    hourlySlot,
    paymentSchedule,
    rawFinalReport,
    rawStartReport,
    timerStartedAt,
    timerEndedAt,
    onEditReport,
  } = props;

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
      onApprove();
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
    onApprove();
  };

  // Docs must exist; report upload/approve is no longer a hard gate —
  // office attests “report submitted to the customer” (partners rarely use the app).
  const docsReady = invoiceStatus === "issued" && selfBillStatus === "issued";
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
  const envioBloqueado =
    !!envioExterno?.bloqueio &&
    !/queued for the Express robot|already been sent|marked as sent manually/i.test(
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
    /queued for the Express robot|already been sent|marked as sent manually/i.test(
      envioExterno?.bloqueio ?? "",
    );
  const aprovandoForcado =
    forcarSemEnvio || !temRelatorio || (!!envioExterno?.bloqueio && !envioResolvido);

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
            />

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

              <FinanceCards
                clientName={clientName}
                partnerName={partnerName}
                received={received}
                paidOut={paidOut}
                clientOutstanding={clientOutstanding}
                partnerOutstanding={partnerOutstanding}
              />

              {hourlySlot ? <div className="px-6 pb-[18px]">{hourlySlot}</div> : null}

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
                  envioResolvido={envioResolvido}
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
