/**
 * As fotos do ticket param de ser jogadas fora.
 *
 * O `lerTicketCompleto` já baixa cada anexo de imagem com token e monta um
 * data URL para o modelo com visão ler. Até 03/09/2026 esse buffer morria no
 * fim da cotação: o Harvey via a porta quebrada, escrevia sobre ela, e a foto
 * não existia em lugar nenhum depois.
 *
 * Aqui ela é gravada, e o resto do caminho já estava construído há meses:
 *
 *   `quotes.images`     → galeria pública do bid + `photoUrls` no e-mail de
 *                         convite ao parceiro
 *   `jobs.images`       → o strip de fotos no card do job e no portal
 *
 * Medido em 03/09/2026 antes de escrever isto: TODA `images` de `quotes` e
 * `service_requests` no banco estava vazia. O consumidor existia e nunca teve
 * o que consumir.
 *
 * ─── Por que o bucket `quote-invite-images` ─────────────────────────────
 *
 * Porque é público, e é o único que pode ser. A foto vai dentro de um e-mail
 * (`<img src>`) que o parceiro abre no telefone dele, sem sessão nossa: URL
 * assinada expira e o e-mail de amanhã mostra quadrado vazio. O bucket já
 * existe desde 30/03/2026 exatamente para isso, e é onde as fotos que o
 * escritório sobe à mão já vivem.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceClient } from "@/lib/supabase/service";

const BUCKET = "quote-invite-images";

/** O que o Zendesk entregou, já filtrado e baixado. */
export interface FotoBaixada {
  filename: string;
  /** `data:image/jpeg;base64,…` — como o `lerTicketCompleto` devolve. */
  dataUrl: string;
}

/**
 * Grava as fotos e devolve as URLs públicas, na ordem.
 *
 * Nunca lança: foto é enfeite comparada ao job. Se o bucket estiver fora, o
 * job continua nascendo e o log diz o que se perdeu — o contrário (derrubar a
 * criação do job por causa de um upload) trocaria um problema pequeno por um
 * grande.
 */
export async function guardarFotosDoTicket(
  ticketId: number | string,
  fotos: readonly FotoBaixada[],
  client?: SupabaseClient,
): Promise<string[]> {
  if (fotos.length === 0) return [];
  const supabase = client ?? createServiceClient();

  const urls = await Promise.all(
    fotos.map(async (f, i) => {
      try {
        // Sem regex de propósito: o data URL tem megabytes de base64, e
        // `.` com flag `s` sobre isso é varredura inútil. Dois índices bastam.
        const virgula = f.dataUrl.indexOf(",");
        const cabecalho = virgula > 0 ? f.dataUrl.slice(0, virgula) : "";
        if (!cabecalho.startsWith("data:") || !cabecalho.includes(";base64")) return null;
        const tipo = cabecalho.slice("data:".length, cabecalho.indexOf(";base64"));
        if (!tipo.startsWith("image/")) return null;
        const bytes = Buffer.from(f.dataUrl.slice(virgula + 1), "base64");
        const ext = tipo.includes("png") ? "png" : tipo.includes("webp") ? "webp" : "jpg";
        /**
         * O caminho leva o ticket e o índice, e nada de aleatório.
         *
         * Reprocessar o mesmo ticket é normal (o Harvey volta nele quando um
         * comentário novo chega), e com `upsert` a segunda passada sobrescreve
         * a mesma foto em vez de criar uma cópia. Sem isso a galeria dobrava
         * de tamanho a cada visita.
         */
        const path = `zendesk/${ticketId}/${i + 1}.${ext}`;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, bytes, { contentType: tipo, upsert: true });
        if (error) {
          console.error(`[fotos] upload falhou (${f.filename}):`, error.message);
          return null;
        }
        return supabase.storage.from(BUCKET).getPublicUrl(path).data?.publicUrl ?? null;
      } catch (err) {
        console.error(`[fotos] ${f.filename}:`, err);
        return null;
      }
    }),
  );

  const boas = urls.filter((u): u is string => !!u);
  if (boas.length !== fotos.length) {
    console.warn(`[fotos] ticket ${ticketId}: ${boas.length} de ${fotos.length} gravadas`);
  }
  return boas;
}
