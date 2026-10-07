/**
 * Harvey: o que ele sabe e decide, editável (dono, 07/10/2026). Os blocos vêm
 * de prompt.ts (texto padrão) com as edições de harvey_wa_config por cima; os
 * preços vêm ao vivo da tabela do site, só para leitura.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { lerEdicoes } from "@/lib/harvey-wa/conhecimento";
import { SECOES_CLIENTE, SECOES_PARCEIRO } from "@/lib/harvey-wa/prompt";
import { chamarSite } from "@/lib/harvey-wa/site";
import { AgenteHarvey, type Catalogo } from "./agente-harvey";

export const dynamic = "force-dynamic";

export default async function HarveyAgentPage() {
  const sb = createServiceClient();
  const [cliente, parceiro, { data: pausa }, catalogo] = await Promise.all([
    lerEdicoes(sb, "cliente").catch(() => ({})),
    lerEdicoes(sb, "parceiro").catch(() => ({})),
    sb.from("harvey_wa_config").select("valor").eq("chave", "pausado").maybeSingle(),
    chamarSite({ action: "catalog" })
      .then((r) => (r.status === 200 ? (r.data as unknown as Catalogo) : null))
      .catch(() => null),
  ]);
  return (
    <AgenteHarvey
      secoes={{ cliente: SECOES_CLIENTE, parceiro: SECOES_PARCEIRO }}
      edicoes={{ cliente, parceiro }}
      pausado={pausa?.valor === true}
      catalogo={catalogo}
    />
  );
}
