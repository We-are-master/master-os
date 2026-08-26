"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { FileText, Info, Loader2, Upload } from "lucide-react";
import { toast } from "sonner";
import { Modal } from "@/components/ui/modal";
import { FixfyModalFooter } from "@/components/ui/fixfy-modal/fixfy-modal-footer";
import {
  fieldsForTemplate,
  isFieldVisible,
  HOUSEKEEP_MAX_FOTOS,
  photoSlotsForTemplate,
  pickReportTemplate,
  reportSectionTitles,
  reportTemplateDisplayLabel,
  type ReportField,
  type ReportPhotoSlot,
  type ReportTemplate,
} from "@/lib/public-report-templates";
import { isPdfFile, prepareUploadFile, splitReportFields } from "@/lib/report-photo-upload";
import { apagarRascunho, lerRascunho, salvarRascunho } from "@/lib/report-draft";
import { validarSubmissaoDeReport } from "@/lib/report-health";
import { plannedPhotoShape } from "@/lib/report-submission";
import { createSignedJobReportAssetUrl } from "@/services/job-reports";

const NAVY = "#020040";
const ORANGE = "#ED4B00";
const BORDER = "#E4E4E8";
const MUTED = "#6B6B70";

interface FillReportModalProps {
  open: boolean;
  onClose: () => void;
  jobId: string;
  jobReference: string;
  jobTitle: string | null;
  /** Optional: jobs carry the trade in the title, quotes carry it separately. */
  serviceType?: string | null;
  /** `YYYY-MM-DD` of the visit — anchors the clock times below. */
  scheduledDate: string | null;
  /** True when the partner already sent the arrival half from the app. */
  startAlreadySubmitted: boolean;
  onSubmitted: () => void;
  /** Edit mode: raw start/final report payloads to prefill and overwrite. */
  existingStart?: Record<string, unknown> | null;
  existingFinal?: Record<string, unknown> | null;
  /** Existing on-site window (ISO) — prefills the clock times on edit. */
  timerStartedAt?: string | null;
  timerEndedAt?: string | null;
}

const ENVELOPE_KEYS = new Set(["template", "submitted_at", "photos", "source", "duration_ms", "chargeable_hours"]);


/** ISO instant → London wall-clock `HH:MM` for a `<input type=time>`. */
function londonHHMM(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(d);
}

function countPhotos(payload: Record<string, unknown> | null | undefined): number {
  const p = payload?.photos;
  if (Array.isArray(p)) return p.filter((u) => typeof u === "string" && u).length;
  if (p && typeof p === "object") {
    return Object.values(p as Record<string, unknown>).reduce<number>(
      (acc, urls) => acc + (Array.isArray(urls) ? urls.filter((u) => typeof u === "string" && u).length : 0),
      0,
    );
  }
  return 0;
}

/**
 * Types a partner's work report from inside the OS.
 *
 * Most partners never open the app: 198 completed jobs produced 16 reports.
 * The office already has the facts — a WhatsApp message, photos, a phone call —
 * and this is where they get typed into the same V2 shape the app writes, so
 * the PDF and Stefane work identically no matter who filled it in.
 */
