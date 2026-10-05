/**
 * CRM B2B (mig 311): todas as contas e leads de empresa num quadro e numa
 * lista, com etapas que o escritório renomeia, cria, apaga e reordena.
 * A tela inteira é de cliente; a RLS (is_internal_staff) protege os dados.
 */

import { CrmClient } from "./crm-client";

export const dynamic = "force-dynamic";

export default function CrmPage() {
  return <CrmClient />;
}
