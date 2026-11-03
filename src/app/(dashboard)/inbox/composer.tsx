"use client";

/**
 * O campo de escrever da /inbox, no jeito do composer do VOS: texto (Enter
 * manda), anexo (foto, vídeo, PDF) com legenda, áudio gravado que chega como
 * mensagem de voz, e respostas rápidas. Arquivo vai em multipart para
 * /api/inbox/send; o limite é 4 MB (o corpo da Vercel corta em 4,5).
 */

import { useEffect, useRef, useState } from "react";
import { FileText, Loader2, MessageSquare, Mic, Paperclip, Send, Smile, Square, Trash2, X, Zap } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Acao } from "./ui";
import type { TipoDeContato } from "./tipos";

const LIMITE_BYTES = 4 * 1024 * 1024;
const EMOJIS = ["👍", "🙏", "😊", "👌", "✅", "🙂", "😀", "👏", "🔧", "🏠", "📸", "📍", "⏰", "🚗", "💷", "❤️", "🎉", "😅", "🤝", "👋"];

function Icone({ icone: I, titulo, onClick, ativo, disabled }: { icone: typeof Smile; titulo: string; onClick: () => void; ativo?: boolean; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={titulo}
      aria-label={titulo}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 w-8 items-center justify-center rounded-lg text-text-secondary transition-colors hover:bg-surface-tertiary hover:text-text-primary disabled:opacity-50",
        ativo && "bg-surface-tertiary text-text-primary",
      )}
    >
      <I className="h-[18px] w-[18px]" />
    </button>
  );
}

const RAPIDAS: Record<TipoDeContato, string[]> = {
  parceiro: [
    "Hi {nome}, are you still on track for today?",
    "Thanks {nome}. Please send photos of the finished work in the app.",
    "Can you share your ETA, please?",
    "The client has confirmed access. All good to go.",
  ],
  cliente: [
    "Hi {nome}, thanks for your message. Let me check and come back to you shortly.",
    "Our partner is on the way. We will keep you posted.",
    "Could you send a couple of photos of the area, please?",
    "All done on our side. Is there anything else we can help with?",
  ],
  outro: [
    "Hi {nome}, thanks for your message. How can we help?",
    "Could you share the property address and postcode, please?",
  ],
};

async function postarJson(corpo: Record<string, unknown>) {
  const res = await fetch("/api/inbox/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
}

async function postarArquivo(contato: string, arquivo: File, texto: string, tipo?: "ptt") {
  const form = new FormData();
  form.set("contato", contato);
  form.set("arquivo", arquivo);
  if (texto) form.set("texto", texto);
  if (tipo) form.set("tipo", tipo);
  const res = await fetch("/api/inbox/send", { method: "POST", body: form });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `Failed (${res.status})`);
}

/** O formato que o navegador grava e o WhatsApp aceita como voz (ogg/opus primeiro). */
function formatoDeVoz(): string {
  const opcoes = ["audio/ogg;codecs=opus", "audio/webm;codecs=opus", "audio/mp4", "audio/webm"];
  return opcoes.find((t) => typeof MediaRecorder !== "undefined" && MediaRecorder.isTypeSupported(t)) ?? "";
}

const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

