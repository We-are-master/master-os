/**
 * Atendimento do WhatsApp de operação (+44 7983 182332), a caixa de parceiros
 * e equipe. Por ora é só a tela, com conversas de exemplo: ainda não existe a
 * tabela de mensagens nem o webhook do 7983 (plano em
 * docs/estrategia/plano-harvey-pos-leo.md). Nada daqui sai pelo WhatsApp.
 */

import { CaixaAtendimento } from "./caixa-atendimento";

export default function InboxPage() {
  return <CaixaAtendimento />;
}