export function FillReportModal({
  open,
  onClose,
  jobId,
  jobReference,
  jobTitle,
  serviceType = null,
  scheduledDate,
  startAlreadySubmitted,
  onSubmitted,
  existingStart = null,
  existingFinal = null,
  timerStartedAt = null,
  timerEndedAt = null,
}: FillReportModalProps) {
  const isEdit = !!existingFinal;
  const template: ReportTemplate = useMemo(
    () => pickReportTemplate({ serviceType, title: jobTitle }),
    [serviceType, jobTitle],
  );
  const spec = useMemo(() => fieldsForTemplate(template), [template]);
  const photoSlots = useMemo(() => photoSlotsForTemplate(template), [template]);
  const sections = useMemo(() => reportSectionTitles(template), [template]);

  const [data, setData] = useState<Record<string, unknown>>({});
  const [photos, setPhotos] = useState<Record<string, File[]>>({});
  /** Hora em que o rascunho recuperado foi salvo, ou null se não houve rascunho. */
  const [rascunhoDe, setRascunhoDe] = useState<string | null>(null);
  const [visitYmd, setVisitYmd] = useState(scheduledDate ?? "");
  const [startTime, setStartTime] = useState("");
  const [finishTime, setFinishTime] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");
  const [error, setError] = useState<string | null>(null);

  const existingPhotoCount = countPhotos(existingStart) + countPhotos(existingFinal);

  // Edit mode: seed the fields and the clock times from what is on the job.
  // Runs on every open so a stale draft never shadows the saved report.
  useEffect(() => {
    if (!open) return;
    const seeded: Record<string, unknown> = {};
    for (const payload of [existingStart, existingFinal]) {
      if (!payload) continue;
      for (const [k, v] of Object.entries(payload)) {
        if (ENVELOPE_KEYS.has(k) || v === null || v === undefined) continue;
        seeded[k] = v;
      }
    }
    // O rascunho entra por cima do que veio do job: se existe, é porque alguém
    // digitou depois e não conseguiu salvar. O banner diz que foi recuperado e
    // o botão devolve o estado do job, então nada acontece em silêncio.
    const r = lerRascunho(jobId, template);
    setData(r ? { ...seeded, ...r.data } : seeded);
    setPhotos({});
    setVisitYmd(r?.visitYmd || (scheduledDate ?? ""));
    setStartTime(r?.startTime || londonHHMM(timerStartedAt));
    setFinishTime(r?.finishTime || londonHHMM(timerEndedAt));
    setRascunhoDe(
      r
        ? new Date(r.salvoEm).toLocaleString("en-GB", {
            hour: "2-digit",
            minute: "2-digit",
            day: "2-digit",
            month: "short",
          })
        : null,
    );
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reseed only when the modal opens
  }, [open]);

  /**
   * Grava o rascunho a cada mudança, com meio segundo de folga.
   *
   * Sem o atraso seria uma escrita por tecla; com ele, uma por pausa. E o
   * `submitting` corta a gravação porque durante o envio o que vale é o que
   * está indo para o servidor.
   */
  useEffect(() => {
    if (!open || submitting) return;
    const id = setTimeout(
      () => salvarRascunho(jobId, template, { data, visitYmd, startTime, finishTime }),
      500,
    );
    return () => clearTimeout(id);
  }, [open, submitting, data, visitYmd, startTime, finishTime, jobId, template]);

  /**
   * URLs de pré-visualização, uma por arquivo, criadas só quando as fotos mudam.
   *
   * Estavam sendo criadas dentro do render: cada tecla digitada gerava uma URL
   * nova para cada foto e nenhuma era liberada, então a memória subia sem parar
   * e a aba acabava travando no meio do relatório. Era essa a causa da perda de
   * trabalho em 14/08/2026, e o rascunho acima é a rede, não o conserto.
   */
  const previews = useMemo(() => {
    const m = new Map<File, string>();
    for (const lista of Object.values(photos)) {
      for (const f of lista) {
        if (!isPdfFile(f) && !m.has(f)) m.set(f, URL.createObjectURL(f));
      }
    }
    return m;
  }, [photos]);

  useEffect(() => {
    return () => {
      for (const url of previews.values()) URL.revokeObjectURL(url);
    };
  }, [previews]);

  const setField = (key: string, value: unknown) =>
    setData((prev) => ({ ...prev, [key]: value }));

  /** Teto por slot, das duas metades: mesma chave, mesmo teto. */
  const tetoDoSlot = useMemo(() => {
    const m = new Map<string, number>();
    for (const s of [...photoSlots.start, ...photoSlots.final]) {
      if (s.max) m.set(s.key, s.max);
    }
    return m;
  }, [photoSlots]);

  /**
   * Fotos já salvas no relatório, com as URLs — em edição elas ficam, contam e
   * APARECEM. Antes o modal abria com todo bloco em "None added" mesmo com cem
   * fotos salvas, e a leitura natural era que editar tinha apagado tudo: em
   * 25/08 um horário impossível deixou de ser corrigido por esse susto. O
   * servidor nunca apagou nada (mergeReportPhotos só acrescenta); o que faltava
   * era a tela dizer isso com as próprias fotos.
   */
  const fotosSalvas = useMemo(() => {
    const clean = (v: unknown): string[] =>
      Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.trim().length > 0) : [];
    const porSlot = { start: new Map<string, string[]>(), final: new Map<string, string[]>() };
    // Envelope plano (trade): a metade tem um bloco só, sem chave de slot.
    const soltas = { start: [] as string[], final: [] as string[] };
    for (const metade of ["start", "final"] as const) {
      const p = (metade === "start" ? existingStart : existingFinal)?.photos;
      if (Array.isArray(p)) {
        soltas[metade] = clean(p);
      } else if (p && typeof p === "object") {
        for (const [k, v] of Object.entries(p as Record<string, unknown>)) {
          const urls = clean(v);
          if (urls.length) porSlot[metade].set(k, urls);
        }
      }
    }
    return { porSlot, soltas };
  }, [existingStart, existingFinal]);

  /**
   * URL assinada por foto salva: o bucket é privado, e a URL crua rende só o
   * quadrado quebrado (visto em 26/08, na primeira vez que elas apareceram).
   * Mesmo signer do card do relatório, uma hora de validade — mais que a vida
   * de um modal aberto.
   */
  const [assinadas, setAssinadas] = useState<Record<string, string>>({});
  useEffect(() => {
    if (!open) return;
    let vivo = true;
    const todas = [
      ...fotosSalvas.soltas.start,
      ...fotosSalvas.soltas.final,
      ...[...fotosSalvas.porSlot.start.values()].flat(),
      ...[...fotosSalvas.porSlot.final.values()].flat(),
    ];
    const faltando = [...new Set(todas)].filter((u) => !assinadas[u]);
    if (!faltando.length) return;
    void Promise.all(
      faltando.map(async (u) => [u, await createSignedJobReportAssetUrl(u, 60 * 60)] as const),
    ).then((pares) => {
      if (!vivo) return;
      setAssinadas((prev) => {
        const out = { ...prev };
        for (const [u, s] of pares) if (s) out[u] = s;
        return out;
      });
    });
    return () => {
      vivo = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- assina quando abre ou as salvas mudam
  }, [open, fotosSalvas]);

  /** Quantas já existem por slot, nas duas metades — para o teto de upload. */
  const existentesPorSlot = useMemo(() => {
    const m = new Map<string, number>();
    for (const metade of ["start", "final"] as const) {
      for (const [k, urls] of fotosSalvas.porSlot[metade]) {
        m.set(k, Math.max(m.get(k) ?? 0, urls.length));
      }
    }
    return m;
  }, [fotosSalvas]);

  const onPhotosChange = (slot: string, files: FileList | null) => {
    if (!files) return;
    const novos = Array.from(files);
    const teto = tetoDoSlot.get(slot);
    setPhotos((prev) => {
      const atuais = prev[slot] ?? [];
      // O teto bloqueia NA ENTRADA: aceitar 9 e cortar 4 no envio é como o
      // excedente sumia em silêncio. Aqui a pessoa escolhe quais ficam.
      const vaga = teto ? Math.max(0, teto - (existentesPorSlot.get(slot) ?? 0) - atuais.length) : novos.length;
      if (novos.length > vaga) {
        toast.warning(`Maximum ${teto} photos in this block — ${novos.length - vaga} file(s) not added.`);
      }
      return { ...prev, [slot]: [...atuais, ...novos.slice(0, vaga)] };
    });
  };

  const removePhoto = (slot: string, idx: number) =>
    setPhotos((prev) => ({ ...prev, [slot]: (prev[slot] ?? []).filter((_, i) => i !== idx) }));

  /** Minutes on site from the two clock times — what Housekeep asks for. */
  const durationMinutes = useMemo(() => {
    if (!/^\d{1,2}:\d{2}$/.test(startTime) || !/^\d{1,2}:\d{2}$/.test(finishTime)) return null;
    const [sh, sm] = startTime.split(":").map(Number);
    const [fh, fm] = finishTime.split(":").map(Number);
    const mins = fh * 60 + fm - (sh * 60 + sm);
    return mins > 0 ? mins : null;
  }, [startTime, finishTime]);

  const timesInvalid =
    startTime !== "" && finishTime !== "" && durationMinutes === null;

  const inputClass =
    "w-full rounded-[6px] border px-3 py-2 text-[13px] text-[#020040] placeholder:text-[#9A9AAE] focus:outline-none focus:ring-2 focus:ring-[#ED4B00]/20 focus:border-[#ED4B00]";

  const renderField = (f: ReportField) => {
    if (!isFieldVisible(f, data)) return null;
    const val = data[f.key];
    const label = (
      <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
        {f.label}
      </label>
    );
    const hint = f.hint ? (
      <p className="text-[11px] leading-snug" style={{ color: MUTED }}>{f.hint}</p>
    ) : null;

    switch (f.type) {
      case "boolean":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            <div className="flex gap-2">
              {[true, false].map((b) => (
                <button
                  key={String(b)}
                  type="button"
                  onClick={() => setField(f.key, b)}
                  className="min-w-[4rem] rounded-[6px] border px-3 py-1.5 text-[12px] font-semibold cursor-pointer transition-colors"
                  style={
                    val === b
                      ? { background: NAVY, color: "#fff", borderColor: NAVY }
                      : { background: "#fff", color: NAVY, borderColor: BORDER }
                  }
                >
                  {b ? "Yes" : "No"}
                </button>
              ))}
            </div>
          </div>
        );
      case "number":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            <input
              type="number"
              min={0}
              value={typeof val === "number" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value === "" ? null : Number(e.target.value))}
              className={inputClass}
              style={{ borderColor: BORDER }}
            />
          </div>
        );
      case "select":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            <select
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className={`${inputClass} bg-white`}
              style={{ borderColor: BORDER }}
            >
              <option value="">Select…</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        );
      case "longtext":
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            {hint}
            <textarea
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              rows={3}
              className={inputClass}
              style={{ borderColor: BORDER }}
            />
          </div>
        );
      default:
        return (
          <div key={f.key} className="space-y-1.5">
            {label}
            {hint}
            <input
              type="text"
              value={typeof val === "string" ? val : ""}
              onChange={(e) => setField(f.key, e.target.value || null)}
              className={inputClass}
              style={{ borderColor: BORDER }}
            />
          </div>
        );
    }
  };

  /**
   * Miniatura de foto que JÁ ESTÁ no relatório: com selo, sem X.
   *
   * Remover não existe do lado do servidor (a edição só acrescenta), então um
   * X aqui seria promessa falsa. O selo responde a pergunta que o modal vazio
   * fazia nascer: "cadê as fotos que o parceiro mandou?".
   */
  const renderSavedThumb = (url: string, i: number) => {
    const assinada = assinadas[url];
    return (
      <div key={`saved-${i}`} className="relative" title="Already on the report · kept when you save">
        {/\.pdf(\?|$)/i.test(url) || !assinada ? (
          // PDF, ou a assinatura ainda não chegou: um tile calmo em vez do
          // quadrado de imagem quebrada.
          <div
            className="flex h-16 flex-col items-center justify-center rounded-[6px] border bg-[#FAFAFB] p-1.5"
            style={{ borderColor: BORDER }}
          >
            <FileText className="h-4 w-4" style={{ color: NAVY }} />
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={assinada}
            alt=""
            loading="lazy"
            className="h-16 w-full rounded-[6px] border object-cover"
            style={{ borderColor: BORDER }}
          />
        )}
        <span className="absolute bottom-0.5 right-0.5 rounded-[4px] bg-black/55 px-1 text-[8px] font-semibold text-white">
          saved
        </span>
      </div>
    );
  };

  const renderThumb = (slot: string, f: File, i: number) => {
    if (isPdfFile(f)) {
      return (
        <div
          key={`${slot}-${i}`}
          className="relative flex h-16 flex-col items-center justify-center rounded-[6px] border bg-[#FAFAFB] p-1.5"
          style={{ borderColor: BORDER }}
        >
          <FileText className="h-4 w-4" style={{ color: NAVY }} />
          <p className="mt-0.5 max-w-full truncate text-[9px]" style={{ color: MUTED }}>{f.name}</p>
          <button
            type="button"
            onClick={() => removePhoto(slot, i)}
            className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white cursor-pointer"
            aria-label="Remove file"
          >
            ×
          </button>
        </div>
      );
    }
    return (
      <div key={`${slot}-${i}`} className="relative">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={previews.get(f)}
          alt=""
          className="h-16 w-full rounded-[6px] border object-cover"
          style={{ borderColor: BORDER }}
        />
        <button
          type="button"
          onClick={() => removePhoto(slot, i)}
          className="absolute right-0.5 top-0.5 flex h-4 w-4 items-center justify-center rounded-full bg-black/60 text-[10px] text-white cursor-pointer"
          aria-label="Remove photo"
        >
          ×
        </button>
      </div>
    );
  };

  /**
   * Quantas fotos esta metade do relatório já tem, contando as que o parceiro
   * mandou antes.
   *
   * A conta é por metade e não por cômodo porque é assim que chega do outro
   * lado: o formulário da Housekeep tem dois blocos de arquivo, um de chegada e
   * um de conclusão, e os sete cômodos daqui são achatados nesses dois.
   */
  const contarMetade = (metade: "start" | "final") => {
    const doSlot = photoSlots[metade].reduce((n, s) => n + (photos[s.key]?.length ?? 0), 0);
    return doSlot + countPhotos(metade === "start" ? existingStart : existingFinal);
  };

  /**
   * O portão da plataforma, rodando AO VIVO enquanto se digita.
   *
   * É a mesma régua que o servidor aplica na submissão (validarSubmissaoDeReport),
   * com as mesmas contagens planejadas: o botão só libera quando o servidor vai
   * aceitar, e a lista embaixo diz o que falta enquanto ainda dá pra resolver.
   */
  const veredito = useMemo(() => {
    const { finalFields } = splitReportFields(spec, data);
    const metadeIntocada = startAlreadySubmitted && !isEdit;
    return validarSubmissaoDeReport({
      template,
      finalData: finalFields,
      startPhotos: metadeIntocada
        ? ["kept"] // a metade do app fica como está; o servidor confere a real
        : plannedPhotoShape(template, "start", photos, isEdit ? existingStart?.photos : null),
      finalPhotos: plannedPhotoShape(template, "final", photos, isEdit ? existingFinal?.photos : null),
      // Teto não cobra o que o parceiro já salvou: só o que se adiciona aqui.
      fotosJaSalvas: { start: existingStart?.photos ?? null, final: existingFinal?.photos ?? null },
      // Só a presença importa aqui: o item de horários não bloqueia.
      timerStartedAt: startTime ? "typed" : timerStartedAt,
      timerEndedAt: finishTime ? "typed" : timerEndedAt,
    });
  }, [spec, data, template, photos, isEdit, startAlreadySubmitted, existingStart, existingFinal, startTime, finishTime, timerStartedAt, timerEndedAt]);

  /**
   * A regra da Housekeep, dita na tela e com a contagem do momento.
   *
   * Sem foto o envio é recusado, e o motivo só aparecia depois, na aba, quando
   * quem digitou já tinha ido embora. Acima de 20 a Stefane corta o excesso,
   * então avisar antes é a diferença entre escolher quais 20 e descobrir depois
   * que sumiram.
   */
  const avisoDeFotos = (metade: "start" | "final") => {
    // Só faz sentido no formulário de trade, que tem um bloco de arquivo por
    // metade. No de limpeza cada cômodo tem o seu, e a conta que interessa
    // aparece em cada rótulo.
    if (photoSlots[metade].some((s) => s.max)) return null;
    const n = contarMetade(metade);
    if (n > 0 && n <= HOUSEKEEP_MAX_FOTOS) return null;
    return (
      <p className="flex items-center gap-1.5 text-[10.5px]" style={{ color: ORANGE }}>
        <Info className="h-3 w-3 shrink-0" />
        {n === 0
          ? "The client platform needs at least one photo here, or the report cannot be sent."
          : `${n} photos · the client platform takes ${HOUSEKEEP_MAX_FOTOS}, the rest will not be sent.`}
      </p>
    );
  };

  /** "(min 5 · max 20)" no rótulo, e a contagem em laranja enquanto não fecha. */
  const contadorDoSlot = (slot: ReportPhotoSlot, salvas: number) => {
    if (!slot.min && !slot.max) return null;
    // As salvas contam: com vinte fotos do parceiro no bloco, "min 5" em
    // laranja dizia que estava vazio, e vazio aqui se lê como apagado.
    const n = (photos[slot.key]?.length ?? 0) + salvas;
    const faltando = slot.min ? n < slot.min : false;
    const excedeu = slot.max ? n > slot.max : false;
    return (
      <span
        className="ml-1.5 text-[10px] font-normal"
        style={{ color: faltando || excedeu ? ORANGE : MUTED }}
        title={
          excedeu
            ? `The client platform takes ${slot.max} photos per block. The extras will not be sent.`
            : `We ask for at least ${slot.min}: one photo cannot show everything the client platform wants to see here.`
        }
      >
        {n > 0 ? `${n} · ` : ""}
        {slot.min ? `min ${slot.min}` : "optional"}
        {slot.max ? ` max ${slot.max}` : ""}
      </span>
    );
  };

  const renderPhotoSlot = (metade: "start" | "final", slot: ReportPhotoSlot) => {
    const files = photos[slot.key] ?? [];
    const salvas = fotosSalvas.porSlot[metade].get(slot.key) ?? [];
    return (
      <div key={slot.key} className="space-y-1.5">
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <label className="text-[12px] font-semibold" style={{ color: NAVY }}>
              {slot.label}
              {contadorDoSlot(slot, salvas.length)}
            </label>
            {/* O que a Housekeep quer ver nesta foto, com as palavras deles. */}
            {slot.hint ? (
              <p className="mt-0.5 text-[10.5px] leading-snug" style={{ color: MUTED }}>{slot.hint}</p>
            ) : null}
          </div>
          <label
            className="inline-flex shrink-0 cursor-pointer items-center gap-1 text-[11px] font-semibold"
            style={{ color: ORANGE }}
          >
            <Upload className="h-3 w-3" />
            Add files
            <input
              type="file"
              accept={slot.accept ?? "image/*"}
              multiple
              className="sr-only"
              onChange={(e) => onPhotosChange(slot.key, e.target.files)}
            />
          </label>
        </div>
        {salvas.length > 0 || files.length > 0 ? (
          <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">
            {salvas.map(renderSavedThumb)}
            {files.map((f, i) => renderThumb(slot.key, f, i))}
          </div>
        ) : (
          <p className="text-[11px]" style={{ color: MUTED }}>None added</p>
        )}
      </div>
    );
  };

  /**
   * O envelope plano (trade) não tem slot para ancorar as salvas, então elas
   * entram numa faixa própria no topo do bloco de fotos da metade.
   */
  const faixaDeSalvas = (metade: "start" | "final") => {
    const urls = fotosSalvas.soltas[metade];
    if (!urls.length) return null;
    return (
      <div className="space-y-1.5">
        <p className="text-[11px] font-semibold" style={{ color: NAVY }}>
          {urls.length} photo(s) already on the report · they stay when you save
        </p>
        <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-6">{urls.map(renderSavedThumb)}</div>
      </div>
    );
  };

  const section = (title: string, children: ReactNode) => (
    <section
      className="space-y-3 rounded-[10px] p-3 sm:p-[14px]"
      style={{ background: "#FAFAFB", border: `0.5px solid ${BORDER}` }}
    >
      <h3 className="text-[10px] font-bold uppercase" style={{ color: ORANGE, letterSpacing: "0.6px" }}>
        {title}
      </h3>
      {children}
    </section>
  );

  const submit = async () => {
    setError(null);
    if (timesInvalid) {
      setError("Finish time must be after the start time.");
      return;
    }

    const { startFields, finalFields } = splitReportFields(spec, data);
    if (durationMinutes !== null) {
      finalFields.duration_ms = durationMinutes * 60_000;
      if (template === "gardener") finalFields.chargeable_hours = durationMinutes / 60;
    }

    const form = new FormData();
    form.set("template", template);
    form.set("startData", JSON.stringify(startFields));
    form.set("finalData", JSON.stringify(finalFields));
    if (isEdit) form.set("overwrite", "1");
    if (visitYmd) form.set("visitYmd", visitYmd);
    if (startTime) form.set("startTime", startTime);
    if (finishTime) form.set("finishTime", finishTime);

    setSubmitting(true);
    setProgress("Processing files…");
    try {
      for (const [slot, slotFiles] of Object.entries(photos)) {
        for (let i = 0; i < slotFiles.length; i++) {
          form.append(`photos[${slot}][]`, await prepareUploadFile(slotFiles[i], slot, i));
        }
      }
      setProgress("Saving report…");
      const res = await fetch(`/api/jobs/${jobId}/office-report`, { method: "POST", body: form });
      const body = (await res.json().catch(() => null)) as
        | { error?: string; photoFailures?: number; pendencias?: string[]; nota?: number }
        | null;
      if (!res.ok) {
        // 422 = o portão da plataforma: a lista diz o que falta, não só "não deu".
        setError(
          body?.pendencias?.length
            ? `${body.error ?? "The report is missing what the client platform requires."}\n— ${body.pendencias.join("\n— ")}`
            : body?.error ?? "Could not save the report.",
        );
        return;
      }
      const daNota = typeof body?.nota === "number" ? ` · score ${body.nota}` : "";
      if (body?.photoFailures) {
        toast.warning(`Report saved, but ${body.photoFailures} file(s) failed to upload.`);
      } else {
        toast.success(isEdit ? `Report updated${daNota}.` : `Report saved on the job${daNota}.`);
      }
      // O relatório está no servidor: o rascunho perdeu a razão de existir e
      // ficaria reaparecendo na próxima abertura como se fosse trabalho novo.
      apagarRascunho(jobId);
      setRascunhoDe(null);
      onSubmitted();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unexpected error saving the report.");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  return (
    <Modal
      open={open}
      onClose={submitting ? () => {} : onClose}
      title={isEdit ? "Edit partner report" : "Fill report for the partner"}
      subtitle={`${jobReference} · ${reportTemplateDisplayLabel(template)} template`}
      size="lg"
      footer={
        <FixfyModalFooter
          leading={
            // Escondido no celular: a 375px é esta frase que espremia os dois
            // botões contra a borda.
            <span className="hidden sm:block">
              {isEdit
                ? existingPhotoCount > 0
                  ? `Fields are replaced · the ${existingPhotoCount} photo(s) already saved stay, new files are added.`
                  : "Fields are replaced · new files are added to the report."
                : "Saved as an office-typed report and marked validated."}
            </span>
          }
        >
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="shrink-0 rounded-[6px] bg-white px-[14px] py-[7px] text-[12px] font-medium cursor-pointer disabled:opacity-40"
            style={{ color: NAVY, border: `0.5px solid #D8D8DD` }}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !veredito.ok}
            title={veredito.ok ? undefined : veredito.motivos.join(" · ")}
            className="inline-flex shrink-0 items-center gap-1.5 rounded-[6px] px-[14px] py-[7px] text-[12px] font-semibold text-white cursor-pointer disabled:opacity-40"
            style={{ background: NAVY }}
          >
            {submitting ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
            {submitting ? progress || "Saving…" : isEdit ? "Save changes" : "Save report"}
          </button>
        </FixfyModalFooter>
      }
    >
      {/* O `Modal` não injeta padding no corpo: cada modal traz o seu, e a
          falta dele era o conteúdo colado na borda. */}
      <div className="space-y-3 p-4 sm:p-5">
        {rascunhoDe ? (
          <div
            className="flex flex-col gap-2 rounded-[8px] px-3 py-2 text-[11px] sm:flex-row sm:items-center sm:justify-between"
            style={{ background: "#FFF6F0", border: `0.5px solid ${ORANGE}`, color: NAVY }}
          >
            <span>
              <strong>Recovered what you had typed</strong> from {rascunhoDe}. Photos are not
              kept, so add those again.
            </span>
            <button
              type="button"
              onClick={() => {
                apagarRascunho(jobId);
                setRascunhoDe(null);
                setData({});
                setVisitYmd(scheduledDate ?? "");
                setStartTime(londonHHMM(timerStartedAt));
                setFinishTime(londonHHMM(timerEndedAt));
              }}
              className="shrink-0 cursor-pointer underline"
              style={{ color: ORANGE }}
            >
              Start blank
            </button>
          </div>
        ) : null}
        {startAlreadySubmitted ? (
          <div
            className="rounded-[8px] px-3 py-2 text-[11px]"
            style={{ background: "#F4F5FB", border: "0.5px solid #D8DBEE", color: NAVY }}
          >
            The partner already sent the arrival half from the app. Only the completion
            report below will be written.
          </div>
        ) : null}

        {section(
          "On site",
          <>
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
                  Visit date
                </label>
                <input
                  type="date"
                  value={visitYmd}
                  onChange={(e) => setVisitYmd(e.target.value)}
                  className={`${inputClass} bg-white`}
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
                  Start time
                </label>
                <input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  className={`${inputClass} bg-white`}
                  style={{ borderColor: BORDER }}
                />
              </div>
              <div className="space-y-1.5">
                <label className="block text-[12px] font-semibold" style={{ color: NAVY }}>
                  Finish time
                </label>
                <input
                  type="time"
                  value={finishTime}
                  onChange={(e) => setFinishTime(e.target.value)}
                  className={`${inputClass} bg-white`}
                  style={{ borderColor: BORDER }}
                />
              </div>
            </div>
            <p className="text-[11px]" style={{ color: timesInvalid ? ORANGE : MUTED }}>
              {timesInvalid
                ? "Finish time must be after the start time."
                : durationMinutes !== null
                  ? `${Math.floor(durationMinutes / 60)}h ${durationMinutes % 60}m on site · London time, sent to the client platform.`
                  : "London time. These become the start and finish times on the client platform."}
            </p>
          </>,
        )}

        {!startAlreadySubmitted && (spec.start.length > 0 || photoSlots.start.length > 0)
          ? section(
              sections.start,
              <>
                <div className="space-y-3">{spec.start.map(renderField)}</div>
                {photoSlots.start.length > 0 ? (
                  <div className="space-y-2 border-t pt-3" style={{ borderColor: BORDER }}>
                    {avisoDeFotos("start")}
                    {faixaDeSalvas("start")}
                    {photoSlots.start.map((s) => renderPhotoSlot("start", s))}
                  </div>
                ) : null}
              </>,
            )
          : null}

        {section(
          sections.final,
          <>
            <div className="space-y-3">{spec.final.map(renderField)}</div>
            {photoSlots.final.length > 0 ? (
              <div className="space-y-2 border-t pt-3" style={{ borderColor: BORDER }}>
                {avisoDeFotos("final")}
                {faixaDeSalvas("final")}
                {photoSlots.final.map((s) => renderPhotoSlot("final", s))}
              </div>
            ) : null}
          </>,
        )}

        {!veredito.ok ? (
          <div
            className="rounded-[8px] p-2.5 text-[12px]"
            style={{ background: "#FFF8F3", border: "0.5px solid #F5CFB8", color: "#7A3D00" }}
          >
            <p className="font-semibold">The client platform requires, before this can be saved:</p>
            <ul className="mt-1 space-y-0.5">
              {veredito.motivos.map((m) => (
                <li key={m}>— {m}</li>
              ))}
            </ul>
          </div>
        ) : null}
        {error ? (
          <div
            className="rounded-[8px] p-2.5 text-[12px] whitespace-pre-wrap"
            style={{ background: "#FFF1EB", border: "0.5px solid #F5CFB8", color: "#7A3D00" }}
          >
            {error}
          </div>
        ) : null}
      </div>
    </Modal>
  );
}

export default FillReportModal;
