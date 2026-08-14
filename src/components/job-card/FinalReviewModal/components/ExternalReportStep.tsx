"use client";

import { useEffect, useRef, useState } from "react";

/**
 * O envio do relatório para a plataforma de origem, dentro do passo 3.
 *
 * Vive aqui, e não num botão solto na aba, porque é a mesma pergunta do passo:
 * o relatório existe onde precisa existir? Subir no OS e não subir na Housekeep
 * é meio caminho, e é como 198 jobs viraram 16 relatórios.
 *
 * O envio passa por uma conferência de propósito. O preview já pegou um
 * relatório cuja descrição era a letra "K" e um cujo timer terminava antes de
 * começar: nenhum dos dois é erro técnico, os dois são coisa que ninguém quer
 * mandar para o cliente. Nos primeiros envios ver antes vale mais que velocidade.
 */

export type EstadoEnvioExterno = {
  estado: "nao_enviado" | "enviando" | "enviado" | "falhou";
  link?: string | null;
  erro?: string | null;
  bloqueio?: string | null;
  attempts?: number;
  submittedAt?: string | null;
};

type Preview =
  | { ok: true; forma: "trade" | "limpeza"; campos: Array<{ rotulo: string; valor: string }>; avisos: string[] }
  | { ok: false; motivo: string };

const chip = "text-[11px] px-2 py-[3px] rounded-[5px] inline-flex items-center gap-[5px]";

export function ExternalReportStep({
  jobUuid,
  envio,
  onEnviado,
}: {
  jobUuid: string;
  envio?: EstadoEnvioExterno;
  /** Chamado logo após disparar, para o polling do modal assumir. */
  onEnviado: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [carregando, setCarregando] = useState(false);
  const jaAbriu = useRef(false);

  const rota = `/api/jobs/${jobUuid}/submit-external-report`;

  const conferir = async () => {
    setCarregando(true);
    try {
      const r = await fetch(`${rota}?preview=1`);
      setPreview((await r.json()) as Preview);
    } catch {
      setPreview({ ok: false, motivo: "Could not load the preview." });
    } finally {
      setCarregando(false);
    }
  };

  // Envio pendente e liberado: já abre os campos para conferir. Este passo é
  // agora o que trava o fechamento do job, então esconder a conferência atrás
  // de mais um clique só adiciona atrito ao caminho obrigatório.
  const precisaConferir = envio?.estado === "nao_enviado" && !envio.bloqueio;
  useEffect(() => {
    if (!precisaConferir || jaAbriu.current) return;
    jaAbriu.current = true;
    let vivo = true;
    void (async () => {
      try {
        const r = await fetch(`/api/jobs/${jobUuid}/submit-external-report?preview=1`);
        const d = (await r.json()) as Preview;
        if (vivo) setPreview(d);
      } catch {
        if (vivo) setPreview({ ok: false, motivo: "Could not load the preview." });
      }
    })();
    return () => {
      vivo = false;
    };
  }, [precisaConferir, jobUuid]);

  const enviar = async () => {
    setCarregando(true);
    try {
      await fetch(rota, { method: "POST" });
      setPreview(null);
      onEnviado();
    } finally {
      setCarregando(false);
    }
  };

  if (!envio) return null;

  if (envio.estado === "enviando") {
    return (
      <span className={chip} style={{ background: "#F1F5FB", color: "#020040" }}>
        <span
          aria-hidden
          className="inline-block h-[9px] w-[9px] animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
        Sending to the client platform
      </span>
    );
  }

  if (envio.estado === "enviado") {
    return (
      <span className={chip} style={{ background: "#E9F7F0", color: "#12704F" }}>
        <span aria-hidden>✓</span>
        Submitted to the client platform
        {envio.submittedAt
          ? ` · ${new Date(envio.submittedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`
          : ""}
        {envio.link ? (
          <a href={envio.link} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
            check
          </a>
        ) : null}
      </span>
    );
  }

  // Bloqueado: o motivo é a instrução. "no photos on the report" é o mais comum,
  // e diz exatamente o que fazer antes de tentar de novo.
  if (envio.bloqueio) {
    return (
      <span className={chip} style={{ background: "#F4F4F6", color: "#6B6B70" }}>
        Client platform: {envio.bloqueio}
      </span>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {envio.estado === "falhou" && envio.erro ? (
        <span className={chip} style={{ background: "#FDECEA", color: "#A32D2D" }}>
          <span aria-hidden>✕</span>
          Not submitted: {envio.erro}
          {envio.attempts ? ` (attempt ${envio.attempts})` : ""}
          {envio.link ? (
            <a href={envio.link} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
              send by hand
            </a>
          ) : null}
        </span>
      ) : null}

      {preview ? (
        <div className="rounded-[8px] p-2.5" style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}>
          {preview.ok ? (
            <>
              <p className="text-[11px] font-semibold" style={{ color: "#020040" }}>
                This is what the {preview.forma === "limpeza" ? "cleaning" : "trade"} form will receive
              </p>
              {preview.avisos.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5">
                  {preview.avisos.map((a) => (
                    <li key={a} className="text-[11px]" style={{ color: "#7A3D00" }}>
                      ⚠ {a}
                    </li>
                  ))}
                </ul>
              ) : null}
              <dl className="mt-1.5 space-y-0.5">
                {preview.campos.map((c) => (
                  <div key={c.rotulo} className="flex gap-2 text-[11px]">
                    <dt className="shrink-0" style={{ color: "#6B6B70" }}>{c.rotulo}:</dt>
                    <dd className="min-w-0 break-words" style={{ color: "#020040" }}>{c.valor}</dd>
                  </div>
                ))}
              </dl>
              <div className="mt-2 flex gap-2">
                <button
                  type="button"
                  onClick={() => setPreview(null)}
                  className="rounded-[5px] bg-white px-2.5 py-[4px] text-[11px] font-medium cursor-pointer"
                  style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={() => void enviar()}
                  disabled={carregando}
                  className="rounded-[5px] px-2.5 py-[4px] text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50"
                  style={{ background: "#020040" }}
                >
                  {carregando ? "Sending…" : "Confirm and send"}
                </button>
              </div>
            </>
          ) : (
            <p className="text-[11px]" style={{ color: "#6B6B70" }}>{preview.motivo}</p>
          )}
        </div>
      ) : (
        <button
          type="button"
          onClick={() => void conferir()}
          disabled={carregando}
          className="self-start rounded-[5px] px-2.5 py-[4px] text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50"
          style={{ background: "#020040" }}
        >
          {carregando ? "Loading…" : envio.estado === "falhou" ? "Try again" : "Send to the client platform"}
        </button>
      )}
    </div>
  );
}
