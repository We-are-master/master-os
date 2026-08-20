"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, CalendarClock, CheckCircle2, Clock3, FileText, ImageIcon, Loader2, ShieldCheck, Sparkles, Upload, ExternalLink, Undo2 } from "lucide-react";
import { toast } from "sonner";
import {
  normalizeReport,
  renderableFields,
  type ReportKind,
} from "@/lib/job-report-v2";
import {
  certificateAiEnvelope,
  certificateAttachmentUrls,
  certificateValidity,
  expiryHeadline,
  expirySourceNote,
  type CertificateValidity,
} from "@/lib/certificate-expiry";
import { createSignedJobReportAssetUrl } from "@/services/job-reports";

interface JobReportV2CardProps {
  jobId:       string;
  kind:        ReportKind;
  rawReport:   unknown;
  /** ISO from jobs.<kind>_report_approved_at — null = pending review. */
  approvedAt:  string | null;
  /** profiles row joined as approved_by display name (optional). */
  approvedBy?: string | null;
  /** Read-only mode disables approve/reject buttons. */
  readOnly?:   boolean;
  /** Called after a successful approval toggle so the parent can refetch. */
  onApprovalChange?: () => void;
  /**
   * Relatório de chegada, para o card FINAL mostrar as fotos como o par que
   * elas são: Before e After lado a lado. Sem isto a aba só via o "depois" —
   * o "antes" vive no start_report, que a aba não renderiza. Não passar onde
   * o card de chegada já aparece por conta própria (revisão final), senão a
   * mesma foto entra duas vezes na tela.
   */
  rawStartReport?: unknown;
  /**
   * Janela em campo (`jobs.partner_timer_*`): é o que vira Start/Finish time
   * na plataforma do cliente, então o card mostra — revisar o relatório sem
   * ver as horas era revisar metade.
   */
  timerStartedAt?: string | null;
  timerEndedAt?:   string | null;
}

