/**
 * Painel de marketing: quem dá para alcançar, e o que cada campanha fez.
 *
 * Server component de propósito. As duas perguntas da tela ("quantos tem em
 * cada segmento" e "como foi cada campanha") são consultas de agregação, e
 * elas ficam mais rápidas e mais simples direto no servidor do que buscando
 * do cliente depois que a página já pintou.
 *
 * O funil por campanha vem da view `marketing_campaign_stats`, que agrega no
 * Postgres: a tabela de toques passa de noventa mil linhas até dezembro, e
 * somar isso no navegador seria uma tela que trava.
 */

import { createServiceClient } from "@/lib/supabase/service";
import { contarSegmentos } from "@/lib/marketing/segments";
import { SEQUENCES, FUNIL } from "@/lib/email-sequences/definitions";
import { funilLigado } from "@/lib/marketing/lifecycle";
import { AGENDA, indiceDaData, dataDaPeca, temporadaVencida } from "@/lib/email-sequences/agenda";
import { acharCupom, comoSeLe } from "@/lib/marketing/cupons";

export const dynamic = "force-dynamic";

type EstatDeCampanha = {
  campaign: string;
  channel: string;
  first_sent_at: string | null;
  last_sent_at: string | null;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  replied: number;
  bounced: number;
  complained: number;
};

/**
 * Fora do componente de propósito: `Date.now()` dentro do corpo de um
 * componente é chamada impura, e o lint do React barra com razão. Aqui é uma
 * função normal que o servidor chama uma vez por carga.
 */
async function enviosDaSemanaPorSequencia(
  sb: ReturnType<typeof createServiceClient>,
): Promise<Array<{ sequence_key: string }>> {
  const desde = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await sb
    .from("email_sequence_sends")
    .select("sequence_key")
    .gte("sent_at", desde)
    .limit(20000);
  if (error) throw new Error(error.message);
  return (data ?? []) as unknown as Array<{ sequence_key: string }>;
}

const pct = (parte: number, total: number) => (total > 0 ? `${((parte / total) * 100).toFixed(1)}%` : "0%");

/**
 * Os três números que mandam parar, e o que cada um significa.
 *
 * Não é enfeite: reclamação acima de 0,1% e o provedor começa a tratar o
 * domínio como suspeito; rejeição acima de 3% e ele passa a entregar tudo na
 * caixa de spam. Ver isso na tela é o que evita descobrir tarde demais.
 */
function saude(e: EstatDeCampanha): { rotulo: string; cor: string; nota: string } {
  const entregues = e.delivered || e.sent;
  const recl = entregues ? e.complained / entregues : 0;
  const rej = e.sent ? e.bounced / e.sent : 0;
  if (recl > 0.001) return { rotulo: "PARAR", cor: "#A5251B", nota: `reclamação em ${pct(e.complained, entregues)}, acima de 0,1%` };
  if (rej > 0.03) return { rotulo: "LIMPAR", cor: "#96590A", nota: `rejeição em ${pct(e.bounced, e.sent)}, acima de 3%` };
  return { rotulo: "OK", cor: "#1C6B46", nota: "dentro dos limites" };
}

