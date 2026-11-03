/**
 * Grupo do WhatsApp na /inbox. O contato de um grupo é o id dele só com
 * dígitos (120363...): telefone tem no máximo 15 dígitos (E.164), id de grupo
 * tem 18, então o tamanho basta para separar. Grupo antigo (dono-timestamp,
 * com hífen) fica fora: some há anos e quebraria a chave de só dígitos.
 */

export const ehGrupo = (contato: string) => contato.replace(/\D/g, "").length > 15;

/** Para quem a uazapi manda: grupo vai pelo JID, pessoa pelo número. */
export const destinoNaUazapi = (contato: string) => {
  const d = contato.replace(/\D/g, "");
  return ehGrupo(d) ? `${d}@g.us` : d;
};
