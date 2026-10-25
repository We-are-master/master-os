/**
 * "Save all photos" nos e-mails (dono, 25/10/2026): um link que baixa todas as
 * fotos do job ou da cotação num .zip só.
 *
 * O e-mail não roda código, então o botão é um link para a rota pública
 * `/api/public/fotos-zip/[token]`. O token carrega a lista de fotos e o nome do
 * arquivo, assinados: ninguém monta um link nosso para baixar outra coisa.
 *
 * O zip é "store" (sem compressão): JPEG já vem comprimido, e assim não há
 * dependência nova. A rota guarda o zip no storage e redireciona para ele, porque a
 * resposta de uma função da Vercel para em 4,5 MB e dez fotos passam disso.
 */
import { createHmac } from "node:crypto";
import { crc32 } from "node:zlib";
import { appBaseUrl } from "@/lib/app-base-url";

/** Teto de fotos por zip: o convite e o job booked nunca passam disso. */
export const MAX_FOTOS_NO_ZIP = 30;

function segredo(): string {
  const s = process.env.QUOTE_RESPONSE_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim();
  if (!s) {
    if (process.env.NODE_ENV === "production") throw new Error("QUOTE_RESPONSE_SECRET (or NEXTAUTH_SECRET) must be set");
    return "dev-only-insecure-placeholder";
  }
  return s;
}

const assinar = (carga: string) => createHmac("sha256", segredo()).update(`fotos-zip:${carga}`).digest("base64url");

export type PedidoDeFotos = { nome: string; urls: string[] };

/** Nome seguro de arquivo: "JOB-9812" vira "JOB-9812-photos.zip". */
export function nomeDoZip(nome: string): string {
  const base = String(nome ?? "").replace(/[^\w.-]+/g, "_").replace(/^_+|_+$/g, "") || "fixfy";
  return `${base}-photos.zip`;
}

export function tokenDasFotos(p: PedidoDeFotos): string | null {
  const urls = p.urls.filter((u) => /^https:\/\//i.test(String(u ?? "").trim())).slice(0, MAX_FOTOS_NO_ZIP);
  if (!urls.length) return null;
  const carga = Buffer.from(JSON.stringify({ n: p.nome, u: urls }), "utf8").toString("base64url");
  return `${carga}.${assinar(carga)}`;
}

export function pedidoDoToken(token: string): PedidoDeFotos | null {
  const [carga, sig] = String(token ?? "").split(".");
  if (!carga || !sig || sig !== assinar(carga)) return null;
  try {
    const j = JSON.parse(Buffer.from(carga, "base64url").toString("utf8")) as { n?: unknown; u?: unknown };
    const urls = Array.isArray(j.u) ? j.u.filter((u): u is string => typeof u === "string" && /^https:\/\//i.test(u)) : [];
    if (!urls.length) return null;
    return { nome: typeof j.n === "string" ? j.n : "fixfy", urls: urls.slice(0, MAX_FOTOS_NO_ZIP) };
  } catch {
    return null;
  }
}

/** O link do botão. Null sem foto. */
export function linkParaBaixarFotos(nome: string, urls: readonly string[]): string | null {
  const t = tokenDasFotos({ nome, urls: [...urls] });
  return t ? `${appBaseUrl()}/api/public/fotos-zip/${t}` : null;
}

/** Zip sem compressão (método 0), com o diretório central. */
export function zipSemCompressao(arquivos: Array<{ nome: string; dados: Buffer }>): Buffer {
  const partes: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const a of arquivos) {
    const nome = Buffer.from(a.nome, "utf8");
    const crc = crc32(a.dados) >>> 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // nome em UTF-8
    local.writeUInt16LE(0, 8);
    local.writeUInt32LE(0, 10); // hora e data zeradas
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(a.dados.length, 18);
    local.writeUInt32LE(a.dados.length, 22);
    local.writeUInt16LE(nome.length, 26);
    local.writeUInt16LE(0, 28);
    partes.push(local, nome, a.dados);

    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0);
    c.writeUInt16LE(20, 4);
    c.writeUInt16LE(20, 6);
    c.writeUInt16LE(0x0800, 8);
    c.writeUInt16LE(0, 10);
    c.writeUInt32LE(0, 12);
    c.writeUInt32LE(crc, 16);
    c.writeUInt32LE(a.dados.length, 20);
    c.writeUInt32LE(a.dados.length, 24);
    c.writeUInt16LE(nome.length, 28);
    c.writeUInt32LE(offset, 42);
    central.push(c, nome);
    offset += local.length + nome.length + a.dados.length;
  }
  const dir = Buffer.concat(central);
  const fim = Buffer.alloc(22);
  fim.writeUInt32LE(0x06054b50, 0);
  fim.writeUInt16LE(arquivos.length, 8);
  fim.writeUInt16LE(arquivos.length, 10);
  fim.writeUInt32LE(dir.length, 12);
  fim.writeUInt32LE(offset, 16);
  return Buffer.concat([...partes, dir, fim]);
}

/** "photo-01.jpg", pela extensão da URL ou do content-type. */
export function nomeDaFoto(i: number, url: string, contentType: string | null): string {
  const daUrl = url.split("?")[0]!.match(/\.(jpe?g|png|webp|heic|gif)$/i)?.[1]?.toLowerCase();
  const doTipo = contentType?.match(/image\/(jpeg|png|webp|heic|gif)/i)?.[1]?.toLowerCase();
  const ext = (daUrl ?? doTipo ?? "jpg").replace("jpeg", "jpg");
  return `photo-${String(i + 1).padStart(2, "0")}.${ext}`;
}
