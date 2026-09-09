/**
 * As datas em que o parceiro pode voltar, ditas por ele na resolução.
 *
 * É o dado que falta para a Parte C existir: sem saber quando ele pode voltar,
 * o Harvey não tem o que oferecer ao cliente. Fica separado e puro porque três
 * lugares vão precisar concordar sobre ele — o formulário do portal, a rota que
 * grava, e depois o e-mail que oferece duas datas ao cliente.
 *
 * O que esta função NÃO faz: escolher. Escolher duas dentro de cinco dias é
 * decisão de quem oferece ao cliente, e depende da agenda no momento do envio.
 * Aqui só se guarda o que o parceiro disse, limpo e verificável.
 */

/** Teto por resolução. Mais que isso não é disponibilidade, é ruído. */
export const MAX_DATAS_DE_RETORNO = 8;

const YMD = /^\d{4}-\d{2}-\d{2}$/;

export type DatasDeRetorno = {
  /** Únicas, em ordem, de hoje em diante. */
  datas: string[];
  /** O que foi descartado e por quê — o formulário mostra ao parceiro. */
  recusadas: Array<{ valor: string; motivo: "formato" | "inexistente" | "passado" | "repetida" | "excedeu" }>;
};

/** A data existe mesmo? `2026-02-31` casa a regex e não existe no calendário. */
function existeNoCalendario(ymd: string): boolean {
  const [a, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(a!, m! - 1, d!));
  return dt.getUTCFullYear() === a && dt.getUTCMonth() === m! - 1 && dt.getUTCDate() === d;
}

/**
 * `hoje` entra como argumento em vez de sair de `new Date()` aqui dentro para
 * a função ser testável e para quem chama poder passar o dia de Londres, que é
 * onde o job acontece. Hoje ainda vale: o parceiro pode dizer "consigo hoje".
 */
export function normalizarDatasDeRetorno(entradas: unknown, hoje: string): DatasDeRetorno {
  const lista = Array.isArray(entradas) ? entradas : [];
  const datas: string[] = [];
  const recusadas: DatasDeRetorno["recusadas"] = [];
  const vistas = new Set<string>();

  for (const bruta of lista) {
    const valor = String(bruta ?? "").trim();
    if (!valor) continue;
    if (!YMD.test(valor)) { recusadas.push({ valor, motivo: "formato" }); continue; }
    if (!existeNoCalendario(valor)) { recusadas.push({ valor, motivo: "inexistente" }); continue; }
    if (valor < hoje) { recusadas.push({ valor, motivo: "passado" }); continue; }
    if (vistas.has(valor)) { recusadas.push({ valor, motivo: "repetida" }); continue; }
    if (datas.length >= MAX_DATAS_DE_RETORNO) { recusadas.push({ valor, motivo: "excedeu" }); continue; }
    vistas.add(valor);
    datas.push(valor);
  }

  datas.sort();
  return { datas, recusadas };
}

/** Hoje no fuso de Londres, em YYYY-MM-DD. O job é lá, não onde o servidor roda. */
export function hojeEmLondres(agora: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(agora);
}