export function JobReportV2Card({
  jobId,
  kind,
  rawReport,
  approvedAt,
  approvedBy,
  readOnly,
  onApprovalChange,
  timerStartedAt,
  timerEndedAt,
  rawStartReport,
}: JobReportV2CardProps) {
  const report = useMemo(() => normalizeReport(rawReport), [rawReport]);
  const startReport = useMemo(
    () => (kind === "final" && rawStartReport ? normalizeReport(rawStartReport) : null),
    [kind, rawStartReport],
  );
  // Campos das DUAS metades num bloco só (chegada por último, sem repetir
  // chave): o card é um relatório único, e "o que foi visto na chegada"
  // também é relatório.
  const fields = useMemo(() => {
    const doFinal = report ? renderableFields(report) : [];
    if (!startReport) return doFinal;
    const chaves = new Set(doFinal.map((f) => f.key));
    return [...doFinal, ...renderableFields(startReport).filter((f) => !chaves.has(f.key))];
  }, [report, startReport]);

  // Certificate jobs answer one question before any other: until when is this
  // valid? It comes from the typed field or from what the model read off the
  // attached document, and the strip below says which.
  const validity = useMemo(() => certificateValidity(rawReport), [rawReport]);
  const certificate = useMemo(() => {
    if (kind !== "final" || report?.template !== "certificate") return null;
    return {
      hasAttachment: certificateAttachmentUrls(rawReport).length > 0,
      ai: certificateAiEnvelope(rawReport),
    };
  }, [kind, report?.template, rawReport]);

  const [openingImageKey, setOpeningImageKey] = useState<string | null>(null);
  const [savingApproval, setSavingApproval] = useState(false);
  const [readingCertificate, setReadingCertificate] = useState(false);

  /**
   * As horas em campo, como a plataforma do cliente vai recebê-las.
   *
   * Vêm do timer do parceiro (ou do que o escritório digitou no Edit report),
   * sempre em hora de Londres — que é o relógio do formulário do outro lado.
   * Sem timer, cai na duração digitada no relatório. Só no card final: a
   * janela é da visita inteira, e é aqui que ela é revisada.
   */
  const emCampo = useMemo(() => {
    if (kind !== "final") return null;
    const fmt = (iso: string) => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return null;
      return d.toLocaleTimeString("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit" });
    };
    const ini = timerStartedAt ? fmt(timerStartedAt) : null;
    const fim = timerEndedAt ? fmt(timerEndedAt) : null;
    const durMsCru =
      timerStartedAt && timerEndedAt
        ? new Date(timerEndedAt).getTime() - new Date(timerStartedAt).getTime()
        : typeof (rawReport as { duration_ms?: unknown } | null)?.duration_ms === "number"
          ? (rawReport as { duration_ms: number }).duration_ms
          : null;
    let dur: string | null = null;
    if (durMsCru !== null && Number.isFinite(durMsCru) && durMsCru > 0) {
      const h = Math.floor(durMsCru / 3_600_000);
      const m = Math.round((durMsCru % 3_600_000) / 60_000);
      dur = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;
    }
    const invertido = durMsCru !== null && durMsCru <= 0;
    if (!ini && !fim && !dur && !invertido) return null;
    return { ini, fim, dur, invertido };
  }, [kind, timerStartedAt, timerEndedAt, rawReport]);

  /**
   * "Validated", nao "Approved".
   *
   * `final_report_approved_at` e gravado no instante em que o parceiro SUBMETE,
   * pelo persistReportSubmission — nao quando alguem revisa. Chamar isso de
   * Approved fazia a tela dizer que o job estava aprovado com o mesmo horario da
   * submissao, e quem lesse concluiria que nao havia mais nada a fazer. Havia:
   * o Finish work do cabecalho, que e onde a decisao acontece de verdade.
   */
  const isApproved = !!approvedAt;
  // Um relatório só, a pedido: a visita é uma e o relatório é um. "Start"
  // continua existindo como DADO (fotos de antes, campos de chegada), mas
  // entra DENTRO deste card — não como um segundo card na tela.
  const titleLabel = kind === "start" ? "Start report" : "Report";

  /**
   * URLs assinadas de todas as fotos, buscadas na montagem.
   *
   * O bucket é privado, então o que está gravado no relatório não abre sozinho.
   * Antes a assinatura só acontecia no clique e a foto ia para outra aba: dava
   * para saber que existia uma foto, nunca para ver o que ela mostra. Quem
   * aprova precisa olhar o que o cliente vai olhar, e uma lista de botões
   * escritos "Image" não é olhar.
   */
  const [assinadas, setAssinadas] = useState<Record<string, string>>({});
  const [ampliada, setAmpliada] = useState<string | null>(null);

  const todasAsFotos = useMemo(() => {
    const out: string[] = [];
    for (const rep of [startReport, report]) {
      if (!rep) continue;
      const doMapa = rep.photosByRoom
        ? Object.values(rep.photosByRoom).flatMap((v) => (Array.isArray(v) ? v : []))
        : [];
      // `photosByRoom` guarda string; `photosFlat` guarda `{ url }`. Achatar as
      // duas formas aqui é o que faz a assinatura valer para os dois templates.
      out.push(...doMapa, ...rep.photosFlat.map((p) => p.url));
    }
    return out.filter((u): u is string => typeof u === "string" && u.trim().length > 0);
  }, [report, startReport]);

  useEffect(() => {
    let vivo = true;
    const faltando = todasAsFotos.filter((u) => !assinadas[u]);
    if (faltando.length === 0) return;
    void (async () => {
      const pares = await Promise.all(
        faltando.map(async (u) => [u, await createSignedJobReportAssetUrl(u, 60 * 60)] as const),
      );
      if (!vivo) return;
      const novas: Record<string, string> = {};
      for (const [cru, assinada] of pares) if (assinada) novas[cru] = assinada;
      if (Object.keys(novas).length > 0) setAssinadas((p) => ({ ...p, ...novas }));
    })();
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assinar só o que falta, sem religar a cada assinatura
  }, [todasAsFotos]);

  const openImage = useCallback(
    async (rawUrl: string, key: string) => {
      const jaTem = assinadas[rawUrl];
      if (jaTem) {
        setAmpliada(jaTem);
        return;
      }
      setOpeningImageKey(key);
      try {
        const signed = await createSignedJobReportAssetUrl(rawUrl, 60 * 60);
        if (!signed) {
          toast.error("Could not sign image URL.");
          return;
        }
        setAmpliada(signed);
      } finally {
        setOpeningImageKey(null);
      }
    },
    [assinadas],
  );

  const setApproval = useCallback(async (approve: boolean) => {
    setSavingApproval(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/reports/${kind}/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ approve }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        toast.error(body?.error ?? `Could not ${approve ? "approve" : "unapprove"} report.`);
        return;
      }
      toast.success(approve ? "Report approved." : "Approval cleared.");
      onApprovalChange?.();
    } finally {
      setSavingApproval(false);
    }
  }, [jobId, kind, onApprovalChange]);

  const readCertificate = useCallback(async () => {
    setReadingCertificate(true);
    try {
      const res = await fetch(`/api/jobs/${jobId}/read-certificate`, { method: "POST" });
      const body = await res.json().catch(() => null);
      if (!res.ok) {
        toast.error(body?.error ?? "Could not read the certificate.");
        return;
      }
      toast.success(
        body?.applied
          ? "Expiry date read from the certificate."
          : "Certificate read, but the expiry date was not usable.",
      );
      onApprovalChange?.();
    } finally {
      setReadingCertificate(false);
    }
  }, [jobId, onApprovalChange]);

  if (!report) {
    return (
      <div
        className="rounded-[10px] p-4"
        style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
      >
        <div className="flex items-center gap-2">
          <FileText className="h-4 w-4 shrink-0" style={{ color: "#9A9AA0" }} />
          <p className="text-[13px] font-medium" style={{ color: "#020040" }}>
            {titleLabel}
          </p>
          <span
            className="ml-auto text-[10px] font-medium px-[7px] py-[2px] rounded shrink-0"
            style={{ background: "#F1F1F3", color: "#6B6B70" }}
          >
            Not submitted
          </span>
        </div>
      </div>
    );
  }

  const cardStyle = isApproved
    ? { background: "#F0FBF7", border: "0.5px solid #B5E3D1" }
    : { background: "#FFF8F3", border: "0.5px solid #F5CFB8" };

  return (
    <div className="rounded-[10px] p-[14px] space-y-3" style={cardStyle}>
      {ampliada ? <Lightbox url={ampliada} onClose={() => setAmpliada(null)} /> : null}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          {isApproved ? (
            <ShieldCheck className="h-4 w-4 shrink-0" style={{ color: "#0F6E56" }} />
          ) : (
            <Upload className="h-4 w-4 shrink-0" style={{ color: "#ED4B00" }} />
          )}
          <p className="text-[13px] font-medium truncate" style={{ color: "#020040" }}>
            {titleLabel}
          </p>
          <span
            className="text-[10px] font-medium px-[7px] py-[2px] rounded shrink-0 uppercase tracking-wide"
            style={{ background: "#1C1917", color: "#FFFFFF" }}
          >
            {report.template}
          </span>
        </div>
        <span
          className="text-[10px] font-medium px-[7px] py-[2px] rounded shrink-0"
          style={
            isApproved
              ? { background: "#E4F5EE", color: "#0F6E56" }
              : { background: "#FFF1EB", color: "#ED4B00" }
          }
        >
          {isApproved ? "Validated" : "Pending review"}
        </span>
      </div>

      <div className="text-[11px] flex flex-wrap gap-x-3 gap-y-1" style={{ color: "#6B6B70" }}>
        {report.submittedAt ? (
          <span>
            Submitted{" "}
            {report.submittedAt.toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "Europe/London",
            })}
          </span>
        ) : null}
        {approvedAt ? (
          <span style={{ color: "#0F6E56" }}>
            Validated{" "}
            {new Date(approvedAt).toLocaleString("en-GB", {
              day: "2-digit",
              month: "short",
              year: "numeric",
              hour: "2-digit",
              minute: "2-digit",
              hour12: true,
              timeZone: "Europe/London",
            })}
            {approvedBy ? ` by ${approvedBy}` : ""}
          </span>
        ) : null}
      </div>

      {emCampo ? (
        <div
          className="rounded-[8px] px-3 py-[10px] flex items-start gap-2"
          style={
            emCampo.invertido
              ? { background: "#FDF3F3", border: "0.5px solid #EFC9C9" }
              : { background: "#F4F5FB", border: "0.5px solid #D8DBEE" }
          }
        >
          <Clock3 className="h-4 w-4 shrink-0 mt-[1px]" style={{ color: emCampo.invertido ? "#A32D2D" : "#020040" }} />
          <div className="min-w-0">
            <p className="text-[12px] font-semibold" style={{ color: emCampo.invertido ? "#A32D2D" : "#020040" }}>
              On site{" "}
              {emCampo.ini && emCampo.fim
                ? `${emCampo.ini} → ${emCampo.fim}`
                : emCampo.ini
                  ? `from ${emCampo.ini}`
                  : ""}
              {emCampo.dur ? ` · ${emCampo.dur}` : ""}
            </p>
            <p className="text-[11px]" style={{ color: "#6B6B70" }}>
              {emCampo.invertido
                ? "Finish is before start — the partner timer was left running. Fix it in Edit report before sending."
                : "London time · goes to the client platform as the start and finish times."}
            </p>
          </div>
        </div>
      ) : null}

      {validity ? <ValidityStrip validity={validity} /> : null}

      {certificate && !validity ? (
        <CertificateReadPrompt
          hasAttachment={certificate.hasAttachment}
          error={certificate.ai?.error ?? null}
          reading={readingCertificate}
          readOnly={readOnly}
          onRead={readCertificate}
        />
      ) : null}

      {fields.length > 0 ? (
        <div className="rounded-[8px] p-3 bg-white space-y-1.5" style={{ border: "0.5px solid #E4E4E8" }}>
          {fields.map((f) => (
            <div key={f.key} className="flex flex-wrap items-baseline gap-x-2 text-[12px]">
              <span className="font-semibold shrink-0" style={{ color: "#020040" }}>
                {f.label}:
              </span>
              <span className="break-words" style={{ color: "#3A3A55", whiteSpace: "pre-wrap" }}>
                {f.display}
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {/* As fotos como o PAR que provam o serviço: Before (do relatório de
          chegada, quando ele veio junto) e After, cada metade rotulada. Sem o
          par, mantém o rótulo "Photos" de sempre. */}
      {(
        [
          startReport ? ([startReport, "Before"] as const) : null,
          report ? ([report, startReport ? "After" : "Photos"] as const) : null,
        ].filter(Boolean) as Array<readonly [NonNullable<typeof report>, string]>
      ).map(([rep, rotulo]) =>
        rep.photosByRoom ? (
          <div key={rotulo} className="space-y-2">
            {Object.entries(rep.photosByRoom).map(([room, urls]) =>
              urls.length === 0 ? null : (
                <div key={`${rotulo}-${room}`} className="rounded-[8px] p-3 bg-white" style={{ border: "0.5px solid #E4E4E8" }}>
                  <p
                    className="text-[10px] font-bold uppercase tracking-wide mb-2"
                    style={{ color: "#6B6B70" }}
                  >
                    {rotulo === "Photos" ? "" : `${rotulo} · `}
                    {room.replace(/_/g, " ")}{" "}
                    <span style={{ color: "#A8A29E" }}>· {urls.length} photo{urls.length === 1 ? "" : "s"}</span>
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {urls.map((u, i) => (
                      <ImageButton
                        key={`${rotulo}-${room}-${i}`}
                        url={u}
                        label={`${rotulo}-${room}-${i}`}
                        onOpen={openImage}
                        opening={openingImageKey === `${rotulo}-${room}-${i}`}
                        signedUrl={assinadas[u]}
                      />
                    ))}
                  </div>
                </div>
              ),
            )}
          </div>
        ) : rep.photosFlat.length > 0 ? (
          <div key={rotulo} className="rounded-[8px] p-3 bg-white" style={{ border: "0.5px solid #E4E4E8" }}>
            <p
              className="text-[10px] font-bold uppercase tracking-wide mb-2"
              style={{ color: "#6B6B70" }}
            >
              {rotulo === "Photos" ? "Photos" : `${rotulo} photos`}{" "}
              <span style={{ color: "#A8A29E" }}>· {rep.photosFlat.length}</span>
            </p>
            <div className="flex flex-wrap gap-2">
              {rep.photosFlat.map((p, i) => (
                <ImageButton
                  key={`${rotulo}-flat-${i}`}
                  url={p.url}
                  label={`${rotulo}-flat-${i}`}
                  onOpen={openImage}
                  opening={openingImageKey === `${rotulo}-flat-${i}`}
                  signedUrl={assinadas[p.url]}
                />
              ))}
            </div>
          </div>
        ) : null,
      )}

      {!readOnly ? (
        <div className="flex items-center gap-2 pt-1">
          {isApproved ? (
            <button
              type="button"
              onClick={() => void setApproval(false)}
              disabled={savingApproval}
              className="inline-flex items-center gap-1.5 bg-white rounded-[6px] px-[10px] py-[6px] text-[12px] font-medium cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
            >
              {savingApproval ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />}
              Revoke validation
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void setApproval(true)}
              disabled={savingApproval}
              className="inline-flex items-center gap-1.5 rounded-[6px] px-[12px] py-[6px] text-[12px] font-semibold cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
              style={{ background: "#0F6E56", color: "#FFFFFF" }}
            >
              {savingApproval ? <Loader2 className="h-3 w-3 animate-spin" /> : <CheckCircle2 className="h-3 w-3" />}
              {/* "Validate" e não "Approve": aprovar, nesta operação, é o que
                  acontece na revisão final. Aqui é atestar que o conteúdo do
                  relatório está bom — o passo 4 da revisão. */}
              Validate report
            </button>
          )}
        </div>
      ) : null}
    </div>
  );
}

/** Three tones, so "expired" is never mistaken for the brand orange. */
const VALIDITY_TONE = {
  valid:    { fg: "#0F6E56", bg: "#F0FBF7", border: "#B5E3D1", Icon: ShieldCheck },
  expiring: { fg: "#B45309", bg: "#FFFBEB", border: "#F5DFA8", Icon: CalendarClock },
  expired:  { fg: "#A32D2D", bg: "#FDF3F3", border: "#EFC9C9", Icon: AlertTriangle },
} as const;

/** The one line that matters on a certificate job: until when is this good? */
function ValidityStrip({ validity }: { validity: CertificateValidity }) {
  const tone = VALIDITY_TONE[validity.state];
  return (
    <div
      className="rounded-[8px] px-3 py-[10px] flex items-start gap-2"
      style={{ background: tone.bg, border: `0.5px solid ${tone.border}` }}
    >
      <tone.Icon className="h-4 w-4 shrink-0 mt-[1px]" style={{ color: tone.fg }} />
      <div className="min-w-0">
        <p className="text-[12px] font-semibold" style={{ color: tone.fg }}>
          {expiryHeadline(validity)}
        </p>
        {/* Inline, not flex: a long note wraps around the icon instead of
            stranding it alone on the line above. */}
        <p className="text-[11px]" style={{ color: "#6B6B70" }}>
          {validity.source === "ai" ? (
            <Sparkles
              className="h-3 w-3 inline-block align-[-1.5px] mr-1"
              style={{ color: "#9A9AA0" }}
            />
          ) : null}
          {expirySourceNote(validity)}
        </p>
      </div>
    </div>
  );
}

/**
 * Shown on a certificate report that has no expiry on it yet.
 *
 * New reports get read automatically when they are saved, so this is here for
 * the ones filed before that existed and for a document the model choked on.
 */
function CertificateReadPrompt({
  hasAttachment,
  error,
  reading,
  readOnly,
  onRead,
}: {
  hasAttachment: boolean;
  error:         string | null;
  reading:       boolean;
  readOnly?:     boolean;
  onRead:        () => void;
}) {
  const message = !hasAttachment
    ? "No certificate attached, so there is no expiry date to read."
    : error
      ? `Could not read the expiry date: ${error}`
      : "No expiry date on this certificate yet.";

  return (
    <div
      className="rounded-[8px] px-3 py-[10px] flex flex-wrap items-center justify-between gap-2"
      style={{ background: "#FAFAFB", border: "0.5px solid #E4E4E8" }}
    >
      <p className="text-[11px] min-w-0" style={{ color: "#6B6B70" }}>
        {message}
      </p>
      {hasAttachment && !readOnly ? (
        <button
          type="button"
          onClick={onRead}
          disabled={reading}
          className="inline-flex items-center gap-1.5 shrink-0 rounded-[6px] px-[10px] py-[5px] text-[11px] font-medium cursor-pointer disabled:opacity-40 bg-white hover:bg-[#F1F1F3]"
          style={{ color: "#020040", border: "0.5px solid #D8D8DD" }}
        >
          {reading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <Sparkles className="h-3 w-3" />
          )}
          {reading ? "Reading" : error ? "Try again" : "Read expiry date"}
        </button>
      ) : null}
    </div>
  );
}

/**
 * Miniatura da foto, do tamanho que dá para julgar se está boa.
 *
 * Enquanto a URL assinada não chega, e para PDF, cai no botão de antes: é o
 * mesmo destino, só sem a imagem. Melhor um botão do que um quadrado quebrado.
 */
function ImageButton({
  url,
  label,
  onOpen,
  opening,
  signedUrl,
}: {
  url:        string;
  label:      string;
  onOpen:     (url: string, label: string) => void;
  opening:    boolean;
  signedUrl?: string;
}) {
  const ehPdf = /\.pdf(\?|$)/i.test(url);
  if (signedUrl && !ehPdf) {
    return (
      <button
        type="button"
        onClick={() => onOpen(url, label)}
        className="relative h-[72px] w-[72px] overflow-hidden rounded-[6px] cursor-pointer"
        style={{ border: "0.5px solid #D8D8DD" }}
        aria-label="Expand photo"
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={signedUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
      </button>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(url, label)}
      disabled={opening}
      className="inline-flex items-center gap-1 rounded-[6px] px-[8px] py-[5px] text-[11px] font-medium cursor-pointer disabled:opacity-40"
      style={{ background: "#FAFAFB", color: "#020040", border: "0.5px solid #D8D8DD" }}
      aria-label="Open image"
    >
      {opening ? <Loader2 className="h-3 w-3 animate-spin" /> : <ImageIcon className="h-3 w-3" />}
      {opening ? "Opening" : ehPdf ? "PDF" : "Image"}
    </button>
  );
}

/** A foto em tamanho grande. Clique em qualquer lugar, ou Esc, fecha. */
function Lightbox({ url, onClose }: { url: string; onClose: () => void }) {
  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, [onClose]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      onClick={onClose}
      className="fixed inset-0 z-[70] flex items-center justify-center bg-black/80 p-4 cursor-zoom-out"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={url} alt="" className="max-h-full max-w-full rounded-[8px] object-contain" />
      <button
        type="button"
        onClick={onClose}
        aria-label="Close"
        className="absolute right-4 top-4 rounded-full bg-white/90 px-3 py-1 text-[13px] font-semibold cursor-pointer"
        style={{ color: "#020040" }}
      >
        Close
      </button>
    </div>
  );
}

export interface JobReportV2DownloadButtonProps {
  jobId:    string;
  reference: string;
  /** `jobs.final_report` cru: é ele que diz se este job entrega certificado. */
  rawFinalReport?: unknown;
}

const DOWNLOAD_BTN_CLASS =
  "inline-flex items-center gap-1.5 bg-white rounded-[6px] px-[12px] py-[6px] text-[12px] font-medium hover:bg-[#FAFAFB]";
const DOWNLOAD_BTN_STYLE = { color: "#020040", border: "0.5px solid #D8D8DD" } as const;

/**
 * Job de certificado entrega o CERTIFICADO, não o relatório do Fixfy.
 *
 * O PDF que este botão gerava é o resumo da visita, e para um EICR ele é o
 * documento errado: quem pede um EICR quer o EICR — é ele que o inquilino, o
 * agente e o conselho aceitam. O papel que vale está anexado no relatório
 * final, no bucket privado, então aqui ele é assinado na hora e aberto.
 *
 * Sem anexo o botão não cai de volta no PDF do Fixfy: entregar o documento
 * errado é pior que dizer que ele falta, e a falta é o que o escritório
 * precisa ver para cobrar o parceiro.
 */
export function JobReportV2DownloadButton({ jobId, reference, rawFinalReport }: JobReportV2DownloadButtonProps) {
  const [abrindo, setAbrindo] = useState<number | null>(null);
  const ehCertificado =
    (rawFinalReport as { template?: unknown } | null)?.template === "certificate";
  const anexos = useMemo(
    () => (ehCertificado ? certificateAttachmentUrls(rawFinalReport) : []),
    [ehCertificado, rawFinalReport],
  );

  const abrirCertificado = useCallback(async (rawUrl: string, i: number) => {
    setAbrindo(i);
    try {
      const signed = await createSignedJobReportAssetUrl(rawUrl, 60 * 60);
      if (!signed) {
        toast.error("Could not open the certificate file.");
        return;
      }
      window.open(signed, "_blank", "noopener,noreferrer");
    } finally {
      setAbrindo(null);
    }
  }, []);

  if (ehCertificado) {
    if (anexos.length === 0) {
      return (
        <span
          className="inline-flex items-center gap-1.5 rounded-[6px] px-[12px] py-[6px] text-[12px] font-medium"
          style={{ color: "#9A9AA0", border: "0.5px solid #E4E4E8" }}
          title="The partner has not attached the certificate to the final report yet."
        >
          <AlertTriangle className="h-3 w-3" />
          Certificate not attached
        </span>
      );
    }
    return (
      <>
        {anexos.map((url, i) => (
          <button
            key={url}
            type="button"
            onClick={() => void abrirCertificado(url, i)}
            disabled={abrindo != null}
            className={`${DOWNLOAD_BTN_CLASS} cursor-pointer disabled:opacity-40`}
            style={DOWNLOAD_BTN_STYLE}
          >
            {abrindo === i ? <Loader2 className="h-3 w-3 animate-spin" /> : <ExternalLink className="h-3 w-3" />}
            Certificate{anexos.length > 1 ? ` ${i + 1}` : ""} · {reference}
          </button>
        ))}
      </>
    );
  }

  return (
    <a
      href={`/api/jobs/${jobId}/reports/pdf`}
      target="_blank"
      rel="noopener noreferrer"
      className={DOWNLOAD_BTN_CLASS}
      style={DOWNLOAD_BTN_STYLE}
    >
      <ExternalLink className="h-3 w-3" />
      Download PDF · {reference}
    </a>
  );
}

export default JobReportV2Card;
