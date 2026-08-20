"use client";

/**
 * A nota do relatório, medida contra o que a plataforma do cliente exige.
 *
 * Fica acima dos cards porque a conta é das duas metades juntas: chegada e
 * conclusão. E fica antes do Approve, que é o ponto todo. Até aqui o motivo de
 * um envio recusado só aparecia depois de tentar, na aba, quando quem digitou
 * já tinha ido embora; a nota traz esse mesmo motivo para o instante em que a
 * pessoa ainda está com a tela aberta e pode resolver.
 *
 * O que ela não faz é impedir. O dono decidiu avisar e deixar seguir: quem
 * trava em campo com sinal ruim manda relatório nenhum, e é esse o problema
 * que se está tentando resolver.
 */
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert } from "lucide-react";
import { reportHealth, faixaDaNota, type ExigenciaDeFoto, type SaudeDoRelatorio } from "@/lib/report-health";
import { pickReportTemplate, usesCleaningForm } from "@/lib/public-report-templates";

const CORES = {
  bloqueado:  { fg: "#B4231C", bg: "#FDF2F1", bd: "#F3D2CF" },
  incompleto: { fg: "#ED4B00", bg: "#FFF6F0", bd: "#FBD9C6" },
  bom:        { fg: "#7A5B00", bg: "#FFFAEC", bd: "#F0E0B0" },
  pronto:     { fg: "#1E7A46", bg: "#F1FAF4", bd: "#CFE9D9" },
} as const;

const PALAVRA = {
  bloqueado:  "Cannot be sent yet",
  incompleto: "Missing things the platform asks for",
  bom:        "Good, a couple of gaps",
  pronto:     "Ready to send",
} as const;

export function ReportHealthCard({
  jobUuid,
  jobTitle,
  startReport,
  finalReport,
  finalReportSubmitted,
  timerStartedAt,
  timerEndedAt,
}: {
  /** Sem ele a nota mede contra o nosso piso, que é palpite. */
  jobUuid?: string | null;
  jobTitle: string | null;
  startReport: unknown;
  finalReport: unknown;
  finalReportSubmitted: boolean | null;
  timerStartedAt: string | null;
  timerEndedAt: string | null;
}) {
  /**
   * A exigência de foto lida da plataforma do cliente, campo a campo.
   *
   * Chega depois da primeira pintura de propósito: a nota aparece na hora com
   * o que dá para saber sem rede, e aperta quando a resposta chega. Plataforma
   * fora do ar deixa a nota como era antes, avisando sem bloquear, porque
   * travar um relatório por causa da rede deles seria trocar um problema por
   * outro pior.
   */
  const [exigencias, setExigencias] = useState<ExigenciaDeFoto[] | undefined>(undefined);
  useEffect(() => {
    if (!jobUuid) return;
    let vivo = true;
    fetch(`/api/jobs/${jobUuid}/platform-requirements`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { exigencias?: ExigenciaDeFoto[] } | null) => {
        if (vivo && d?.exigencias?.length) setExigencias(d.exigencias);
      })
      .catch(() => {});
    return () => {
      vivo = false;
    };
  }, [jobUuid]);

  const saude: SaudeDoRelatorio = useMemo(() => {
    // O template gravado no relatório manda; o título só decide antes de
    // existir relatório. Mesma regra que a Stefane usa para escolher o
    // formulário, para a nota medir o que vai ser de fato enviado.
    const gravado = (finalReport as { template?: unknown } | null)?.template;
    const template =
      typeof gravado === "string" && ["general", "gardener", "cleaner", "certificate"].includes(gravado)
        ? (gravado as never)
        : pickReportTemplate({ title: jobTitle });
    return reportHealth({
      template,
      startReport,
      finalReport,
      finalReportSubmitted,
      timerStartedAt,
      timerEndedAt,
      exigencias,
    });
  }, [jobTitle, startReport, finalReport, finalReportSubmitted, timerStartedAt, timerEndedAt, exigencias]);

  /**
   * Relatório preenchido no formulário ERRADO para este cliente.
   *
   * Visto no JOB-9450 (19/08): um End of Tenancy da Housekeep foi preenchido no
   * formulário geral — uma descrição e um monte de 20 fotos — e este cartão deu
   * 100/100 "ready to send", porque media o relatório contra as regras do
   * formulário que ele mesmo usou. Só que o destino pede cômodo a cômodo, com
   * mínimo por cômodo, e nenhum monte achatado satisfaz isso: o envio foi
   * recusado e o formulário deles ficou vazio.
   *
   * Só a limpeza entra nesta trava, e por assimetria real: um relatório geral
   * NÃO tem como virar um de cômodos (ninguém sabe qual foto é do banheiro),
   * enquanto os outros formulários pedem texto e foto solta, que qualquer
   * template entrega.
   */
  const formaErrada = useMemo(() => {
    const gravado = (finalReport as { template?: unknown } | null)?.template;
    if (typeof gravado !== "string" || gravado === "cleaner") return null;
    return usesCleaningForm(pickReportTemplate({ title: jobTitle })) ? gravado : null;
  }, [finalReport, jobTitle]);

  const faixa = faixaDaNota(saude);
  const c = CORES[faixa];
  const Icone = faixa === "pronto" ? CheckCircle2 : faixa === "bloqueado" ? AlertTriangle : CircleAlert;

  return (
    <div
      className="rounded-[10px] p-3"
      style={{ background: c.bg, border: `0.5px solid ${c.bd}` }}
    >
      <div className="flex items-center gap-3">
        <div className="flex items-baseline gap-1" style={{ color: c.fg }}>
          <span className="text-[26px] font-bold leading-none tabular-nums">{saude.nota}</span>
          <span className="text-[11px] font-semibold">/100</span>
        </div>
        <div className="min-w-0 flex-1">
          <p className="flex items-center gap-1.5 text-[12px] font-semibold" style={{ color: c.fg }}>
            <Icone className="h-3.5 w-3.5 shrink-0" />
            {PALAVRA[faixa]}
          </p>
          <p className="text-[10.5px]" style={{ color: "#6B6B70" }}>
            Report health against what the client platform requires
          </p>
        </div>
      </div>

      {formaErrada ? (
        <p
          className="mt-2.5 border-t pt-2 text-[11px] font-semibold"
          style={{ borderColor: c.bd, color: CORES.bloqueado.fg }}
        >
          Filled with the {formaErrada} form, but this client needs the cleaning form, room by room.
          Ask the partner to refill before approving: flat photo piles are refused on submit.
        </p>
      ) : null}

      {saude.pendencias.length > 0 ? (
        <ul className="mt-2.5 space-y-1 border-t pt-2" style={{ borderColor: c.bd }}>
          {/* Bloqueante primeiro: é a ordem em que resolver rende mais. */}
          {saude.pendencias.slice(0, 6).map((p) => (
            <li key={p.chave} className="flex items-start gap-1.5 text-[11px]" style={{ color: "#3C3C48" }}>
              <span
                className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ background: p.bloqueia ? CORES.bloqueado.fg : "#B9B9C4" }}
              />
              <span>
                {p.rotulo}
                {p.detalhe ? <span style={{ color: "#8A8A96" }}> · {p.detalhe}</span> : null}
                {p.bloqueia ? (
                  <span className="ml-1.5 font-semibold" style={{ color: CORES.bloqueado.fg }}>
                    blocks sending
                  </span>
                ) : null}
              </span>
            </li>
          ))}
          {saude.pendencias.length > 6 ? (
            <li className="text-[10.5px]" style={{ color: "#8A8A96" }}>
              and {saude.pendencias.length - 6} more
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
