/**
 * Harvey parado tem que fazer barulho (dono, 23/10/2026).
 *
 * Em 22/10 as chaves do Zendesk foram trocadas e todo ciclo morreu com 401 por
 * 12 horas (21:22 a 09:30) sem ninguém saber: o log enchia de erro e a fila
 * parecia um dia calmo. No mesmo dia o POST /api/jobs do #51740 devolveu 400 e o
 * Harvey tentou de novo a cada 5 minutos, calado.
 *
 * Duas regras, as duas puras aqui (o envio fica no poll.ts):
 *   - ciclo: 2 ciclos seguidos com falha de infraestrutura (Zendesk/OS/Supabase
 *     fora, chave recusada) = um e-mail de alerta; o primeiro ciclo bom depois
 *     dele = um e-mail de volta. Enquanto continua falhando, nada de repetir.
 *   - ticket: o mesmo ticket falhando 2 vezes com erro do próprio ticket (um 4xx
 *     do OS, dado recusado) = uma nota interna com o erro e o Action Required.
 *     Erro diferente ganha nota nova; o mesmo erro, não.
 */

/** Ciclos seguidos com falha até o alerta. Um só é soluço (rede, deploy). */
export const CICLOS_ATE_ALERTAR = 2;
/** Falhas seguidas do mesmo ticket até a nota. */
export const FALHAS_ATE_ANOTAR = 2;

// ─── O que é falha de infraestrutura ─────────────────────────────────────────

/**
 * Erro que não é do ticket: a chave foi recusada, o serviço caiu, a rede não
 * respondeu, o modelo está sem saldo. Repetir no ticket não adianta e anotar no
 * ticket não ajuda (provavelmente nem dá para anotar): é caso de alerta.
 */
export function ehFalhaDeInfra(erro: unknown): boolean {
  const t = String((erro as { message?: string } | null)?.message ?? erro ?? "");
  return /(HTTP |\/api\/\S+ )(401|403|429|5\d\d)\b|\b(401|403) (Unauthorized|Forbidden)\b|fetch failed|ECONNRESET|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|socket hang up|not configured|SemSaldoOpenAI|insufficient_quota|credit_balance/i.test(t);
}

/** Uma linha curta do erro para e-mail e nota: sem quebra, até 300 caracteres. */
export function resumoDoErro(erro: unknown): string {
  const t = String((erro as { message?: string } | null)?.message ?? erro ?? "unknown error").replace(/\s+/g, " ").trim();
  return t.length > 300 ? `${t.slice(0, 297)}...` : t || "unknown error";
}

// ─── Saúde do ciclo ──────────────────────────────────────────────────────────

export type SaudeDoCiclo = {
  falhasSeguidas: number;
  /** Quando começou a sequência de falhas (ISO). */
  falhandoDesde: string | null;
  ultimoErro: string | null;
  /** Quando o alerta saiu (ISO); null = não há alerta em aberto. */
  alertadoEm: string | null;
};

export const SAUDE_INICIAL: SaudeDoCiclo = { falhasSeguidas: 0, falhandoDesde: null, ultimoErro: null, alertadoEm: null };

export type AcaoDaSaude = "nada" | "alertar" | "voltou";

/**
 * O estado novo depois de um ciclo e o que mandar. `erro` null = ciclo bom.
 * O estado só marca `alertadoEm` quando quem chama confirma o envio
 * (`marcarAlertado`): e-mail que não saiu tenta de novo no próximo ciclo.
 */
export function depoisDoCiclo(antes: SaudeDoCiclo, erro: string | null, agora: Date = new Date()): { estado: SaudeDoCiclo; acao: AcaoDaSaude } {
  if (erro == null) {
    const acao: AcaoDaSaude = antes.alertadoEm ? "voltou" : "nada";
    // "voltou" mantém o histórico até o e-mail de volta sair (`marcarVoltou`).
    return { estado: acao === "voltou" ? { ...antes, falhasSeguidas: 0 } : { ...SAUDE_INICIAL }, acao };
  }
  const falhasSeguidas = antes.falhasSeguidas + 1;
  const estado: SaudeDoCiclo = {
    falhasSeguidas,
    falhandoDesde: antes.falhandoDesde ?? agora.toISOString(),
    ultimoErro: erro,
    alertadoEm: antes.alertadoEm,
  };
  const acao: AcaoDaSaude = falhasSeguidas >= CICLOS_ATE_ALERTAR && !antes.alertadoEm ? "alertar" : "nada";
  return { estado, acao };
}

export function marcarAlertado(estado: SaudeDoCiclo, agora: Date = new Date()): SaudeDoCiclo {
  return { ...estado, alertadoEm: agora.toISOString() };
}

export function marcarVoltou(): SaudeDoCiclo {
  return { ...SAUDE_INICIAL };
}

/** Lê o arquivo de estado sem confiar nele: lixo vira estado inicial. */
export function lerSaude(bruto: unknown): SaudeDoCiclo {
  const o = (bruto ?? {}) as Partial<SaudeDoCiclo>;
  const n = Number(o.falhasSeguidas);
  return {
    falhasSeguidas: Number.isFinite(n) && n > 0 ? Math.floor(n) : 0,
    falhandoDesde: typeof o.falhandoDesde === "string" ? o.falhandoDesde : null,
    ultimoErro: typeof o.ultimoErro === "string" ? o.ultimoErro : null,
    alertadoEm: typeof o.alertadoEm === "string" ? o.alertadoEm : null,
  };
}

