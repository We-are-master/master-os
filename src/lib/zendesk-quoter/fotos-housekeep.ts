/**
 * As fotos que o morador mandou à Housekeep moram no card do job, não no e-mail.
 *
 * O e-mail "Job booked" da Housekeep não traz anexo: as fotos ficam no link do
 * card (`housekeep.com/job-reports/<uuid>`), na seção de detalhes da visita. A
 * API que a página chama (`/api/v1/work/job-reports/<uuid>/`) devolve cada uma
 * em `visit_details.visit_details_sections[].details[].file_paths`, como link
 * assinado do S3 que expira. Por isso baixamos e gravamos no bucket público
 * (`guardarFotosDoTicket`): é a URL que o parceiro abre no e-mail dias depois.
 *
 * Até aqui nenhum job de Housekeep tinha foto no OS (conferido em 25/10/2026,
 * JOB-9793: três fotos da mesa no card, zero no job), e o parceiro saía de casa
 * sem ver o que ia fazer.
 */
import { resolverLinkHousekeep, uuidDoLink } from "@/lib/stefane/housekeep-api";
import type { FotoBaixada } from "./guardar-fotos";

const API = "https://housekeep.com/api/v1/work/job-reports";
const TIMEOUT_MS = 20_000;
/** O e-mail do parceiro mostra até 6; mais que isso é peso sem uso. */
export const MAX_FOTOS_DO_CARD = 6;

const EXT_DE_FOTO = /\.(jpe?g|png|webp)$/i;

/** Os links das fotos na resposta da API do card, na ordem, só imagem. */
export function linksDeFotoDoCard(corpo: unknown): string[] {
  const secoes = (corpo as { visit_details?: { visit_details_sections?: unknown } } | null)?.visit_details?.visit_details_sections;
  if (!Array.isArray(secoes)) return [];
  const links: string[] = [];
  for (const s of secoes) {
    const detalhes = (s as { details?: unknown })?.details;
    if (!Array.isArray(detalhes)) continue;
    for (const d of detalhes) {
      const paths = (d as { file_paths?: unknown })?.file_paths;
      if (!Array.isArray(paths)) continue;
      for (const p of paths) {
        if (typeof p !== "string" || !/^https:\/\//i.test(p)) continue;
        const semQuery = p.split("?")[0];
        if (EXT_DE_FOTO.test(semQuery) && !links.some((l) => l.split("?")[0] === semQuery)) links.push(p);
      }
    }
  }
  return links.slice(0, MAX_FOTOS_DO_CARD);
}

/**
 * Baixa as fotos do card. Nunca lança: foto é enfeite comparada ao job, e um
 * card fora do ar não pode segurar a criação dele.
 */
export async function fotosDoCardHousekeep(cardUrl: string | null | undefined, fetchImpl: typeof fetch = fetch): Promise<FotoBaixada[]> {
  try {
    if (!cardUrl) return [];
    const uuid = uuidDoLink(await resolverLinkHousekeep(cardUrl));
    if (!uuid) return [];
    const r = await fetchImpl(`${API}/${uuid}/`, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!r.ok) {
      console.warn(`[fotos-housekeep] card ${uuid}: HTTP ${r.status}`);
      return [];
    }
    const links = linksDeFotoDoCard(await r.json());
    const baixadas = await Promise.all(
      links.map(async (url, i): Promise<FotoBaixada | null> => {
        try {
          const f = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
          if (!f.ok) return null;
          const ext = url.split("?")[0].split(".").pop()?.toLowerCase() ?? "jpg";
          const tipo = f.headers.get("content-type")?.split(";")[0]?.trim() || (ext === "png" ? "image/png" : ext === "webp" ? "image/webp" : "image/jpeg");
          if (!tipo.startsWith("image/")) return null;
          const bytes = Buffer.from(await f.arrayBuffer());
          return { filename: `housekeep-${i + 1}.${ext}`, dataUrl: `data:${tipo};base64,${bytes.toString("base64")}` };
        } catch {
          return null;
        }
      }),
    );
    return baixadas.filter((f): f is FotoBaixada => f !== null);
  } catch (err) {
    console.warn("[fotos-housekeep]", err instanceof Error ? err.message : err);
    return [];
  }
}
