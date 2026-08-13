"use client";

/**
 * STEFANE — botão "Approve Report" do card, com conferência antes do envio.
 *
 * O fluxo tem um passo a mais de propósito. Em vez de mandar direto, ele abre o
 * que a Stefane vai preencher, campo a campo, e só envia depois que você
 * confere. Nos primeiros jobs isso vale mais que velocidade: o preview já pegou
 * um relatório cuja descrição era a letra "K" e cujo timer terminava antes de
 * começar, e nenhum dos dois é erro técnico, é coisa que ninguém quer mandar
 * para a Housekeep.
 *
 * O envio leva de 8 a 35 segundos porque preenche um formulário React de
 * verdade, então a tela acompanha por polling em vez de segurar o clique.
 */

import { useCallback, useEffect, useRef, useState } from "react";

type Estado = "nao_enviado" | "enviando" | "enviado" | "falhou";

type EstadoResposta = {
  estado: Estado;
  submitted_at: string | null;
  error: string | null;
  attempts: number;
  report_link: string | null;
  bloqueio: string | null;
};

type Preview =
  | { ok: true; forma: "trade" | "limpeza"; campos: Array<{ rotulo: string; valor: string }>; avisos: string[] }
  | { ok: false; motivo: string };

export function StefaneReportButton({
  jobId,
  onEnviado,
}: {
  jobId: string;
  /** Chamado quando o relatório sobe. É o gancho para abrir o modal de finalizar. */
  onEnviado?: () => void;
}) {
  const [estado, setEstado] = useState<EstadoResposta | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [aberto, setAberto] = useState(false);
  const [carregando, setCarregando] = useState(false);
  const jaAvisou = useRef(false);

  const rota = `/api/jobs/${jobId}/submit-external-report`;

  const buscarEstado = useCallback(async () => {
    const r = await fetch(rota);
    if (!r.ok) return null;
    const d = (await r.json()) as EstadoResposta;
    setEstado(d);
    return d;
  }, [rota]);

  useEffect(() => {
    void buscarEstado();
  }, [buscarEstado]);

  // Enquanto estiver enviando, pergunta de 3 em 3 segundos. Para sozinho quando
  // termina, para não deixar um timer vivo na página inteira.
  useEffect(() => {
    if (estado?.estado !== "enviando") return;
    const t = setInterval(() => {
      void buscarEstado().then((d) => {
        if (d?.estado === "enviado" && !jaAvisou.current) {
          jaAvisou.current = true;
          onEnviado?.();
        }
      });
    }, 3000);
    return () => clearInterval(t);
  }, [estado?.estado, buscarEstado, onEnviado]);

  const abrirConferencia = async () => {
    setCarregando(true);
    try {
      const r = await fetch(`${rota}?preview=1`);
      setPreview((await r.json()) as Preview);
      setAberto(true);
    } finally {
      setCarregando(false);
    }
  };

  const enviar = async () => {
    setCarregando(true);
    try {
      await fetch(rota, { method: "POST" });
      setAberto(false);
      await buscarEstado();
    } finally {
      setCarregando(false);
    }
  };

  if (!estado) return null;

  if (estado.estado === "enviado") {
    return (
      <div className="flex items-center gap-2 text-sm text-emerald-700">
        <span aria-hidden>✓</span>
        <span>
          Relatório na plataforma
          {estado.submitted_at ? ` · ${new Date(estado.submitted_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}` : ""}
        </span>
        {estado.report_link ? (
          <a href={estado.report_link} target="_blank" rel="noreferrer" className="underline">
            abrir
          </a>
        ) : null}
      </div>
    );
  }

  if (estado.estado === "enviando") {
    return (
      <div className="flex items-center gap-2 text-sm text-slate-600">
        <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-slate-600" />
        <span>Enviando para a plataforma. Costuma levar de 10 a 30 segundos.</span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={abrirConferencia}
          disabled={Boolean(estado.bloqueio) || carregando}
          className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          Approve Report
        </button>
        {estado.bloqueio ? <span className="text-sm text-slate-500">{estado.bloqueio}</span> : null}
      </div>

      {estado.estado === "falhou" && estado.error ? (
        <div className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
          <strong>Não subiu:</strong> {estado.error}
          {estado.attempts > 0 ? ` (tentativa ${estado.attempts})` : ""}
          {estado.report_link ? (
            <>
              {" · "}
              <a href={estado.report_link} target="_blank" rel="noreferrer" className="underline">
                enviar à mão
              </a>
            </>
          ) : null}
        </div>
      ) : null}

      {aberto && preview ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-5 shadow-xl">
            <h3 className="text-base font-semibold">Confira antes de enviar</h3>
            {!preview.ok ? (
              <p className="mt-3 text-sm text-slate-600">{preview.motivo}</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-slate-500">
                  Formulário {preview.forma === "limpeza" ? "de limpeza" : "de trade"} da Housekeep.
                </p>

                {preview.avisos.length > 0 ? (
                  <ul className="mt-3 space-y-1 rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
                    {preview.avisos.map((a) => (
                      <li key={a}>⚠ {a}</li>
                    ))}
                  </ul>
                ) : null}

                <dl className="mt-4 space-y-2">
                  {preview.campos.map((c) => (
                    <div key={c.rotulo} className="grid grid-cols-[minmax(0,14rem)_1fr] gap-3 text-sm">
                      <dt className="text-slate-500">{c.rotulo}</dt>
                      <dd className="whitespace-pre-wrap text-slate-900">{c.valor}</dd>
                    </div>
                  ))}
                </dl>
              </>
            )}

            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setAberto(false)}
                className="rounded-md border px-3 py-2 text-sm"
              >
                Cancelar
              </button>
              {preview.ok ? (
                <button
                  type="button"
                  onClick={enviar}
                  disabled={carregando}
                  className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:bg-slate-300"
                >
                  Enviar para a Housekeep
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
