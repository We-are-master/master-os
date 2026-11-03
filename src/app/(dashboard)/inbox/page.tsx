/** A /inbox: os dados vêm de dados.ts (o painel lateral usa os mesmos). */

import { CaixaAtendimento } from "./caixa-atendimento";
import { carregarCaixa } from "./dados";

export const dynamic = "force-dynamic";

export default async function InboxPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const [dados, { c }] = await Promise.all([carregarCaixa(), searchParams]);
  return <CaixaAtendimento {...dados} inicial={c?.replace(/\D/g, "") || null} />;
}
