import { test } from "node:test";
import assert from "node:assert/strict";
import { fecharLeadPerdido, naoQuerMais, recusaDaOferta } from "./lead-perdido";

test("frases de quem não quer mais fecham; o resto não", () => {
  for (const t of ["No longer needed", "no longer needed, thanks", "Not needed anymore", "Sorry, not interested", "Found someone else", "I don't need it anymore", "All sorted now, thanks", "ok no longer required"]) assert.equal(naoQuerMais(t), true, t);
  for (const t of ["No thanks, thank you", "cancel", "Stop", "please stop", "Not at the moment, thanks", "unsubscribe", "no need thanks", "Don't message me again"]) assert.equal(recusaDaOferta(t), true, t);
  for (const t of ["Can I cancel Friday and move to Monday?", "no thanks, just the half day", "stop the leak in my kitchen", "How much is a full day?"]) assert.equal(recusaDaOferta(t), false, t);
  for (const t of ["No thanks", "cancel", "I don't need the full day, just 2 hours", "Is it sorted for Friday?", "not needed until next week", "", "Do I need to be there?"]) assert.equal(naoQuerMais(t), false, t);
});

test("fecha lead, CRM e o ticket da conversa", async () => {
  const feito: string[] = [];
  const r = await fecharLeadPerdido(
    { conversationId: "c1", telefone: "+447700900000", frase: "No longer needed", botao: false },
    {
      encerrarLeadPerdido: async (_t, nota) => (feito.push(`lead:${nota.includes('wrote "No longer needed"')}`), "perdido: #1"),
      marcarLostNoCrm: async () => (feito.push("crm"), 1),
      passarParaEquipe: async () => feito.push("passou"),
      marcarEstadoEquipe: async () => void feito.push("estado"),
      resolverTicketDaConversa: async () => (feito.push("conversa"), "conversa #2 solved"),
    },
  );
  assert.deepEqual(feito, ["lead:true", "crm", "passou", "estado", "conversa"]);
  assert.match(r, /crm: 1 lost/);
});
