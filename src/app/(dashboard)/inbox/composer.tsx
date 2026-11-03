"use client";

/**
 * O campo de escrever da /inbox, o composer do Atendimento do VOS trazido
 * inteiro: rótulo do canal em cima, a faixa de gravação que cola no campo
 * (clicar grava de mãos livres, segurar grava e soltar envia, arrastar cancela
 * ou trava, pausar dá a prévia), campo que cresce até 160 px, "/" abre as
 * mensagens salvas, teclado de emoji com busca, anexo e colar print.
 *
 * Arquivo e voz vão em multipart para /api/inbox/send (voz como ptt); o limite
 * é 4 MB porque o corpo da Vercel corta em 4,5.
 */

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { FileText, MessageSquareQuote, Paperclip, Send, Smile, X } from "lucide-react";
import { toast } from "sonner";
import { Acao, IconeWhatsApp } from "./ui";
import type { MensagemDaCaixa, TipoDeContato } from "./tipos";
import { useGravadorDeAudio } from "./gravador";
import { BotaoDoMicrofone, FaixaDeGravacao } from "./gravacao";
import { TecladoDeEmoji } from "./teclado-de-emoji";
import { flutuante, tempo } from "./movimento";
import { EVENTO_RASCUNHO } from "./reports-pendentes";

const LIMITE_BYTES = 4 * 1024 * 1024;

type Salva = { titulo: string; texto: string };

