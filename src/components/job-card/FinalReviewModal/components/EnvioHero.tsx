"use client";

import { useState } from "react";
import type { EstadoEnvioExterno } from "./ExternalReportStep";

/**
 * O destino do relatório, em cima do resumo do job — não num chip escondido.
 *
 * Aprovar o relatório dispara o envio, e esta faixa é onde se acompanha: o
 * loading enquanto a Stefane preenche o formulário do outro lado, o carimbo
 * verde quando entrou, e o MOTIVO quando não entrou, com a saída do lado
 * (editar o relatório e tentar de novo). Antes isso morava no passo 3 da
 * timeline, do tamanho de uma legenda, e a pergunta que decide se o job pode
 * fechar não merece corpo de legenda.
 *
 * "Sent manually? Mark it" é o force approve com rastro: grava quem e quando
 * nas colunas manuais, tira o job da fila do robô e libera a finalização.
 */
export function EnvioHero({
  jobUuid,
  envio,
  onRecarregar,
  onEditReport,
}: {
  jobUuid: string;
  envio?: EstadoEnvioExterno;
  onRecarregar: () => void;
  onEditReport?: () => void;
}) {
  const [ocupado, setOcupado] = useState(false);
  const rota = `/api/jobs/${jobUuid}/submit-external-report`;

  const chamar = async (sufixo: string) => {
    setOcupado(true);
    try {
      await fetch(`${rota}${sufixo}`, { method: "POST" });
      onRecarregar();
    } finally {
      setOcupado(false);
    }
  };

  const caixa = (fundo: string, borda: string, children: React.ReactNode) => (
    <div className="px-6 pt-4">
      <div
        className="rounded-[10px] px-4 py-3 flex flex-col gap-2"
        style={{ background: fundo, border: `0.5px solid ${borda}` }}
      >
        {children}
      </div>
    </div>
  );

  const botao = (rotulo: string, onClick: () => void, primario = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={ocupado}
      className="rounded-[6px] px-3 py-[5px] text-[11.5px] font-semibold cursor-pointer disabled:opacity-50"
      style={
        primario
          ? { background: "#020040", color: "#fff" }
          : { background: "#fff", color: "#020040", border: "0.5px solid #D8D8DD" }
      }
    >
      {ocupado ? "Working…" : rotulo}
    </button>
  );

  const marcarManual = botao("Sent manually? Mark it", () => void chamar("?manual=1"));

  if (!envio) {
    return caixa("#FAFAFB", "#E4E4E8", (
      <p className="m-0 text-[12px]" style={{ color: "#6B6B70" }}>
        Checking the client platform…
      </p>
    ));
  }

  if (envio.estado === "enviando") {
    return caixa("#F1F5FB", "#C9D8F0", (
      <div className="flex items-center gap-3">
        <span
          aria-hidden
          className="inline-block h-[18px] w-[18px] shrink-0 animate-spin rounded-full border-2 border-[#020040] border-t-transparent"
        />
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold" style={{ color: "#020040" }}>
            Sending the report to the client platform…
          </p>
          <p className="m-0 text-[11px]" style={{ color: "#6B6B70" }}>
            Takes 8–35 seconds. You can keep reviewing — this updates by itself.
          </p>
        </div>
      </div>
    ));
  }

  if (envio.estado === "enviado") {
    return caixa("#E9F7F0", "#B5E3D1", (
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="text-[16px]" style={{ color: "#12704F" }}>✓</span>
        <p className="m-0 min-w-0 text-[13px] font-semibold" style={{ color: "#12704F" }}>
          Report delivered to the client platform
          {envio.submittedAt
            ? ` · ${new Date(envio.submittedAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}`
            : ""}
          {envio.link ? (
            <>
              {" · "}
              <a href={envio.link} target="_blank" rel="noreferrer" className="underline">
                check
              </a>
            </>
          ) : null}
        </p>
      </div>
    ));
  }

  if (envio.manualAt) {
    return caixa("#F0FBF7", "#B5E3D1", (
      <div className="flex items-center gap-2.5">
        <span aria-hidden className="text-[16px]" style={{ color: "#0F6E56" }}>✓</span>
        <p className="m-0 text-[13px] font-semibold" style={{ color: "#0F6E56" }}>
          Marked as sent manually
          {` · ${new Date(envio.manualAt).toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" })}`}
        </p>
      </div>
    ));
  }

  if (envio.estado === "falhou") {
    const semTentativas = /out of attempts/i.test(envio.bloqueio ?? "");
    return caixa("#FDF3F3", "#EFC9C9", (
      <>
        <div className="flex items-start gap-2.5">
          <span aria-hidden className="mt-[1px] text-[15px]" style={{ color: "#A32D2D" }}>✕</span>
          <div className="min-w-0">
            <p className="m-0 text-[13px] font-semibold" style={{ color: "#A32D2D" }}>
              Not delivered to the client platform
            </p>
            <p className="m-0 text-[12px]" style={{ color: "#7A3D3D" }}>
              {envio.erro ?? "The platform refused the report."}
              {envio.attempts ? ` (attempt ${envio.attempts} of 3)` : ""}
            </p>
          </div>
        </div>
        {/* Editar vem primeiro: a recusa quase sempre é campo faltando, e
            insistir sem mudar nada só repete a recusa. */}
        <div className="flex flex-wrap items-center gap-2">
          {onEditReport ? botao("Edit report", onEditReport) : null}
          {botao(
            semTentativas ? "Reset attempts and try again" : "Try again",
            () => void chamar(semTentativas ? "?reiniciar=1" : ""),
            true,
          )}
          {envio.link ? (
            <a
              href={envio.link}
              target="_blank"
              rel="noreferrer"
              className="text-[11.5px] underline"
              style={{ color: "#7A3D3D" }}
            >
              open the platform
            </a>
          ) : null}
          {marcarManual}
        </div>
      </>
    ));
  }

  const bloqueio = envio.bloqueio ?? "";

  if (/queued for the Express robot/i.test(bloqueio)) {
    return caixa("#F1F5FB", "#C9D8F0", (
      <div className="flex items-start gap-2.5">
        <span aria-hidden className="text-[15px]">🤖</span>
        <div className="min-w-0">
          <p className="m-0 text-[13px] font-semibold" style={{ color: "#020040" }}>
            Queued for the Express robot
          </p>
          <p className="m-0 text-[11.5px]" style={{ color: "#6B6B70" }}>
            It completes the job on the platform on its next pass. You can finalise now.
          </p>
        </div>
      </div>
    ));
  }

  if (/already been sent/i.test(bloqueio)) {
    return caixa("#E9F7F0", "#B5E3D1", (
      <p className="m-0 text-[13px] font-semibold" style={{ color: "#12704F" }}>
        ✓ Report already on the client platform
      </p>
    ));
  }

  if (bloqueio) {
    const semTentativas = /out of attempts/i.test(bloqueio);
    return caixa("#FFF8F3", "#F5CFB8", (
      <>
        <p className="m-0 text-[12.5px] font-semibold" style={{ color: "#7A3D00" }}>
          Cannot send to the client platform: {bloqueio}
        </p>
        <div className="flex flex-wrap items-center gap-2">
          {onEditReport ? botao("Edit report", onEditReport) : null}
          {semTentativas ? botao("Reset attempts and try again", () => void chamar("?reiniciar=1"), true) : null}
          {marcarManual}
        </div>
      </>
    ));
  }

  return caixa("#FAFAFB", "#E4E4E8", (
    <p className="m-0 text-[12px]" style={{ color: "#6B6B70" }}>
      Goes to the client platform when you approve the report.
    </p>
  ));
}