function duracao(desdeIso: string | null, agora: Date): string {
  const ms = desdeIso ? agora.getTime() - Date.parse(desdeIso) : NaN;
  if (!Number.isFinite(ms) || ms < 0) return "a while";
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const resto = min % 60;
  return resto ? `${h}h ${resto}min` : `${h}h`;
}

function horaDeLondres(iso: string | null): string {
  const d = iso ? new Date(iso) : null;
  if (!d || Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-GB", { timeZone: "Europe/London", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function emailDeAlerta(estado: SaudeDoCiclo, agora: Date = new Date()): { subject: string; text: string } {
  return {
    subject: "Harvey stopped working",
    text: [
      `Harvey failed ${estado.falhasSeguidas} cycles in a row (failing since ${horaDeLondres(estado.falhandoDesde)} London, ${duracao(estado.falhandoDesde, agora)}).`,
      "",
      "While this lasts, new Housekeep bookings do not become jobs, quote requests get no reply and partner bids are not read.",
      "",
      `Last error: ${estado.ultimoErro ?? "unknown"}`,
      "",
      "Usual causes: a Zendesk, Supabase or OpenAI key changed and the Railway service (project harvey) still has the old one, or that service is down.",
      "",
      "You get one email when it starts failing and one when it works again.",
    ].join("\n"),
  };
}

export function emailDeVolta(estado: SaudeDoCiclo, agora: Date = new Date()): { subject: string; text: string } {
  return {
    subject: "Harvey is working again",
    text: [
      `Harvey is back. It was failing since ${horaDeLondres(estado.falhandoDesde)} London (${duracao(estado.falhandoDesde, agora)}).`,
      "",
      "It picks up the tickets from that period by itself in the next cycles. Check the Housekeep bookings and quotes that came in while it was down.",
      "",
      `Last error before it came back: ${estado.ultimoErro ?? "unknown"}`,
    ].join("\n"),
  };
}

// ─── Falha por ticket ────────────────────────────────────────────────────────

export type FalhaDoTicket = { falhas: number; erro: string; anotado: string | null };
export type FalhasPorTicket = Record<string, FalhaDoTicket>;

/** O erro sem o que muda de uma tentativa para outra (ids, horas), para comparar. */
export function assinaturaDoErro(erro: string): string {
  return erro
    .toLowerCase()
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g, "<id>")
    .replace(/\d{4}-\d{2}-\d{2}t[\d:.]+z?/g, "<hora>")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

/**
 * Um ticket falhou. Devolve o mapa novo e se é hora da nota. Falha de
 * infraestrutura não conta aqui: é do alerta do ciclo.
 */
export function depoisDaFalha(
  mapa: FalhasPorTicket,
  ticketId: number | string,
  erro: unknown,
): { mapa: FalhasPorTicket; anotar: boolean; erro: string } {
  const resumo = resumoDoErro(erro);
  if (ehFalhaDeInfra(erro)) return { mapa, anotar: false, erro: resumo };
  const chave = String(ticketId);
  const antes = mapa[chave];
  const mesma = antes && assinaturaDoErro(antes.erro) === assinaturaDoErro(resumo);
  const falhas = mesma ? antes.falhas + 1 : 1;
  const anotado = mesma ? antes.anotado : antes?.anotado ?? null;
  const assinatura = assinaturaDoErro(resumo);
  const anotar = falhas >= FALHAS_ATE_ANOTAR && anotado !== assinatura;
  return { mapa: { ...mapa, [chave]: { falhas, erro: resumo, anotado } }, anotar, erro: resumo };
}

/** A nota saiu: guarda a assinatura para não repetir a mesma. */
export function marcarAnotado(mapa: FalhasPorTicket, ticketId: number | string): FalhasPorTicket {
  const chave = String(ticketId);
  const f = mapa[chave];
  if (!f) return mapa;
  return { ...mapa, [chave]: { ...f, anotado: assinaturaDoErro(f.erro) } };
}

/** O ticket deu certo: sai do mapa. */
export function esquecerFalha(mapa: FalhasPorTicket, ticketId: number | string): FalhasPorTicket {
  const chave = String(ticketId);
  if (!(chave in mapa)) return mapa;
  const resto = { ...mapa };
  delete resto[chave];
  return resto;
}

export type EtapaDoTicket = "booking" | "quote";

export function notaDaFalha(etapa: EtapaDoTicket, falhas: number, erro: string): string {
  const o = etapa === "booking" ? "create the job in the OS from this booking" : "log this quote request in the OS";
  return [
    `🤖 HARVEY: I could not ${o} (${falhas} attempts).`,
    "",
    `Error: ${erro}`,
    "",
    etapa === "booking"
      ? "I keep trying every cycle. If the booking is right, create the job by hand or fix what the error says; once the job exists this ticket is done."
      : "I keep trying every cycle. If it does not go through, create the quote by hand or fix what the error says.",
  ].join("\n");
}

export function acaoDaFalha(etapa: EtapaDoTicket): string {
  return etapa === "booking"
    ? "Harvey could not create the job from this booking: create it by hand or fix the error in the note"
    : "Harvey could not log this quote request: create the quote by hand or fix the error in the note";
}
