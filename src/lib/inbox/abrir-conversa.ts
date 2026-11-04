/**
 * Abre a conversa de um número no Atendimento lateral (o painel do 7983 por
 * cima de qualquer tela), em vez de mandar a pessoa ao WhatsApp de fora. Quem
 * escuta é o AtendimentoLateral; número sem conversa abre um rascunho.
 */

export const EVENTO_ABRIR_CONVERSA = "inbox:abrir-conversa";

export type PedidoDeConversa = { numero: string; nome: string; tipo?: "cliente" | "parceiro" | "conta" };

/** O número como o WhatsApp quer: só dígitos, 07… do UK vira 447…, 00 sai. Null se não parece telefone. */
export function numeroDoWhatsApp(raw: string | null | undefined): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if ((d.length === 10 || d.length === 11) && d.startsWith("0")) d = `44${d.slice(1)}`;
  // Celular UK gravado sem o 0 (7899…, 10 dígitos): sem isto virava +7, a Rússia.
  else if (d.length === 10 && d.startsWith("7")) d = `44${d}`;
  return d.length >= 10 && d.length <= 15 ? d : null;
}

export function abrirConversaNoAtendimento(telefone: string | null | undefined, nome: string, tipo?: PedidoDeConversa["tipo"]): boolean {
  const numero = numeroDoWhatsApp(telefone);
  if (!numero) return false;
  window.dispatchEvent(new CustomEvent<PedidoDeConversa>(EVENTO_ABRIR_CONVERSA, { detail: { numero, nome, tipo } }));
  return true;
}
