/**
 * Price list: a lista de serviços que o site, o checkout e o Harvey usam (dono,
 * 07/10/2026). Cada Save é uma versão nova em os_documentos; o site lê em ~1 min.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { historico, versaoAtual } from "@/lib/os-documentos";
import { comoLista } from "@/lib/tabela-v2";
import { CANONICAL_TYPE_OF_WORK_NAMES } from "@/lib/type-of-work";
import { ListaDePrecos } from "./lista-de-precos";

export const dynamic = "force-dynamic";

export default async function PriceListPage() {
  const sb = createServiceClient();
  const [atual, versoes] = await Promise.all([versaoAtual<unknown>(sb, "tabela_de_precos"), historico(sb, "tabela_de_precos")]);
  if (!atual) return <p className="p-6 text-sm text-text-tertiary">No price list yet. Apply migration 316.</p>;
  return (
    <ListaDePrecos
      versao={{ id: atual.id, criado_em: atual.criado_em, criado_por: atual.criado_por }}
      inicial={comoLista(atual.documento)}
      versoes={versoes}
      tiposDeTrabalho={[...CANONICAL_TYPE_OF_WORK_NAMES]}
    />
  );
}
