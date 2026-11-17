/**
 * Mensagem de voz do cliente vira texto para o Harvey (dono, 17/11/2026: "harvey tem
 * que ler áudio"). Antes o áudio chegava como "[file sent]" e ele pedia para escrever.
 *
 * O áudio da Sunshine é baixado (baixarMidia) e transcrito pela OpenAI. A transcrição
 * fica em memória pelo id da mensagem: o motor relê a conversa a cada resposta e o
 * mesmo áudio não é pago duas vezes na mesma instância. Falhou: fica o "[audio sent]"
 * de antes e o Harvey pede gentilmente um resumo por escrito.
 */
import { baixarMidia, type MensagemSc } from "./sunshine";

const MAX_BYTES = 24 * 1024 * 1024;
const MAX_AUDIOS = 5;
const cache = new Map<string, string>();

export function ehAudio(m: MensagemSc): boolean {
  if (m.author.type !== "user" || !m.content.mediaUrl) return false;
  if (m.content.type === "audio") return true;
  // A Sunshine manda nota de voz do WhatsApp como "file" com mediaType audio/ogg.
  const tipo = String((m.content as { mediaType?: string }).mediaType ?? "");
  return m.content.type === "file" && /^audio\//.test(tipo);
}

function extensao(tipo: string): string {
  if (/ogg|opus/.test(tipo)) return "ogg";
  if (/mpeg|mp3/.test(tipo)) return "mp3";
  if (/mp4|m4a|aac/.test(tipo)) return "m4a";
  if (/wav/.test(tipo)) return "wav";
  if (/webm/.test(tipo)) return "webm";
  return "ogg";
}

async function transcrever(url: string): Promise<string | null> {
  const chave = process.env.OPENAI_API_KEY;
  if (!chave) return null;
  const { dados, tipo } = await baixarMidia(url);
  if (!dados.length || dados.length > MAX_BYTES) return null;
  const form = new FormData();
  form.append("file", new Blob([new Uint8Array(dados)], { type: tipo || "audio/ogg" }), `voz.${extensao(tipo)}`);
  form.append("model", process.env.HARVEY_WA_MODELO_AUDIO?.trim() || "gpt-4o-mini-transcribe");
  form.append("prompt", "A UK customer describing a home repair, cleaning, painting or property certificate job to Fixfy in London. Postcodes like SW11 2AB.");
  const res = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${chave}` },
    body: form,
    signal: AbortSignal.timeout(45_000),
  });
  if (!res.ok) throw new Error(`transcrição ${res.status}: ${(await res.text()).slice(0, 200)}`);
  const j = (await res.json()) as { text?: string };
  return j.text?.trim() || null;
}

/**
 * As mensagens com os áudios do cliente trocados por texto ("[voice note] ..."). Só os
 * últimos MAX_AUDIOS; o resto passa como veio. Nunca lança.
 */
export async function comAudiosTranscritos(msgs: MensagemSc[]): Promise<MensagemSc[]> {
  const audios = msgs.filter(ehAudio).slice(-MAX_AUDIOS);
  if (!audios.length) return msgs;
  const textos = new Map<string, string>();
  await Promise.all(
    audios.map(async (m) => {
      const pronto = cache.get(m.id);
      if (pronto) return void textos.set(m.id, pronto);
      try {
        const t = await transcrever(m.content.mediaUrl as string);
        if (t) {
          cache.set(m.id, t);
          textos.set(m.id, t);
        }
      } catch (e) {
        console.error("[harvey-wa] áudio", m.id, e instanceof Error ? e.message : e);
      }
    }),
  );
  if (cache.size > 500) cache.clear();
  return msgs.map((m) => {
    const t = textos.get(m.id);
    return t ? { ...m, content: { ...m.content, type: "text", text: `[voice note] ${t}` } } : m;
  });
}
