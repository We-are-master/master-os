/**
 * Rules: o que vale para cliente, parceiro e conta, num lugar só (dono,
 * 07/10/2026). Os agentes leem daqui (o Harvey em toda resposta) e o site lê
 * as de cliente. Cada Save é uma versão nova em os_documentos.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { historico, versaoAtual, type Regras } from "@/lib/os-documentos";
import { EditorDeRegras } from "./editor-de-regras";

export const dynamic = "force-dynamic";

export default async function RulesPage() {
  const sb = createServiceClient();
  const [atual, versoes] = await Promise.all([versaoAtual<Regras>(sb, "regras"), historico(sb, "regras")]);
  if (!atual) return <p className="p-6 text-sm text-text-tertiary">No rules yet. Apply migration 316.</p>;
  return <EditorDeRegras atual={atual} versoes={versoes} />;
}
