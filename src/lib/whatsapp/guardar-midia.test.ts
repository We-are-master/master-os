import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { guardarMidiaRecebida } from "./uazapi-operacao";

function sbFalso(erro: string | null = null) {
  const subidos: { bucket: string; caminho: string; tipo: string; bytes: number }[] = [];
  const sb = {
    storage: {
      from: (bucket: string) => ({
        upload: async (caminho: string, dados: Buffer, o: { contentType: string }) => {
          subidos.push({ bucket, caminho, tipo: o.contentType, bytes: dados.length });
          return { error: erro ? { message: erro } : null };
        },
      }),
    },
  } as unknown as SupabaseClient;
  return { sb, subidos };
}

const fetchOriginal = globalThis.fetch;
function trocarFetch(fn: (u: string) => Response) {
  globalThis.fetch = (async (u: string | URL) => fn(String(u))) as typeof fetch;
}

test("guarda a mídia no bucket e devolve storage:", async () => {
  trocarFetch(() => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "audio/mpeg" } }));
  const { sb, subidos } = sbFalso();
  const r = await guardarMidiaRecebida(sb, "https://x.uazapi.com/files/abc/66b0e6b2.mp3", "447700900123", "3EB0ABC");
  globalThis.fetch = fetchOriginal;
  assert.equal(r, "storage:447700900123/recebida-3EB0ABC.mp3");
  assert.deepEqual(subidos, [{ bucket: "inbox-media", caminho: "447700900123/recebida-3EB0ABC.mp3", tipo: "audio/mpeg", bytes: 3 }]);
});

test("link quebrado sem link novo devolve null (fica o link)", async () => {
  process.env.UAZAPI_OPS_TOKEN = "t";
  trocarFetch((u) => (u.includes("/message/download") ? new Response("{}") : new Response("", { status: 403 })));
  const { sb, subidos } = sbFalso();
  const r = await guardarMidiaRecebida(sb, "https://x.uazapi.com/files/abc/v.mp4", "447700900123", "W1");
  globalThis.fetch = fetchOriginal;
  assert.equal(r, null);
  assert.equal(subidos.length, 0);
});

test("erro no upload devolve null", async () => {
  trocarFetch(() => new Response(new Uint8Array([9]), { headers: { "content-type": "video/mp4" } }));
  const { sb } = sbFalso("bucket full");
  const r = await guardarMidiaRecebida(sb, "https://x.uazapi.com/files/abc/v.mp4", "447700900123", "W2");
  globalThis.fetch = fetchOriginal;
  assert.equal(r, null);
});
