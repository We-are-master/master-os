"use client";

import { useState } from "react";

/**
 * O envio do relatório para a plataforma de origem, INTEIRO, dentro do passo 3.
 *
 * Vive aqui, e não numa faixa no topo do modal, porque é a mesma pergunta do
 * passo: o relatório existe onde precisa existir? Subir no OS e não subir na
 * Housekeep é meio caminho, e é como 198 jobs viraram 16 relatórios. Até
 * 19/08/2026 a resposta aparecia em dois lugares — a faixa do topo e um chip
 * aqui — dizendo a mesma frase com botões diferentes. Duas telas para o mesmo
 * fato é como se erra qual delas está certa.
 *
 * Desde 15/08/2026 este passo não tem botão de PRIMEIRO envio: quem manda é o
 * Approve. Aprovar já quer dizer "está bom e pode ir", e pedir a mesma
 * confirmação duas vezes a dois centímetros de distância só criava a chance de
 * esquecer a segunda, finalizar o job e deixar o relatório para trás.
 *
 * O que mudou em 19/08: tentar de novo deixou de ser privilégio de "out of
 * attempts". Qualquer recusa e qualquer bloqueio têm o botão, porque a causa
 * quase sempre é consertada fora daqui (a foto que subiu, o link que entrou) e
 * até então a tela só sabia dizer não. Quando o motivo ainda existe, a API
 * responde 409 com ele e a linha vermelha abaixo do botão passa a repetir o
 * motivo atual — a pessoa vê POR QUE não foi, em vez de um clique que não faz
 * nada.
 */

export type EstadoEnvioExterno = {
  estado: "nao_enviado" | "enviando" | "enviado" | "falhou";
  link?: string | null;
  erro?: string | null;
  bloqueio?: string | null;
  attempts?: number;
  submittedAt?: string | null;
  /** Marcado como enviado à mão (migração 249): quem marcou assume o envio. */
  manualAt?: string | null;
};

type Preview =
  | { ok: true; forma: "trade" | "limpeza"; campos: Array<{ rotulo: string; valor: string }>; avisos: string[] }
  | { ok: false; motivo: string };

const chip = "text-[11px] px-2 py-[3px] rounded-[5px] inline-flex items-center gap-[5px]";

