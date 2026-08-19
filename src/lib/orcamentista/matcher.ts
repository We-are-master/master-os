/**
 * O matcher: a ÚNICA parte do orçamentista onde entra IA, e com poder mínimo.
 *
 * O modelo recebe o índice dos serviços APROVADOS (trade, service, unit) e o
 * pedido do cliente, e devolve apontamentos: qual linha, quantas unidades,
 * sob que premissa. Ele nunca vê preço e nunca inventa serviço — só pode
 * apontar para o que existe, e o quote-engine confere de novo. O que não
 * couber no pricebook volta em `cannot_price`, com a elétrica de instalação
 * sinalizada à parte (regra do dono, 17/08: só certificado).
 *
 * gpt-4o-mini, temperature 0, response_format json_object — e a palavra
 * "json" no prompt, porque sem ela a API devolve 400 (aprendido na prática).
 */
import type { ServicoCasado } from "./quote-engine";

export type ResultadoDoMatch = {
  matches: ServicoCasado[];
  cannotPrice: string[];
  electricalWorkRequested: boolean;
};

type IndiceServico = { trade: string; service: string; unit: string };

const PROMPT_SISTEMA = `You match a customer's home-services request to a fixed price list. Reply with strict JSON only.

Rules:
- You may ONLY reference services copied VERBATIM from the provided list (same trade and service strings). Never invent a service, never guess a price — prices are not your job.
- Map the work to the CLOSEST listed service when it clearly falls within it: caulking/sealing cracks or gaps in ANY room = the silicone reseal line; small plastering/making good = a plaster patch repair line; general small fixes = a handyman line. Use cannot_price ONLY when no listed service reasonably covers the work — an over-strict match that sends everything to a human is as wrong as an invented one.
- A request with MULTIPLE distinct tasks must produce one match PER task (e.g. "caulk cracks AND plaster areas" = the reseal/caulk line AND the plaster patch line). Never leave one part of the job unpriced when a listed service reasonably covers it.
- qty follows the service unit: per_room = number of rooms, per_m2 = square metres, per_door = doors, per_item/per_job = occurrences. If the size/amount is not stated, use qty 1 and record what you assumed in "assumption" (e.g. "assumed medium room", "assumed TV size 50 inch").
- Generic "handyman for a few hours / half day / full day" requests map to the handyman_time lines.
- Electrical INSTALLATION work (sockets, lights, rewiring, consumer units, EV chargers) is NOT offered: do not match it, list it in cannot_price, and set electrical_work_requested true. Electrical CERTIFICATES (EICR, PAT, emergency lighting cert) ARE offered under trade "certificates".
- Anything the list cannot cover goes in cannot_price, in the customer's words.

JSON shape:
{"matches":[{"trade":"...","service":"...","qty":1,"assumption":null}],"cannot_price":["..."],"electrical_work_requested":false}`;

export async function matchRequest(
  pedido: string,
  indice: IndiceServico[],
  apiKey: string,
): Promise<ResultadoDoMatch> {
  const resposta = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      temperature: 0,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: PROMPT_SISTEMA },
        {
          role: "user",
          content: `Price list (trade | service | unit):\n${indice
            .map((s) => `${s.trade} | ${s.service} | ${s.unit}`)
            .join("\n")}\n\nCustomer request:\n${pedido}`,
        },
      ],
    }),
  });
  if (!resposta.ok) {
    throw new Error(`OpenAI ${resposta.status}: ${(await resposta.text()).slice(0, 300)}`);
  }
  const corpo = (await resposta.json()) as {
    choices?: Array<{ message?: { content?: string } }>;
  };
  const bruto = corpo.choices?.[0]?.message?.content;
  if (!bruto) throw new Error("OpenAI returned an empty match");

  const json = JSON.parse(bruto) as {
    matches?: Array<{ trade?: string; service?: string; qty?: number; assumption?: string | null }>;
    cannot_price?: string[];
    electrical_work_requested?: boolean;
  };

  // O modelo aponta; nós conferimos: só passa o que existe no índice.
  const validos = new Set(indice.map((s) => `${s.trade} ${s.service}`));
  const matches: ServicoCasado[] = [];
  const cannotPrice = [...(json.cannot_price ?? [])];
  for (const m of json.matches ?? []) {
    if (m.trade && m.service && validos.has(`${m.trade} ${m.service}`)) {
      matches.push({
        trade: m.trade,
        service: m.service,
        qty: typeof m.qty === "number" && m.qty > 0 ? m.qty : 1,
        assumption: m.assumption ?? null,
      });
    } else if (m.service) {
      cannotPrice.push(`${m.service} (model pointed at a line that does not exist)`);
    }
  }
  return {
    matches,
    cannotPrice,
    electricalWorkRequested: json.electrical_work_requested === true,
  };
}
