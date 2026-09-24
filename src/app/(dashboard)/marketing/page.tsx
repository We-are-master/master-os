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

  const [segmentos, campanhas, bloqueios] = await Promise.all([
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
  ]);

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
        Quem dá para alcançar hoje, e o que cada campanha fez depois de sair.
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
