import { test } from "node:test";
import assert from "node:assert/strict";
import { fecharLeadPerdido, naoQuerMais } from "./lead-perdido";

test("frases de quem não quer mais fecham; o resto não", () => {
  for (const t of ["No longer needed", "no longer needed, thanks", "Not needed anymore", "Sorry, not interested", "Found someone else", "I don't need it anymore", "All sorted now, thanks", "ok no longer required"]) assert.equal(naoQuerMais(t), true, t);
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
