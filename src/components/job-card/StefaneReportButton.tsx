"use client";

/**
 * STEFANE — o estado do envio do relatório na plataforma de origem.
 *
 * Só estado. A ação de enviar, com a conferência campo a campo antes, vive no
 * passo 3 da revisão final (`FinalReviewModal/components/ExternalReportStep`),
 * que é onde a pergunta aparece no fluxo. Aqui isto era um botão chamado
 * "Approve Report", a dois centímetros de outro chamado "Approve report" que
 * aprovava o relatório localmente: dois pesos completamente diferentes
 * separados por uma letra maiúscula.
 *
 * O envio leva de 8 a 35 segundos porque preenche um formulário React de
 * verdade, então a linha acompanha por polling em vez de segurar o clique.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { RotateCcw, Send } from "lucide-react";

type Estado = "nao_enviado" | "enviando" | "enviado" | "falhou";

type EstadoResposta = {
  estado: Estado;
  submitted_at: string | null;
  error: string | null;
  attempts: number;
  report_link: string | null;
  bloqueio: string | null;
};

export function StefaneReportButton({
  jobId,
  onEnviado,
}: {
  jobId: string;
  /** Chamado quando o relatório sobe. É o gancho para abrir o modal de finalizar. */
  onEnviado?: () => void;
}) {
  const [estado, setEstado] = useState<EstadoResposta | null>(null);
  const [tentando, setTentando] = useState(false);
  const jaAvisou = useRef(false);
  const estadoRef = useRef<EstadoResposta["estado"] | null>(null);
  const recarregarRef = useRef<() => void>(() => {});
  const onEnviadoRef = useRef(onEnviado);
  useEffect(() => {
    onEnviadoRef.current = onEnviado;
  }, [onEnviado]);

  /**
   * Reenvia sem sair da aba.
   *
   * O primeiro envio passa pela conferência campo a campo, no passo 3 da
   * revisão. Uma nova tentativa não precisa: o conteúdo é o mesmo que já foi
   * revisado, e o que falhou foi o transporte. Sem este botão o caminho de um
   * envio que não foi é abrir o modal de novo ou fazer à mão — que é o que
   * deixou 8 jobs fechados com o relatório parado no OS.
   */
  const tentarDeNovo = useCallback(async () => {
    if (tentando) return;
    setTentando(true);
    try {
      await fetch(`/api/jobs/${jobId}/submit-external-report`, { method: "POST" });
      recarregarRef.current();
    } finally {
      setTentando(false);
    }
  }, [jobId, tentando]);

  // Um efeito só, com bandeira de vivo: busca ao montar e, enquanto estiver
  // enviando, repete de 3 em 3 segundos. Para sozinho quando termina, para não
  // deixar um timer vivo na página inteira.
  useEffect(() => {
    let vivo = true;
    const rota = `/api/jobs/${jobId}/submit-external-report`;

    const buscar = async () => {
      try {
        const r = await fetch(rota);
        if (!r.ok || !vivo) return;
        const d = (await r.json()) as EstadoResposta;
        if (!vivo) return;
        estadoRef.current = d.estado;
        setEstado(d);
        if (d.estado === "enviado" && !jaAvisou.current) {
          jaAvisou.current = true;
          onEnviadoRef.current?.();
        }
      } catch {
        // Sem estado a linha some, e o resto da aba continua utilizável.
      }
    };

    recarregarRef.current = () => void buscar();

    void buscar();
    const t = setInterval(() => {
      if (estadoRef.current === "enviando") void buscar();
    }, 3000);
    return () => {
      vivo = false;
      clearInterval(t);
    };
  }, [jobId]);

  if (!estado) return null;

  if (estado.estado === "enviado") {
    return (
      <div className="flex flex-wrap items-center gap-2 text-[12px]" style={{ color: "#12704F" }}>
        <span aria-hidden>✓</span>
        <span>
          Report submitted to the client platform
          {estado.submitted_at
            ? ` · ${new Date(estado.submitted_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
            : ""}
        </span>
        {estado.report_link ? (
          <a href={estado.report_link} target="_blank" rel="noreferrer" className="underline">
            open
          </a>
        ) : null}
      </div>
    );
  }

  if (estado.estado === "enviando") {
    return (
      <div className="flex items-center gap-2 text-[12px]" style={{ color: "#6B6B70" }}>
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <span>Sending to the client platform. Usually 10 to 30 seconds.</span>
      </div>
    );
  }

  if (estado.estado === "falhou" && estado.error) {
    return (
      <div
        className="rounded-[8px] px-3 py-2 text-[12px]"
        style={{ background: "#FDECEA", border: "0.5px solid #F5C6C0", color: "#A32D2D" }}
      >
        <p>
          <strong>Not submitted:</strong> {estado.error}
          {estado.attempts > 0 ? ` (attempt ${estado.attempts} of 3)` : ""}
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          {estado.bloqueio ? (
            <span className="text-[11px]" style={{ color: "#6B6B70" }}>{estado.bloqueio}</span>
          ) : (
            <button
              type="button"
              onClick={() => void tentarDeNovo()}
              disabled={tentando}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-[12px] py-[6px] text-[12px] font-semibold text-white cursor-pointer disabled:opacity-50"
              style={{ background: "#020040" }}
            >
              <RotateCcw className="h-3 w-3" />
              {tentando ? "Starting…" : "Try again"}
            </button>
          )}
          {estado.report_link ? (
            <a
              href={estado.report_link}
              target="_blank"
              rel="noreferrer"
              className="rounded-[6px] bg-white px-[12px] py-[6px] text-[12px] font-medium"
              style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
            >
              Send by hand
            </a>
          ) : null}
        </div>
      </div>
    );
  }

  // Ainda não enviado. O primeiro envio passa pela conferência do passo 3, mas
  // o job pode já ter fechado — e aí o modal fica fora de mão. Se está
  // elegível, o botão aparece aqui também.
  if (estado.bloqueio) {
    return (
      <div className="text-[12px]" style={{ color: "#6B6B70" }}>
        Client platform: {estado.bloqueio}
      </div>
    );
  }

  return (
    <div
      className="flex flex-wrap items-center justify-between gap-2 rounded-[8px] px-3 py-2"
      style={{ background: "#FFF8F3", border: "0.5px solid #F5CFB8" }}
    >
      <p className="text-[12px]" style={{ color: "#7A3D00" }}>
        The report has not gone to the client platform yet.
      </p>
      <button
        type="button"
        onClick={() => void tentarDeNovo()}
        disabled={tentando}
        className="inline-flex items-center gap-1.5 rounded-[6px] px-[12px] py-[6px] text-[12px] font-semibold text-white cursor-pointer disabled:opacity-50"
        style={{ background: "#020040" }}
      >
        <Send className="h-3 w-3" />
        {tentando ? "Starting…" : "Send to Housekeep"}
      </button>
    </div>
  );
}
