import { strict as assert } from "node:assert";
import { test } from "node:test";
import { CardIlegivel, resolverLinkDoCard } from "./quoter";

/** Um fetch de mentira que devolve só o que resolverLinkDoCard lê (ok, status, url). */
function fingirFetch(resposta: { ok: boolean; status: number; url: string } | Error): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = (async () => {
    if (resposta instanceof Error) throw resposta;
    return resposta as unknown as Response;
  }) as typeof fetch;
  return () => {
    globalThis.fetch = original;
  };
}

test("o endereco direto do card nem passa pelo tracker", async () => {
  const restaurar = fingirFetch(new Error("nao era para chamar fetch"));
  try {
    const direto = "https://housekeep.com/job-reports/0e9aee28da134a08a5fe5102fdf20294?utm_campaign=x";
    assert.equal(await resolverLinkDoCard(direto), direto);
  } finally {
    restaurar();
  }
});

test("rastreado que vai parar no card devolve o card ja resolvido", async () => {
  const card = "https://housekeep.com/job-reports/3d163c0183d74a18b5c65df521152430?utm_campaign=em_trans";
  const restaurar = fingirFetch({ ok: true, status: 200, url: card });
  try {
    assert.equal(await resolverLinkDoCard("https://links.housekeep.com/ls/click?upn=u001.abc"), card);
  } finally {
    restaurar();
  }
});

test("rastreado que vai parar na rede social nao e card: null, e sem navegador", async () => {
  // Os 5 links da assinatura do #50393 saem pelo mesmo tracker do card.
  for (const destino of [
    "https://www.facebook.com/wearehousekeep?utm_campaign=em_trans",
    "https://www.instagram.com/housekeep_cleaners/?utm_campaign=em_trans",
    "https://x.com/housekeep?utm_campaign=em_trans",
  ]) {
    const restaurar = fingirFetch({ ok: true, status: 200, url: destino });
    try {
      assert.equal(await resolverLinkDoCard("https://links.housekeep.com/ls/click?upn=u001.social"), null, destino);
    } finally {
      restaurar();
    }
  }
});

test("tracker fora do ar e 'nao sei', nunca 'nao e card'", async () => {
  const rastreado = "https://links.housekeep.com/ls/click?upn=u001.abc";
  for (const falha of [new Error("fetch failed"), { ok: false, status: 503, url: rastreado }]) {
    const restaurar = fingirFetch(falha);
    try {
      await assert.rejects(() => resolverLinkDoCard(rastreado), CardIlegivel);
    } finally {
      restaurar();
    }
  }
});