export function Composer({
  contato,
  nome,
  tipo,
  canal,
  janelaAberta,
  semJanela,
  onEnviado,
}: {
  contato: string;
  nome: string;
  tipo: TipoDeContato;
  canal: string;
  janelaAberta: boolean;
  semJanela: boolean;
  onEnviado: () => void;
}) {
  const [texto, setTexto] = useState("");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [rapidas, setRapidas] = useState(false);
  const [emojis, setEmojis] = useState(false);
  const [gravando, setGravando] = useState(false);
  const [segundos, setSegundos] = useState(0);
  const [assunto, setAssunto] = useState("");
  const gravador = useRef<MediaRecorder | null>(null);
  const pedacos = useRef<Blob[]>([]);
  const descartar = useRef(false);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const primeiro = nome.startsWith("+") ? "there" : nome.split(" ")[0];

  // Trocou de conversa: rascunho, anexo e gravação não passam para a outra.
  useEffect(() => {
    setTexto("");
    setArquivo(null);
    setRapidas(false);
    if (gravador.current?.state === "recording") {
      descartar.current = true;
      gravador.current.stop();
    }
  }, [contato]);

  useEffect(() => {
    if (!gravando) return;
    const t = setInterval(() => setSegundos((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [gravando]);

  useEffect(() => {
    if (!rapidas && !emojis) return;
    const fechar = () => {
      setRapidas(false);
      setEmojis(false);
    };
    document.addEventListener("click", fechar);
    return () => document.removeEventListener("click", fechar);
  }, [rapidas, emojis]);

  async function mandar() {
    if (enviando) return;
    if (!arquivo && !texto.trim()) return;
    setEnviando(true);
    try {
      if (arquivo) await postarArquivo(contato, arquivo, texto.trim());
      else await postarJson({ contato, texto: texto.trim() });
      setTexto("");
      setArquivo(null);
      onEnviado();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not send");
    } finally {
      setEnviando(false);
    }
  }

  function escolher(f: File | undefined) {
    if (!f) return;
    if (f.size > LIMITE_BYTES) {
      toast.error("File is over 4 MB. Send it from the phone app.");
      return;
    }
    setArquivo(f);
  }

  async function gravar() {
    const formato = formatoDeVoz();
    if (!navigator.mediaDevices?.getUserMedia || !formato) {
      toast.error("This browser cannot record audio");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream, { mimeType: formato });
      pedacos.current = [];
      descartar.current = false;
      rec.ondataavailable = (e) => e.data.size && pedacos.current.push(e.data);
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setGravando(false);
        if (descartar.current || !pedacos.current.length) return;
        const ext = formato.includes("ogg") ? "ogg" : formato.includes("mp4") ? "m4a" : "webm";
        const voz = new File(pedacos.current, `voice-${Date.now()}.${ext}`, { type: formato.split(";")[0] });
        setEnviando(true);
        try {
          await postarArquivo(contato, voz, "", "ptt");
          onEnviado();
        } catch (e) {
          toast.error(e instanceof Error ? e.message : "Could not send the voice note");
        } finally {
          setEnviando(false);
        }
      };
      rec.start();
      gravador.current = rec;
      setSegundos(0);
      setGravando(true);
    } catch {
      toast.error("Microphone blocked. Allow it in the browser.");
    }
  }

  function parar(enviar: boolean) {
    descartar.current = !enviar;
    gravador.current?.stop();
  }

  if (!janelaAberta && !semJanela) {
    return (
      <div className="mx-4 mb-3 space-y-2 rounded-xl border border-border-light bg-card px-3 py-2.5">
        <p className="text-xs text-text-tertiary">WhatsApp only allows an approved template until {primeiro} writes back.</p>
        <Acao
          icone={FileText}
          disabled={enviando}
          onClick={async () => {
            setEnviando(true);
            try {
              await postarJson({ contato, template: "no_response_followup", params: [primeiro] });
              toast.success("Template sent");
              onEnviado();
            } catch (e) {
              toast.error(e instanceof Error ? e.message : "Could not send");
            } finally {
              setEnviando(false);
            }
          }}
        >
          No response follow-up
        </Acao>
        <form
          className="flex gap-2"
          onSubmit={async (e) => {
            e.preventDefault();
            if (!assunto.trim()) return;
            setEnviando(true);
            try {
              await postarJson({ contato, template: "conversation_follow_up", params: [primeiro, assunto.trim()] });
              setAssunto("");
              toast.success("Template sent");
              onEnviado();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not send");
            } finally {
              setEnviando(false);
            }
          }}
        >
          <input
            className="h-8 flex-1 rounded-lg border border-border-light bg-card px-3 text-[12px] text-text-primary placeholder:text-text-tertiary"
            placeholder="Follow up regarding JOB-9812 tomorrow at 10:00"
            value={assunto}
            onChange={(e) => setAssunto(e.target.value)}
          />
          <Acao icone={Send} disabled={!assunto.trim() || enviando}>
            Send follow-up
          </Acao>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-4 mb-3 rounded-xl border border-border-light bg-card shadow-[0_1px_0_rgba(10,10,31,0.04)]">
      <div className="flex items-center gap-1.5 border-b border-border-light px-3 py-1.5 text-xs text-text-secondary">
        <MessageSquare className="h-3.5 w-3.5 text-emerald-600" />
        <span className="font-medium text-text-primary">{canal}</span>
      </div>

      {arquivo ? (
        <div className="mx-3 mt-2 flex items-center gap-2 rounded-lg border border-border-light bg-surface-secondary/60 px-2.5 py-1.5 text-xs">
          <Paperclip className="h-3.5 w-3.5 text-text-tertiary" />
          <span className="min-w-0 flex-1 truncate text-text-primary">{arquivo.name}</span>
          <span className="text-text-tertiary">{Math.max(1, Math.round(arquivo.size / 1024))} KB</span>
          <button type="button" onClick={() => setArquivo(null)} className="text-text-tertiary hover:text-text-primary" aria-label="Remove file">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {gravando ? (
        <div className="flex items-center gap-3 px-3 py-3">
          <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-red-500" />
          <span className="text-[13px] font-medium tabular-nums text-text-primary">Recording {mmss(segundos)}</span>
          <span className="flex-1" />
          <Acao icone={Trash2} variante="fantasma" onClick={() => parar(false)}>
            Discard
          </Acao>
          <Acao icone={Square} variante="primario" onClick={() => parar(true)}>
            Stop and send
          </Acao>
        </div>
      ) : (
        <textarea
          className="block min-h-[52px] w-full resize-none bg-transparent px-3 py-2 text-[13px] text-text-primary outline-none placeholder:text-text-tertiary"
          placeholder={arquivo ? "Add a caption" : `Message ${primeiro}`}
          value={texto}
          rows={2}
          onChange={(e) => setTexto(e.target.value)}
          onPaste={(e) => escolher(e.clipboardData.files?.[0])}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void mandar();
            }
          }}
        />
      )}

      {gravando ? null : (
        <div className="relative flex items-center gap-1 px-2 pb-2">
          <input
            ref={inputArquivo}
            type="file"
            className="hidden"
            accept="image/*,video/*,application/pdf,.doc,.docx,.xls,.xlsx"
            onChange={(e) => {
              escolher(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <span className="flex items-center gap-0.5" onClick={(e) => e.stopPropagation()}>
            <Icone icone={Smile} titulo="Emoji" ativo={emojis} onClick={() => { setEmojis((v) => !v); setRapidas(false); }} />
            <Icone icone={Paperclip} titulo="Attach photo, video or document" onClick={() => inputArquivo.current?.click()} />
            <Icone icone={Zap} titulo="Quick replies" ativo={rapidas} onClick={() => { setRapidas((v) => !v); setEmojis(false); }} />
            <Icone icone={Mic} titulo="Record a voice note" onClick={() => void gravar()} disabled={enviando} />
          </span>
          {emojis ? (
            <div className="absolute bottom-10 left-2 z-20 grid w-[264px] grid-cols-8 gap-0.5 rounded-xl border border-border-light bg-card p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
              {EMOJIS.map((em) => (
                <button key={em} type="button" className="rounded-md p-1 text-lg hover:bg-surface-secondary" onClick={() => setTexto((t) => t + em)}>
                  {em}
                </button>
              ))}
            </div>
          ) : null}
          {rapidas ? (
            <div className="absolute bottom-10 left-2 z-20 w-[380px] rounded-xl border border-border-light bg-card p-1.5 shadow-lg" onClick={(e) => e.stopPropagation()}>
              {RAPIDAS[tipo].map((r) => (
                <button
                  key={r}
                  type="button"
                  className="block w-full rounded-lg px-2.5 py-2 text-left text-[12.5px] text-text-primary hover:bg-surface-secondary"
                  onClick={() => {
                    setTexto(r.replace("{nome}", primeiro));
                    setRapidas(false);
                  }}
                >
                  {r.replace("{nome}", primeiro)}
                </button>
              ))}
            </div>
          ) : null}
          <span className="flex-1" />
          <span className="hidden text-[11px] text-text-tertiary xl:inline">Enter sends · Shift+Enter new line</span>
          <button
            type="button"
            onClick={() => void mandar()}
            disabled={enviando || (!texto.trim() && !arquivo)}
            aria-label="Send"
            title="Send"
            className="ml-2 flex h-9 w-9 items-center justify-center rounded-lg bg-primary text-[var(--on-brand)] hover:bg-primary-hover disabled:opacity-50"
          >
            {enviando ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </button>
        </div>
      )}
    </div>
  );
}
