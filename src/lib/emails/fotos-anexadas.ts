/**
 * As fotos do job como ANEXO de e-mail, nos dois canais que a casa usa.
 *
 * Embutir a foto no HTML já resolve o que o parceiro OLHA — e é o que ele faz,
 * a caminho, no telefone. O anexo resolve outra coisa: o que ele GUARDA. Ele
 * salva na galeria, amplia num detalhe, e mostra ao cliente na porta quando
 * houver discussão sobre o que já estava quebrado antes de ele chegar.
 *
 * Dois canais, dois formatos:
 *
 *   Zendesk side conversation → token de upload (`uploadAttachment`)
 *   Resend (job sem ticket)   → `{ filename, content }`
 *
 * Nada aqui derruba um envio. Um e-mail sem anexo continua levando o parceiro
 * à porta; um e-mail que não sai deixa o job sem ninguém.
 */
import { isZendeskConfigured, uploadAttachment } from "@/lib/zendesk";

/** Teto por e-mail: o parceiro abre isto no celular, com dados móveis. */
const MAX_ANEXOS = 6;
const MAX_BYTES = 5 * 1024 * 1024;

export interface FotoBaixada {
  /** A URL pública de onde ela veio, para embutir a MESMA foto no HTML. */
  url: string;
  filename: string;
  contentType: string;
  bytes: Buffer;
}

/** Baixa as fotos públicas do job, na ordem, ignorando o que não vier. */
export async function baixarFotosDoJob(urls: readonly string[]): Promise<FotoBaixada[]> {
  const alvo = urls.filter((u) => typeof u === "string" && /^https:\/\//.test(u)).slice(0, MAX_ANEXOS);
  const baixadas = await Promise.all(
    alvo.map(async (u, i): Promise<FotoBaixada | null> => {
      try {
        const r = await fetch(u);
        if (!r.ok) return null;
        const bytes = Buffer.from(await r.arrayBuffer());
        if (bytes.length === 0 || bytes.length > MAX_BYTES) return null;
        const contentType = (r.headers.get("content-type") || "image/jpeg").split(";")[0]!.trim();
        if (!contentType.startsWith("image/")) return null;
        const ext = contentType.includes("png") ? "png" : contentType.includes("webp") ? "webp" : "jpg";
        return { url: u, filename: `site-photo-${i + 1}.${ext}`, contentType, bytes };
      } catch {
        return null;
      }
    }),
  );
  return baixadas.filter((f): f is FotoBaixada => f !== null);
}

/** Sobe no Zendesk e devolve os tokens para a side conversation. */
export async function tokensDoZendesk(fotos: readonly FotoBaixada[]): Promise<string[]> {
  if (fotos.length === 0 || !isZendeskConfigured()) return [];
  const tokens = await Promise.all(
    fotos.map(async (f) => {
      try {
        return await uploadAttachment(f.bytes, f.filename, f.contentType);
      } catch (err) {
        console.error(`[fotos-anexadas] upload ao Zendesk falhou (${f.filename}):`, err);
        return null;
      }
    }),
  );
  return tokens.filter((t): t is string => !!t);
}

/** O formato de anexo do Resend. */
export const anexosDoResend = (fotos: readonly FotoBaixada[]) =>
  fotos.map((f) => ({ filename: f.filename, content: f.bytes }));

/**
 * Tudo que um remetente de e-mail de job precisa das fotos, numa chamada.
 *
 * Existe porque HOJE três lugares diferentes montam o e-mail de job
 * confirmado e cada um abre a sua própria side conversation:
 * `notify-partner-job-zendesk-server`, `job-partner-acceptance` (parceiro
 * aceitou a oferta) e o webhook `desk/job-created`. Sem um helper, ligar as
 * fotos significaria escrever a mesma sequência três vezes — e é assim que
 * nasce o buraco que o reschedule tem hoje, onde um caminho avisa e o outro
 * não.
 *
 * `urls` é o que vai embutido no HTML e é EXATAMENTE o que virou anexo.
 */
export async function fotosParaEmailDoJob(images: unknown): Promise<{
  urls: string[];
  tokensZendesk: string[];
  anexosResend: Array<{ filename: string; content: Buffer }>;
}> {
  const lista = Array.isArray(images)
    ? (images as unknown[]).filter((u): u is string => typeof u === "string")
    : [];
  if (lista.length === 0) return { urls: [], tokensZendesk: [], anexosResend: [] };
  const fotos = await baixarFotosDoJob(lista);
  if (fotos.length === 0) return { urls: [], tokensZendesk: [], anexosResend: [] };
  return {
    urls: fotos.map((f) => f.url),
    tokensZendesk: await tokensDoZendesk(fotos),
    anexosResend: anexosDoResend(fotos),
  };
}
