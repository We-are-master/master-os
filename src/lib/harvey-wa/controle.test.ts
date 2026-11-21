/**
 * Take over e Give back com e sem HARVEY_DONO_POR_AGENTE (dono, 10/11/2026). Sem rede:
 * a Sunshine é um fetch de mentira e o banco é um objeto que só anota o que foi gravado.
 */
import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { assumirConversa, devolverConversa } from "./controle";

type Linha = { motivo_passagem: string | null; phone: string | null; tipo: string | null };

/** Banco de mentira: uma linha de harvey_wa_conversas; anota leituras e gravações. */
function bancoFalso(linha: Linha) {
  const gravado: Array<Record<string, unknown>> = [];
  const lidas: string[] = [];
  const consulta = (tabela: string) => {
    const q = {
      select: (colunas: string) => {
        lidas.push(`${tabela}:${colunas}`);
        return q;
      },
      update: (v: Record<string, unknown>) => {
        gravado.push(v);
        Object.assign(linha, v);
        return q;
      },
      delete: () => q,
      eq: () => q,
      maybeSingle: async () => ({ data: { ...linha }, error: null }),
      then: (ok: (r: { error: null }) => unknown) => Promise.resolve({ error: null }).then(ok),
    };
    return q;
  };
  return { sb: { from: consulta } as unknown as SupabaseClient, gravado, lidas, linha };
}

/**
 * O Take over junta o ticket anterior pelo motor, que importa "server-only" (só existe no
 * Next). Fora do Next esse import falha DEPOIS da gravação que o teste confere.
 */
async function assumir(...a: Parameters<typeof assumirConversa>) {
  await assumirConversa(...a).catch((e) => {
    if (!/server-only/.test(String(e))) throw e;
  });
}

const fetchOriginal = globalThis.fetch;
const envOriginal = { ...process.env };
let chamadas: string[] = [];

beforeEach(() => {
  chamadas = [];
  Object.assign(process.env, { SUNSHINE_APP_ID: "app", SUNSHINE_KEY_ID: "id", SUNSHINE_KEY_SECRET: "s", ZENDESK_SUBDOMAIN: "teste" });
  globalThis.fetch = (async (url: string | URL | Request, init?: RequestInit) => {
    const u = String(url);
    chamadas.push(`${init?.method ?? "GET"} ${u.replace(/^https:\/\/teste\.zendesk\.com\/sc\/v2\/apps\/app/, "")}`);
    if (!u.startsWith("https://teste.zendesk.com/sc/v2/apps/app/")) throw new Error(`rede proibida no teste: ${u}`);
    if (/\/messages$/.test(u) && (init?.method ?? "GET") === "GET") return new Response(JSON.stringify({ messages: [] }), { status: 200 });
    return new Response("{}", { status: 200 });
  }) as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = fetchOriginal;
  for (const k of Object.keys(process.env)) if (!(k in envOriginal)) delete process.env[k];
  Object.assign(process.env, envOriginal);
});

test("porta DESLIGADA: Take over grava o motivo de sempre e nem lê o motivo antigo", async () => {
  delete process.env.HARVEY_DONO_POR_AGENTE;
  const b = bancoFalso({ motivo_passagem: "[agent:alex]", phone: null, tipo: null });
  await assumir(b.sb, "conv1", "Ana", "the OS");
  assert.equal(b.gravado[0].estado, "equipe");
  assert.equal(b.gravado[0].motivo_passagem, "Ana took over");
  assert.ok(!b.lidas.some((l) => l.endsWith(":motivo_passagem")), "desligada não lê o motivo");
  assert.ok(chamadas.some((c) => c.startsWith("POST /conversations/conv1/passControl")));
});

test("porta DESLIGADA: Give back volta ao Harvey com a marca de sempre (a marca antiga some)", async () => {
  delete process.env.HARVEY_DONO_POR_AGENTE;
  const b = bancoFalso({ motivo_passagem: "Ana took over [agent:alex]", phone: null, tipo: null });
  await devolverConversa(b.sb, "conv1", { pessoa: "Ana" });
  assert.equal(b.gravado[0].estado, "harvey");
  assert.match(String(b.gravado[0].motivo_passagem), /^given back by Ana at \S+$/);
  assert.ok(!b.lidas.some((l) => l.endsWith(":motivo_passagem")));
});

test("porta DESLIGADA: devolução sem pessoa (preço da equipe) grava null, como hoje", async () => {
  delete process.env.HARVEY_DONO_POR_AGENTE;
  const b = bancoFalso({ motivo_passagem: "x", phone: null, tipo: null });
  await devolverConversa(b.sb, "conv1");
  assert.equal(b.gravado[0].motivo_passagem, null);
});

test("porta LIGADA: Take over de uma conversa do Alex e Give back voltam para o Alex", async () => {
  process.env.HARVEY_DONO_POR_AGENTE = "1";
  const b = bancoFalso({ motivo_passagem: "[agent:alex]", phone: null, tipo: null });
  await assumir(b.sb, "conv1", "Ana", "Zendesk");
  assert.equal(b.linha.motivo_passagem, "Ana took over [agent:alex]");
  await devolverConversa(b.sb, "conv1", { pessoa: "Ana" });
  assert.equal(b.gravado[1].estado, "harvey");
  assert.match(String(b.linha.motivo_passagem), /^given back by Ana at \S+ \[agent:alex\]$/);
});

test("porta LIGADA: conversa do Harvey continua sem marca (nada muda para ele)", async () => {
  process.env.HARVEY_DONO_POR_AGENTE = "1";
  const b = bancoFalso({ motivo_passagem: null, phone: null, tipo: null });
  await assumir(b.sb, "conv1", "Ana", "the OS");
  assert.equal(b.linha.motivo_passagem, "Ana took over");
  await devolverConversa(b.sb, "conv1", { pessoa: "Ana" });
  assert.match(String(b.linha.motivo_passagem), /^given back by Ana at \S+$/);
});