const SALVAS: Record<TipoDeContato, Salva[]> = {
  conta: [
    { titulo: "Checking", texto: "Hi {nome}, thanks for your message. Let me check and come back to you shortly." },
    { titulo: "Booked", texto: "All booked in. You will get the confirmation by email." },
    { titulo: "Partner on the way", texto: "Our partner is on the way to the property. We will keep you posted." },
    { titulo: "Report sent", texto: "The job is done and the report is in your inbox. Anything else we can help with?" },
  ],
  parceiro: [
    { titulo: "On track", texto: "Hi {nome}, are you still on track for today?" },
    { titulo: "ETA", texto: "Can you share your ETA, please?" },
    { titulo: "Photos in the app", texto: "Thanks {nome}. Please send photos of the finished work in the app." },
    { titulo: "Access confirmed", texto: "The client has confirmed access. All good to go." },
    { titulo: "Report missing", texto: "Hi {nome}, the report for this job is still missing. Can you submit it in the app today, please?" },
  ],
  cliente: [
    { titulo: "Checking", texto: "Hi {nome}, thanks for your message. Let me check and come back to you shortly." },
    { titulo: "On the way", texto: "Our partner is on the way. We will keep you posted." },
    { titulo: "Photos", texto: "Could you send a couple of photos of the area, please?" },
    { titulo: "All done", texto: "All done on our side. Is there anything else we can help with?" },
  ],
  grupo: [
    { titulo: "Hello all", texto: "Hi all, thanks for the update." },
    { titulo: "Checking", texto: "Thanks, let me check and come back to you shortly." },
    { titulo: "Photos", texto: "Could you send a couple of photos when you can, please?" },
  ],
  outro: [
    { titulo: "Hello", texto: "Hi {nome}, thanks for your message. How can we help?" },
    { titulo: "Address", texto: "Could you share the property address and postcode, please?" },
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

/**
 * Altura automática que abre e fecha (o Recolher do VOS): a faixa de gravação
 * entra empurrando o campo em vez de pular. `overflow: hidden` só enquanto anda.
 */
function Recolher({ aberto, children, style }: { aberto: boolean; children: ReactNode; style?: CSSProperties }) {
  const [andando, setAndando] = useState(false);
  return (
    <AnimatePresence initial={false}>
      {aberto ? (
        <motion.div
          key="recolher"
          initial={{ height: 0, opacity: 0 }}
          animate={{ height: "auto", opacity: 1, transition: { height: tempo("md"), opacity: tempo("sm") } }}
          exit={{ height: 0, opacity: 0, transition: { height: tempo("md", "saida"), opacity: tempo("xs", "saida") } }}
          style={{ ...style, overflow: andando ? "hidden" : undefined }}
          onAnimationStart={() => setAndando(true)}
          onAnimationComplete={() => setAndando(false)}
        >
          <div style={{ display: "flow-root" }}>{children}</div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function Composer({
  contato,
  nome,
  tipo,
  canal,
  janelaAberta,
  semJanela,
  onEnviado,
  onPendente,
  onResolvida,
}: {
  contato: string;
  nome: string;
  tipo: TipoDeContato;
  canal: string;
  janelaAberta: boolean;
  semJanela: boolean;
  onEnviado: () => void;
  /** A mensagem entra na conversa na hora; o envio corre por trás. */
  onPendente?: (m: MensagemDaCaixa) => void;
  onResolvida?: (id: string, erro?: string) => void;
}) {
  const [texto, setTexto] = useState("");
  // Texto pronto vindo do painel (pedido de report): entra na caixa, quem envia é a pessoa.
  useEffect(() => {
    const ouvir = (e: Event) => {
      const d = (e as CustomEvent<{ contato: string; texto: string }>).detail;
      if (d?.contato === contato) setTexto(d.texto);
    };
    window.addEventListener(EVENTO_RASCUNHO, ouvir);
    return () => window.removeEventListener(EVENTO_RASCUNHO, ouvir);
  }, [contato]);
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [previa, setPrevia] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [emojis, setEmojis] = useState(false);
  const [ativa, setAtiva] = useState(0);
  const [assunto, setAssunto] = useState("");
  const campo = useRef<HTMLTextAreaElement>(null);
  const inputArquivo = useRef<HTMLInputElement>(null);
  const faixa = useRef<HTMLDivElement | null>(null);
  const caixa = useRef<HTMLDivElement>(null);
  const gravador = useGravadorDeAudio({ onErro: (m) => toast.error(m) });
  const gravando = gravador.fase !== "parado";
  const primeiro = nome.startsWith("+") ? "there" : nome.split(" ")[0];

  // "/" no começo do campo abre as mensagens salvas; o resto filtra.
  const busca = texto.startsWith("/") ? texto.slice(1).toLowerCase() : null;
  const salvas = SALVAS[tipo].filter((s) => busca === null || !busca || s.titulo.toLowerCase().includes(busca) || s.texto.toLowerCase().includes(busca));

  // Trocou de conversa: rascunho, anexo e gravação não passam para a outra.
  useEffect(() => {
    setTexto("");
    setArquivo(null);
    setEmojis(false);
    gravador.descartar();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [contato]);

  useEffect(() => setAtiva(0), [busca]);

  // A miniatura do anexo de imagem.
  useEffect(() => {
    if (!arquivo || !arquivo.type.startsWith("image/")) {
      setPrevia(null);
      return;
    }
    const url = URL.createObjectURL(arquivo);
    setPrevia(url);
    return () => URL.revokeObjectURL(url);
  }, [arquivo]);

  // O campo cresce com o texto (até 160 px) e volta ao limpar.
  useEffect(() => {
    const el = campo.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [texto]);

  // Clique fora fecha o teclado de emoji.
  useEffect(() => {
    if (!emojis) return;
    const fechar = (e: MouseEvent) => {
      if (!caixa.current?.contains(e.target as Node)) setEmojis(false);
    };
    document.addEventListener("mousedown", fechar);
    return () => document.removeEventListener("mousedown", fechar);
  }, [emojis]);

  const focar = () => requestAnimationFrame(() => campo.current?.focus());

  /** Põe a bolha na conversa já, com "sending", e devolve o id para resolver depois. */
  function pendente(tipoMsg: string, conteudo: string | null, midiaUrl: string | null): string {
    const id = `tmp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
    onPendente?.({ id, direcao: "saida", origem: "os", tipo: tipoMsg, texto: conteudo, midiaUrl, status: "sending", erro: null, quem: "You", criadoEm: new Date().toISOString() });
    return id;
  }

  async function correr(id: string, envio: Promise<void>) {
    try {
      await envio;
      onResolvida?.(id);
      onEnviado();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Could not send";
      onResolvida?.(id, msg);
      toast.error(msg);
    }
  }

  // Não espera a uazapi: limpa o campo, mostra a bolha e envia por trás.
  function mandar() {
    if (!arquivo && !texto.trim()) return;
    const conteudo = texto.trim();
    const anexo = arquivo;
    const tipoMsg = !anexo ? "text" : anexo.type.startsWith("image/") ? "image" : anexo.type.startsWith("video/") ? "video" : "document";
    const id = pendente(tipoMsg, conteudo || (anexo && tipoMsg === "document" ? anexo.name : null), anexo ? URL.createObjectURL(anexo) : null);
    setTexto("");
    setArquivo(null);
    focar();
    void correr(id, anexo ? postarArquivo(contato, anexo, conteudo) : postarJson({ contato, texto: conteudo }));
  }

  async function enviarGravacao() {
    const voz = await gravador.concluir();
    if (!voz) return;
    if (voz.size > LIMITE_BYTES) {
      toast.error("Voice note is over 4 MB. Record a shorter one.");
      return;
    }
    const id = pendente("audio", null, URL.createObjectURL(voz));
    void correr(id, postarArquivo(contato, voz, "", "ptt"));
  }

  function escolher(f: File | undefined) {
    if (!f) return;
    if (f.size > LIMITE_BYTES) {
      toast.error("File is over 4 MB. Send it from the phone app.");
      return;
    }
    setArquivo(f);
    focar();
  }

  function usarSalva(s: Salva) {
    setTexto(s.texto.replaceAll("{nome}", primeiro));
    focar();
  }

  if (!janelaAberta && !semJanela) {
    return (
      <div className="wa-composer space-y-2 px-3 py-2.5">
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
    <div ref={caixa} className="wa-composer relative">
      <div className="top">
        <span className="ch">
          <IconeWhatsApp className="h-[13px] w-[13px] text-[#25D366]" />
          {canal}
          <span className="font-normal text-text-tertiary">to {nome}</span>
        </span>
      </div>

      {/* A faixa de gravação cola no campo pelo fio de baixo; o campo fica, travado. */}
      <Recolher aberto={gravando} style={{ flexShrink: 0 }}>
        {gravando ? <FaixaDeGravacao gravador={gravador} onEnviar={() => void enviarGravacao()} arrasteRef={faixa} /> : null}
      </Recolher>

      <Recolher aberto={!!arquivo && !gravando}>
        {arquivo ? (
          <div className="cmp-anexo">
            {/* eslint-disable-next-line @next/next/no-img-element -- miniatura de blob local */}
            {previa ? <img src={previa} alt="" /> : <Paperclip size={14} className="text-text-tertiary" />}
            <span className="min-w-0 flex-1 truncate">{arquivo.name}</span>
            <span className="text-text-tertiary">{Math.max(1, Math.round(arquivo.size / 1024))} KB</span>
            <button type="button" onClick={() => setArquivo(null)} aria-label="Remove file">
              <X size={14} />
            </button>
          </div>
        ) : null}
      </Recolher>

      <textarea
        ref={campo}
        rows={2}
        value={texto}
        disabled={gravando}
        placeholder={gravando ? "Recording audio…" : arquivo ? "Add a caption…" : `Message ${primeiro}… (type / for saved replies)`}
        onChange={(e) => setTexto(e.target.value)}
        onPaste={(e) => {
          const f = e.clipboardData?.files?.[0];
          if (!f) return;
          e.preventDefault();
          escolher(f);
        }}
        onKeyDown={(e) => {
          if (busca !== null && salvas.length) {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              setAtiva((a) => (a + (e.key === "ArrowDown" ? 1 : -1) + salvas.length) % salvas.length);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              setTexto("");
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              usarSalva(salvas[ativa] ?? salvas[0]!);
              return;
            }
          }
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            mandar();
          }
        }}
      />

      {/* Mensagens salvas, abrindo acima do campo. */}
      <AnimatePresence>
        {busca !== null && !gravando ? (
          <motion.div key="salvas" className="cmp-pop cmp-salvas" {...flutuante("top")}>
            <div className="cmp-salvas-h">
              <MessageSquareQuote size={12} aria-hidden /> Saved replies
            </div>
            {salvas.length ? (
              salvas.map((s, i) => (
                <button
                  key={s.titulo}
                  type="button"
                  className={"cmp-salva" + (i === ativa ? " on" : "")}
                  onMouseEnter={() => setAtiva(i)}
                  onClick={() => usarSalva(s)}
                >
                  <b>{s.titulo}</b>
                  {s.texto.replaceAll("{nome}", primeiro)}
                </button>
              ))
            ) : (
              <p className="px-2 py-1.5 text-[12px] text-text-tertiary">No saved reply matches “{busca}”.</p>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <AnimatePresence>
        {emojis ? (
          <motion.div key="emojis" className="cmp-pop w-[320px]" {...flutuante("top")}>
            <TecladoDeEmoji onPick={(em) => setTexto((v) => v + em)} />
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="bot">
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
        <div className="tools">
          <button
            type="button"
            className={"attach" + (emojis ? " on" : "")}
            title="Emoji"
            aria-label="Emoji"
            disabled={enviando || gravando}
            onClick={() => setEmojis((v) => !v)}
          >
            <Smile size={16} />
          </button>
          <button
            type="button"
            className="attach"
            title="Attach photo, video or document"
            aria-label="Attach file"
            disabled={enviando || gravando}
            onClick={() => inputArquivo.current?.click()}
          >
            <Paperclip size={16} />
          </button>
          <button
            type="button"
            className={"attach" + (busca !== null ? " on" : "")}
            title="Saved replies (type / at the start)"
            aria-label="Saved replies"
            disabled={enviando || gravando}
            onClick={() => {
              setTexto(busca !== null ? "" : "/");
              focar();
            }}
          >
            <MessageSquareQuote size={16} />
          </button>
          {/* Clique grava de mãos livres; segurar grava enquanto segura (soltar envia, arrastar cancela ou trava). */}
          <BotaoDoMicrofone gravador={gravador} onEnviar={() => void enviarGravacao()} arrasteRef={faixa} disabled={enviando} />
        </div>
        <span className="hint">Enter → Send · Shift + Enter → New line</span>
        <button
          type="button"
          className="snd"
          onClick={mandar}
          disabled={gravando || (!texto.trim() && !arquivo)}
          aria-label="Send"
          title="Send"
        >
          <Send size={15} />
        </button>
      </div>
    </div>
  );
}
