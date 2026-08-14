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

import { useEffect, useRef, useState } from "react";

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
  const jaAvisou = useRef(false);
  const estadoRef = useRef<EstadoResposta["estado"] | null>(null);
  const onEnviadoRef = useRef(onEnviado);
  useEffect(() => {
    onEnviadoRef.current = onEnviado;
  }, [onEnviado]);

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
        <strong>Not submitted:</strong> {estado.error}
        {estado.attempts > 0 ? ` (attempt ${estado.attempts})` : ""}
        {estado.report_link ? (
          <>
            {" · "}
            <a href={estado.report_link} target="_blank" rel="noreferrer" className="underline">
              send by hand
            </a>
          </>
        ) : null}
        <p className="mt-1" style={{ color: "#6B6B70" }}>
          Retry from Review &amp; approve, step 3.
        </p>
      </div>
    );
  }

  // Ainda não enviado: quem manda é a revisão final, então aqui só o motivo,
  // quando houver um. Sem motivo, a linha não tem o que dizer e some.
  if (estado.bloqueio) {
    return (
      <div className="text-[12px]" style={{ color: "#6B6B70" }}>
        Client platform: {estado.bloqueio}
      </div>
    );
  }

  return null;
}
