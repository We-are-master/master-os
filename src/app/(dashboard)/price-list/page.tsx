/**
 * Price list: a tabela que o site, o checkout e o Harvey usam (dono, 07/10/2026).
 * Cada Save é uma versão nova em os_documentos; o site lê em até ~1 minuto.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { historico, versaoAtual, type TabelaDePrecos } from "@/lib/os-documentos";
import { EditorDaTabela } from "./editor-da-tabela";

export const dynamic = "force-dynamic";

export default async function PriceListPage() {
  const sb = createServiceClient();
  const [atual, versoes] = await Promise.all([versaoAtual<TabelaDePrecos>(sb, "tabela_de_precos"), historico(sb, "tabela_de_precos")]);
  if (!atual) return <p className="p-6 text-sm text-text-tertiary">No price list yet. Apply migration 316.</p>;
  return <EditorDaTabela atual={atual} versoes={versoes} />;
}