export default async function MarketingPage() {
  const sb = createServiceClient();

  /**
   * Cada leitura falha por conta própria.
   *
   * O builder do PostgREST é um thenable, não uma Promise, então `.catch` nele
   * não existe. E a página não pode morrer inteira porque uma das três
   * consultas falhou: enquanto a migration 286 não roda, duas delas falham e
   * a terceira, que é a contagem de segmentos, ainda é útil sozinha.
   */
  async function tentar<T>(fn: () => Promise<T>, sePifar: T): Promise<T> {
    try { return await fn(); } catch (err) { console.error("[marketing] leitura falhou:", err); return sePifar; }
  }

  /**
   * O funil em duas leituras: quem está dentro agora, e o que saiu na semana.
   *
   * Uma inscrição ativa não prova envio (pode estar esperando o dia dela), e
   * envio da semana não prova base viva. As duas juntas dizem se o funil está
   * girando ou parado.
   */
  const [segmentos, campanhas, bloqueios, inscricoes, enviosDaSemana] = await Promise.all([
    tentar(() => contarSegmentos(), null as Awaited<ReturnType<typeof contarSegmentos>> | null),
    tentar(async () => {
      const { data, error } = await sb
        .from("marketing_campaign_stats").select("*")
        .order("last_sent_at", { ascending: false }).limit(60);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as EstatDeCampanha[];
    }, [] as EstatDeCampanha[]),
    tentar(async () => {
      const { data, error } = await sb.from("email_suppressions").select("reason").limit(5000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Array<{ reason: string }>;
    }, [] as Array<{ reason: string }>),
    tentar(async () => {
      const { data, error } = await sb
        .from("email_sequence_enrollments")
        .select("sequence_key, status, next_send_at")
        .eq("status", "active")
        .limit(20000);
      if (error) throw new Error(error.message);
      return (data ?? []) as unknown as Array<{ sequence_key: string; status: string; next_send_at: string }>;
    }, null as Array<{ sequence_key: string; status: string; next_send_at: string }> | null),
    tentar(() => enviosDaSemanaPorSequencia(sb), [] as Array<{ sequence_key: string }>),
  ]);

  const ativosPorSeq = (inscricoes ?? []).reduce<Record<string, { n: number; proximo: string | null }>>((a, r) => {
    const atual = a[r.sequence_key] ?? { n: 0, proximo: null };
    atual.n++;
    if (!atual.proximo || r.next_send_at < atual.proximo) atual.proximo = r.next_send_at;
    a[r.sequence_key] = atual;
    return a;
  }, {});
  const enviosPorSeq = enviosDaSemana.reduce<Record<string, number>>((a, r) => { a[r.sequence_key] = (a[r.sequence_key] ?? 0) + 1; return a; }, {});

  /** As três do funil de sempre primeiro; o resto (frio, sazonal) depois. */
  const ordemDoFunil = [FUNIL.naoComprou, FUNIL.naoComprouFogoBaixo, FUNIL.jaComprou];
  const sequenciasNaTela = [
    ...ordemDoFunil,
    ...Object.keys(SEQUENCES).filter((k) => !ordemDoFunil.includes(k) && (ativosPorSeq[k] || enviosPorSeq[k])),
  ];
  const ligado = funilLigado();

  const porMotivo = bloqueios.reduce<Record<string, number>>((a, b) => { a[b.reason] = (a[b.reason] ?? 0) + 1; return a; }, {});

  const th: React.CSSProperties = {
    textAlign: "left", padding: "0 14px 9px 0", fontSize: 10.5, fontWeight: 600,
    letterSpacing: "0.09em", textTransform: "uppercase", color: "#88847D",
    borderBottom: "1px solid #C7C1B7", whiteSpace: "nowrap",
  };
  const td: React.CSSProperties = { padding: "10px 14px 10px 0", borderBottom: "1px solid #E3DFD8", fontSize: 14, verticalAlign: "top" };
  const num: React.CSSProperties = { ...td, fontVariantNumeric: "tabular-nums", whiteSpace: "nowrap" };

  return (
    <div style={{ padding: "28px 24px 80px", maxWidth: 1180, margin: "0 auto" }}>
      <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", margin: "0 0 6px" }}>Marketing</h1>
      <p style={{ color: "#55524C", margin: "0 0 32px", fontSize: 15 }}>
        Quem dá para alcançar hoje, e o que cada campanha fez depois de sair.{" "}
        <a href="/marketing/ao-vivo" style={{ color: "#C2530A", fontWeight: 600 }}>Campanha ao vivo →</a>
      </p>

      {/* ─── Segmentos ─── */}
      <h2 style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#88847D", margin: "0 0 14px", paddingBottom: 8, borderBottom: "1px solid #E3DFD8" }}>
        Base alcançável
      </h2>
      {segmentos ? (
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))", gap: 12, marginBottom: 34 }}>
          {([
            ["B2B · e-mail de empresa", segmentos.b2b, "#14556F"],
            ["B2C · e-mail pessoal", segmentos.b2c, "#C2530A"],
            ["Só telefone · WhatsApp", segmentos.phone_only, "#55524C"],
          ] as const).map(([rotulo, s, cor]) => (
            <div key={rotulo} style={{ border: "1px solid #E3DFD8", borderTop: `4px solid ${cor}`, background: "#fff", padding: "16px 18px" }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: cor }}>{rotulo}</div>
              <div style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 30, fontWeight: 600, marginTop: 8, lineHeight: 1 }}>{s.total.toLocaleString("pt-BR")}</div>
              <div style={{ fontSize: 13, color: "#55524C", marginTop: 8, lineHeight: 1.5 }}>
                {s.comEmail.toLocaleString("pt-BR")} com e-mail<br />
                {s.comTelefone.toLocaleString("pt-BR")} com telefone<br />
                <strong style={{ color: "#16171A" }}>{s.compradores.toLocaleString("pt-BR")} já compraram</strong>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={{ color: "#A5251B", marginBottom: 34 }}>
          Não consegui ler os segmentos. Se a migration 286 ainda não rodou, é isso.
        </p>
      )}

      {/* ─── Funil de sempre ─── */}
      <h2 style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#88847D", margin: "0 0 14px", paddingBottom: 8, borderBottom: "1px solid #E3DFD8" }}>
        Funil de sempre
      </h2>
      <div style={{ marginBottom: 14, fontSize: 14, color: "#55524C", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{
          fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em",
          color: ligado ? "#1C6B46" : "#96590A", border: `1px solid ${ligado ? "#1C6B46" : "#96590A"}`, padding: "3px 8px",
        }}>
          {ligado ? "LIGADO" : "DESLIGADO"}
        </span>
        <span>
          {ligado
            ? "As sequências estão enviando. Envio só entre 8h e 20h de Londres, no máximo um por pessoa a cada 20 horas."
            : "Ninguém recebe nada enquanto MARKETING_LIFECYCLE não for 'on'. Dá para ver o plano sem ligar: /api/cron/marketing-lifecycle?dry-run=1"}
        </span>
      </div>
      {inscricoes === null ? (
        <p style={{ color: "#A5251B", marginBottom: 34 }}>
          Não consegui ler as inscrições. Se a migration 287 ainda não rodou, é isso.
        </p>
      ) : (
        <div style={{ overflowX: "auto", marginBottom: 34 }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 720 }}>
            <thead>
              <tr>
                <th style={th}>Sequência</th><th style={th}>Cadência</th><th style={th}>Dentro agora</th>
                <th style={th}>Saiu na semana</th><th style={th}>Próximo envio</th>
              </tr>
            </thead>
            <tbody>
              {sequenciasNaTela.map((chave) => {
                const seq = SEQUENCES[chave];
                const ativo = ativosPorSeq[chave];
                const cadencia = seq?.recurring
                  ? `gira a cada ${Math.round((seq.recurEveryHours ?? 0) / 24 * 10) / 10} dia(s)`
                  : `${seq?.steps.length ?? 0} e-mails`;
                return (
                  <tr key={chave}>
                    <td style={{ ...td, fontWeight: 600 }}>
                      {seq?.label ?? chave}
                      <div style={{ fontSize: 11.5, color: "#88847D", fontWeight: 400 }}>{chave}</div>
                    </td>
                    <td style={td}>{cadencia}</td>
                    <td style={num}>{(ativo?.n ?? 0).toLocaleString("pt-BR")}</td>
                    <td style={num}>{(enviosPorSeq[chave] ?? 0).toLocaleString("pt-BR")}</td>
                    <td style={num}>
                      {ativo?.proximo ? new Date(ativo.proximo).toLocaleString("pt-BR", { dateStyle: "short", timeStyle: "short" }) : "·"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ─── Agenda da temporada ─── */}
      <h2 style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#88847D", margin: "0 0 14px", paddingBottom: 8, borderBottom: "1px solid #E3DFD8" }}>
        Agenda da temporada · edição {indiceDaData() + 1} de {AGENDA.length}
      </h2>
      <p style={{ fontSize: 14, color: "#55524C", margin: "0 0 14px", lineHeight: 1.6 }}>
        {temporadaVencida()
          ? "A temporada deu a volta e está repetindo. Hora de escrever a próxima em src/lib/email-sequences/agenda.ts."
          : "A peça da vez sai da data, não do contador de cada pessoa: quem recebe duas por semana pega todas, quem recebe uma pega uma sim, uma não. Conteúdo de estação tem que chegar na estação."}
      </p>
      <div style={{ overflowX: "auto", marginBottom: 34 }}>
        <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 760 }}>
          <thead>
            <tr><th style={th}>#</th><th style={th}>Sai em</th><th style={th}>Tipo</th><th style={th}>Assunto</th><th style={th}>Cupom</th></tr>
          </thead>
          <tbody>
            {AGENDA.slice(indiceDaData(), indiceDaData() + 6).map((peca, i) => {
              const cupom = peca.cupom ? acharCupom(peca.cupom) : null;
              return (
                <tr key={peca.key} style={i === 0 ? { background: "#FFF8F4" } : undefined}>
                  <td style={num}>{peca.n}</td>
                  <td style={num}>{dataDaPeca(peca.n).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit" })}</td>
                  <td style={td}>{peca.etiqueta}</td>
                  <td style={{ ...td, fontWeight: i === 0 ? 600 : 400 }}>{peca.assunto}</td>
                  <td style={td}>
                    {cupom ? (
                      <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 12.5 }}>
                        {cupom.codigo} <span style={{ color: "#88847D" }}>{comoSeLe(cupom)}</span>
                      </span>
                    ) : (
                      <span style={{ color: "#A8A29E" }}>·</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ─── Lista de bloqueio ─── */}
      <h2 style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#88847D", margin: "0 0 14px", paddingBottom: 8, borderBottom: "1px solid #E3DFD8" }}>
        Lista de bloqueio · {bloqueios.length.toLocaleString("pt-BR")}
      </h2>
      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", marginBottom: 34, fontSize: 14, color: "#55524C" }}>
        {Object.keys(porMotivo).length === 0 ? (
          <span>Ninguém bloqueado ainda.</span>
        ) : (
          Object.entries(porMotivo).sort((a, b) => b[1] - a[1]).map(([motivo, n]) => (
            <span key={motivo}>
              <strong style={{ color: "#16171A", fontFamily: "ui-monospace, Menlo, monospace" }}>{n}</strong>{" "}
              {motivo === "unsubscribed" ? "pediram para sair"
                : motivo === "complained" ? "marcaram spam"
                : motivo === "bounced" ? "endereço morto"
                : motivo === "invalid" ? "endereço inválido" : "bloqueio manual"}
            </span>
          ))
        )}
      </div>

      {/* ─── Campanhas ─── */}
      <h2 style={{ fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "#88847D", margin: "0 0 14px", paddingBottom: 8, borderBottom: "1px solid #E3DFD8" }}>
        Campanhas
      </h2>
      {campanhas.length === 0 ? (
        <p style={{ color: "#55524C" }}>Nenhuma campanha enviada ainda.</p>
      ) : (
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", minWidth: 880 }}>
            <thead>
              <tr>
                <th style={th}>Campanha</th><th style={th}>Canal</th><th style={th}>Saiu</th>
                <th style={th}>Enviados</th><th style={th}>Entregues</th><th style={th}>Abertos</th>
                <th style={th}>Cliques</th><th style={th}>Respostas</th><th style={th}>Rejeição</th>
                <th style={th}>Spam</th><th style={th}>Saúde</th>
              </tr>
            </thead>
            <tbody>
              {campanhas.map((c) => {
                const s = saude(c);
                return (
                  <tr key={`${c.campaign}-${c.channel}`}>
                    <td style={{ ...td, fontWeight: 600 }}>{c.campaign}</td>
                    <td style={td}>{c.channel}</td>
                    <td style={num}>{c.last_sent_at ? new Date(c.last_sent_at).toLocaleDateString("pt-BR") : "—"}</td>
                    <td style={num}>{c.sent.toLocaleString("pt-BR")}</td>
                    <td style={num}>{c.delivered.toLocaleString("pt-BR")}<br /><span style={{ fontSize: 11, color: "#88847D" }}>{pct(c.delivered, c.sent)}</span></td>
                    <td style={num}>{c.opened.toLocaleString("pt-BR")}<br /><span style={{ fontSize: 11, color: "#88847D" }}>{pct(c.opened, c.delivered || c.sent)}</span></td>
                    <td style={num}>{c.clicked.toLocaleString("pt-BR")}</td>
                    <td style={num}>{c.replied.toLocaleString("pt-BR")}</td>
                    <td style={num}>{c.bounced.toLocaleString("pt-BR")}<br /><span style={{ fontSize: 11, color: "#88847D" }}>{pct(c.bounced, c.sent)}</span></td>
                    <td style={num}>{c.complained.toLocaleString("pt-BR")}</td>
                    <td style={td}>
                      <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", color: s.cor }}>{s.rotulo}</span>
                      <div style={{ fontSize: 11.5, color: "#88847D", marginTop: 3 }}>{s.nota}</div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