function hora(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function ExternalReportStep({
  jobUuid,
  envio,
  onEnviado,
  onEditReport,
}: {
  jobUuid: string;
  envio?: EstadoEnvioExterno;
  /** Chamado logo após disparar, para o polling do modal assumir. */
  onEnviado: () => void;
  /**
   * Abre o relatório para edição. Existe porque a recusa quase sempre é campo
   * faltando, e insistir sem mudar nada só repete a recusa.
   */
  onEditReport?: () => void;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [carregando, setCarregando] = useState(false);
  /** Motivo devolvido pelo 409 do último clique: por que ele não saiu AGORA. */
  const [recusa, setRecusa] = useState<string | null>(null);

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

  /**
   * Tenta enviar. `reiniciar` zera o contador antes — o teto de três impede o
   * robô de bater a cabeça a noite inteira, mas depois de consertada a causa
   * ele vira beco sem saída.
   */
  const enviar = async (opts?: { reiniciar?: boolean; manual?: boolean }) => {
    setCarregando(true);
    setRecusa(null);
    try {
      const sufixo = opts?.manual ? "?manual=1" : opts?.reiniciar ? "?reiniciar=1" : "";
      const r = await fetch(`${rota}${sufixo}`, { method: "POST" });
      // 409 = ainda bloqueado. O motivo é a resposta útil: sem ele o clique
      // parece não ter feito nada.
      if (r.status === 409) {
        const corpo = (await r.json().catch(() => null)) as { motivo?: string } | null;
        setRecusa(corpo?.motivo ?? "The client platform still refuses this report.");
        return;
      }
      setPreview(null);
      onEnviado();
    } catch {
      setRecusa("Could not reach the server. Try again in a moment.");
    } finally {
      setCarregando(false);
    }
  };

  const botao = (rotulo: string, onClick: () => void, primario = false) => (
    <button
      type="button"
      onClick={onClick}
      disabled={carregando}
      className="rounded-[5px] px-2.5 py-[4px] text-[11px] font-semibold cursor-pointer disabled:opacity-50"
      style={
        primario
          ? { background: "#020040", color: "#fff" }
          : { background: "#fff", color: "#020040", border: "0.5px solid #D8D8DD" }
      }
    >
      {carregando ? "Working…" : rotulo}
    </button>
  );

/**
 * O motivo pede CONSERTO no relatório, não outra tentativa.
 *
 * Foto faltando, descrição vazia, horário impossível: nada disso muda por
 * insistir, e "Try again" ali é um botão que não pode dar certo. Quatro botões
 * lado a lado, um deles inútil, é como a tela ensina a clicar em tudo até algo
 * acontecer — foi a reclamação do dono em 20/08 ("clico em muito botão pra
 * ainda não dar certo").
 */
const PEDE_CONSERTO = /requires more photos|no photos|no before photos|no after photos|no work description|impossible on-site times|has not sent the final report/i;



  /**
   * Uma ação PRINCIPAL, escolhida pelo que de fato destrava, e o resto miúdo.
   *
   * Quando o motivo pede conserto, o primário é "Edit report" e o "Try again"
   * sai de cena: repetir o envio com o mesmo relatório dá o mesmo motivo, e
   * oferecer isso é prometer o que não se cumpre.
   */
  const acoes = (semTentativas: boolean, motivo: string) => {
    const conserto = PEDE_CONSERTO.test(motivo);
    return (
      <div className="flex flex-wrap items-center gap-2">
        {conserto && onEditReport
          ? botao("Edit report", onEditReport, true)
          : botao(
              semTentativas ? "Reset attempts and try again" : "Try again",
              () => void enviar({ reiniciar: semTentativas }),
              true,
            )}
        {!conserto && onEditReport ? botao("Edit report", onEditReport) : null}
        {botao("Sent manually? Mark it", () => void enviar({ manual: true }))}
        {botao("Check what will be sent", () => void conferir())}
      </div>
    );
  };

  const linhaDaRecusa = recusa ? (
    <p className="m-0 text-[11px]" style={{ color: "#A32D2D" }}>
      Still not sent: {recusa}
    </p>
  ) : null;

  if (!envio) return null;

  if (envio.estado === "enviando") {
    return (
      <span className={chip} style={{ background: "#F1F5FB", color: "#020040" }}>
        <span
          aria-hidden
          className="inline-block h-[9px] w-[9px] animate-spin rounded-full border-[1.5px] border-current border-t-transparent"
        />
        Sending to the client platform… takes 8–35s, this updates by itself
      </span>
    );
  }

  if (envio.estado === "enviado") {
    return (
      <span className={chip} style={{ background: "#E9F7F0", color: "#12704F" }}>
        <span aria-hidden>✓</span>
        Submitted to the client platform
        {envio.submittedAt ? ` · ${hora(envio.submittedAt)}` : ""}
        {envio.link ? (
          <a href={envio.link} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
            check
          </a>
        ) : null}
      </span>
    );
  }

  if (envio.manualAt) {
    return (
      <span className={chip} style={{ background: "#F0FBF7", color: "#0F6E56" }}>
        <span aria-hidden>✓</span>
        Marked as sent manually · {hora(envio.manualAt)}
      </span>
    );
  }

  // Recusado pela plataforma: o erro é o que a pessoa precisa ler antes de
  // decidir entre consertar e insistir.
  if (envio.estado === "falhou" && envio.erro && !envio.bloqueio) {
    const semTentativas = /out of attempts/i.test(envio.erro);
    return (
      <div className="flex flex-col gap-2">
        <span className={chip} style={{ background: "#FDECEA", color: "#A32D2D" }}>
          <span aria-hidden>✕</span>
          Not submitted: {envio.erro}
          {envio.attempts ? ` (attempt ${envio.attempts} of 3)` : ""}
          {envio.link ? (
            <a href={envio.link} target="_blank" rel="noreferrer" className="underline" onClick={(e) => e.stopPropagation()}>
              open the platform
            </a>
          ) : null}
        </span>
        {preview ? <PreviewBox preview={preview} carregando={carregando} onCancelar={() => setPreview(null)} onEnviar={() => void enviar()} /> : acoes(semTentativas, envio.erro)}
        {linhaDaRecusa}
      </div>
    );
  }

  const bloqueio = envio.bloqueio ?? "";

  /**
   * Fila do Express. O texto conta o que de fato aconteceu, em vez de prometer
   * a próxima passada: em 22/08 havia quatro jobs nesta fila com ZERO
   * tentativas, e o chip garantia a todos que o robô concluiria em seguida.
   * Promessa que a tela não consegue verificar é promessa que ensina a não
   * confiar na tela.
   */
  if (/queued for the Express robot/i.test(bloqueio)) {
    const tentativas = envio.attempts ?? 0;
    const tentado = tentativas > 0;
    return (
      <span
        className={chip}
        style={
          tentado
            ? { background: "#FFF6E8", color: "#8A5A00" }
            : { background: "#F1F5FB", color: "#020040" }
        }
      >
        <span aria-hidden>🤖</span>
        {tentado
          ? `Express robot tried ${tentativas} of 3 · it retries on the next pass`
          : "Waiting for the Express robot · not picked up yet"}
        {" · you can finalise now"}
      </span>
    );
  }

  if (/already been sent/i.test(bloqueio)) {
    return (
      <span className={chip} style={{ background: "#E9F7F0", color: "#12704F" }}>
        <span aria-hidden>✓</span>
        Report already on the client platform
      </span>
    );
  }

  if (bloqueio) {
    const semTentativas = /out of attempts/i.test(bloqueio);
    return (
      <div className="flex flex-col gap-2">
        <span className={chip} style={{ background: "#FFF8F3", color: "#7A3D00" }}>
          Cannot send to the client platform: {bloqueio}
        </span>
        {preview ? <PreviewBox preview={preview} carregando={carregando} onCancelar={() => setPreview(null)} onEnviar={() => void enviar()} /> : acoes(semTentativas, bloqueio)}
        {linhaDaRecusa}
      </div>
    );
  }

  return (
    <span className={chip} style={{ background: "#F4F4F6", color: "#6B6B70" }}>
      Goes to the client platform when you approve
    </span>
  );
}

/** O que a plataforma vai receber, campo a campo, antes de insistir. */
function PreviewBox({
  preview,
  carregando,
  onCancelar,
  onEnviar,
}: {
  preview: Preview;
  carregando: boolean;
  onCancelar: () => void;
  onEnviar: () => void;
}) {
  if (!preview.ok) {
    return (
      <div className="rounded-[8px] p-2.5" style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}>
        <p className="m-0 text-[11px]" style={{ color: "#6B6B70" }}>{preview.motivo}</p>
        <button
          type="button"
          onClick={onCancelar}
          className="mt-2 rounded-[5px] bg-white px-2.5 py-[4px] text-[11px] font-medium cursor-pointer"
          style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
        >
          Close
        </button>
      </div>
    );
  }
  return (
    <div className="rounded-[8px] p-2.5" style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}>
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
          onClick={onCancelar}
          className="rounded-[5px] bg-white px-2.5 py-[4px] text-[11px] font-medium cursor-pointer"
          style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={onEnviar}
          disabled={carregando}
          className="rounded-[5px] px-2.5 py-[4px] text-[11px] font-semibold text-white cursor-pointer disabled:opacity-50"
          style={{ background: "#020040" }}
        >
          {carregando ? "Sending…" : "Confirm and send"}
        </button>
      </div>
    </div>
  );
}
