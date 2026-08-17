"use client";

import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { modalTransition, overlayTransition } from "@/lib/motion";
import { FinanceCards } from "./components/FinanceCards";
import { MarginHero } from "./components/MarginHero";
import { EnvioHero } from "./components/EnvioHero";
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
 * Enquanto estiver enviando, pergunta de 3 em 3 segundos e para sozinho quando
 * termina. O envio leva de 8 a 35 segundos porque preenche um formulário de
 * verdade do outro lado, então segurar a tela não é opção.
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
        if (!r.ok || !vivo) return;
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
        // Falha de rede não pode derrubar o modal: sem estado, o passo 3 só não
        // mostra o selo, e o resto da revisão continua utilizável.
      }
    };
    buscarRef.current = () => void buscar();

    void buscar();
    const t = setInterval(() => {
      if (estadoRef.current === "enviando") void buscar();
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
    sentToAccounts,
    onSentToAccountsChange,
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
    void fetch(`/api/jobs/${jobUuid}/submit-external-report`, { method: "POST" })
      // Avisa o passo 3 na hora, senão ele fica no texto de espera: o polling
      // dele só liga depois de ver o estado "enviando" uma vez, e sem isto a
      // rodinha nunca apareceria.
      .then(() => recarregar())
      .catch((err) => console.error("[final-review] envio externo falhou:", err));
  };

  // Rede de segurança: job sem relatório pula a etapa de conferência, então o
  // envio nunca foi disparado. Aqui ele ainda sai, se puder.
  const aprovarEEnviar = () => {
    dispararEnvio();
    onApprove();
  };

  // Docs must exist; report upload/approve is no longer a hard gate —
  // office attests “report submitted to the customer” (partners rarely use the app).
  const docsReady = invoiceStatus === "issued" && selfBillStatus === "issued";
  const attestationsOk = confirmed && sentToAccounts;

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
  const envioPendente =
    !!envioExterno &&
    !envioExterno.bloqueio &&
    envioExterno.estado !== "enviado";
  const canApprove =
    attestationsOk && docsReady && !submitting && (!envioPendente || forcarSemEnvio);

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
              {/* O destino do relatório em primeiro: é a pergunta que decide
                  se este job pode fechar, e ela agora abre o resumo. */}
              <EnvioHero
                jobUuid={jobUuid}
                envio={envioExterno}
                onRecarregar={recarregar}
                onEditReport={onEditReport}
              />
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
                  sentToAccounts={sentToAccounts}
                  onSentToAccountsChange={onSentToAccountsChange}
                  currentUserName={currentUserName}
                  bloqueadoPeloEnvio={envioPendente && !forcarSemEnvio}
                  onForcar={() => setForcarSemEnvio(true)}
                />
                <ModalFooter
                  canApprove={canApprove}
                  submitting={submitting}
                  onCancel={fechar}
                  onApprove={aprovarEEnviar}
                  forcado={aprovandoForcado}
                />
              </>
            ) : null}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
