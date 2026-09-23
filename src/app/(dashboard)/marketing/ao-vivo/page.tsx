"use client";

/**
 * Painel ao vivo da campanha: o que saiu, o que falta, o que custou e o que
 * voltou em reserva. Pede os números de 5 em 5 segundos; a agregação é toda
 * no servidor (`painelDaCampanha`).
 */

import { useEffect, useState } from "react";
import type { PainelDaCampanha } from "@/lib/marketing/campanha-painel";

const COR = { email: "#C2530A", whatsapp: "#1C6B46", tinta: "#16171A", mudo: "#6B675F", linha: "#E3DFD8", fundo: "#fff", ruim: "#A5251B", aviso: "#96590A" };

const PASSO: Record<string, string> = {
  email_quente: "E-mail pelo nome · os dois",
  wa_followup: "WhatsApp 4h depois · os dois",
  email_oferta: "E-mail oferta · só e-mail",
  wa_oferta: "WhatsApp oferta · só número",
  email_lembrete: "Lembrete de sábado",
};
const GRUPO: Record<string, string> = { os_dois: "Têm os dois", so_numero: "Só número", so_email: "Só e-mail", teste: "Teste" };

const n = (v: number) => v.toLocaleString("pt-BR");
const gbp = (v: number) => `£${v.toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 1000) / 10}%` : "–");
const hora = (iso: string | null) => (iso ? new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" }) : "–");

const titulo = { fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" as const, color: "#88847D", margin: "30px 0 12px", paddingBottom: 8, borderBottom: `1px solid ${COR.linha}` };
const cartao = { border: `1px solid ${COR.linha}`, background: COR.fundo, padding: "14px 16px" };
const numero = { fontFamily: "ui-monospace, Menlo, monospace", fontSize: 28, fontWeight: 600, lineHeight: 1.1 };

function Barra({ partes, total }: { partes: Array<{ v: number; cor: string; rotulo: string }>; total: number }) {
  return (
    <div style={{ display: "flex", height: 10, background: "#F1EEE8", overflow: "hidden", margin: "10px 0 6px" }} aria-hidden>
      {partes.map((p) => <div key={p.rotulo} title={`${p.rotulo}: ${p.v}`} style={{ width: `${total ? (p.v / total) * 100 : 0}%`, background: p.cor, transition: "width .6s" }} />)}
    </div>
  );
}

export default function PainelAoVivo() {
  const [d, setD] = useState<PainelDaCampanha | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    let vivo = true;
    const puxar = async () => {
      try {
        const r = await fetch("/api/marketing/ao-vivo", { cache: "no-store" });
        const j = await r.json();
        if (!vivo) return;
        if (!r.ok) setErro(j.error ?? `erro ${r.status}`);
        else { setD(j); setErro(null); }
      } catch (e) {
        if (vivo) setErro(e instanceof Error ? e.message : "sem conexão");
      }
    };
    puxar();
    const t = setInterval(puxar, 5000);
    return () => { vivo = false; clearInterval(t); };
  }, []);

  if (!d) {
    return <div style={{ padding: "40px 32px", color: erro ? COR.ruim : COR.mudo }}>{erro ? `Não consegui ler a campanha: ${erro}` : "Carregando…"}</div>;
  }

  const enviados = d.porPasso.reduce((s, p) => s + p.enviado, 0);
  const total = d.porPasso.reduce((s, p) => s + p.total, 0);
  const wa = d.saude.whatsapp;
  const maxHora = Math.max(1, ...d.porHora.map((h) => h.email + h.whatsapp));
  const expira = new Date(d.expiraEm);

  return (
    <div style={{ padding: "32px 32px 80px", maxWidth: 1180, color: COR.tinta }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>Campanha {d.codigo}</h1>
        <span style={{ fontFamily: "ui-monospace, Menlo, monospace", fontSize: 10.5, fontWeight: 600, letterSpacing: "0.08em", color: d.ligada ? "#1C6B46" : COR.aviso, border: `1px solid ${d.ligada ? "#1C6B46" : COR.aviso}`, padding: "3px 8px" }}>
          {d.ligada ? "NO AR" : "DESLIGADA"}
        </span>
        <span style={{ color: COR.mudo, fontSize: 13 }}>
          10% até {expira.toLocaleString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "Europe/London" })} (Londres) · atualizado {hora(d.atualizadoEm)} {erro && <span style={{ color: COR.ruim }}>· {erro}</span>}
        </span>
      </div>

      {/* ─── Números grandes ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(170px, 1fr))", gap: 12, marginTop: 22 }}>
        <div style={cartao}><div style={{ fontSize: 12, color: COR.mudo }}>Mensagens enviadas</div><div style={numero}>{n(enviados)}</div><div style={{ fontSize: 12, color: COR.mudo }}>de {n(total)} planejadas</div></div>
        <div style={cartao}><div style={{ fontSize: 12, color: COR.mudo }}>Reservas de quem recebeu</div><div style={{ ...numero, color: "#1C6B46" }}>{n(d.resultado.reservas)}</div><div style={{ fontSize: 12, color: COR.mudo }}>{gbp(d.resultado.receita)} em jobs</div></div>
        <div style={cartao}><div style={{ fontSize: 12, color: COR.mudo }}>Custo até agora</div><div style={numero}>{gbp(d.custos.total)}</div><div style={{ fontSize: 12, color: COR.mudo }}>e-mail {gbp(d.custos.email)} · WhatsApp {gbp(d.custos.whatsapp)}</div></div>
        <div style={cartao}><div style={{ fontSize: 12, color: COR.mudo }}>Custo por reserva</div><div style={numero}>{d.resultado.custoPorReserva == null ? "–" : gbp(d.resultado.custoPorReserva)}</div><div style={{ fontSize: 12, color: COR.mudo }}>alvo: abaixo de £18</div></div>
        <div style={cartao}><div style={{ fontSize: 12, color: COR.mudo }}>Pediram para sair</div><div style={numero}>{n(d.saidas.email + d.saidas.whatsapp)}</div><div style={{ fontSize: 12, color: COR.mudo }}>e-mail {n(d.saidas.email)} · WhatsApp {n(d.saidas.whatsapp)}</div></div>
      </div>

      {/* ─── Saúde ─── */}
      <h2 style={titulo}>Saúde dos canais</h2>
      <div style={{ display: "flex", gap: 10, flexWrap: "wrap", fontSize: 14 }}>
        <Selo ok={wa?.qualidade === "GREEN"} texto={`WhatsApp ${wa?.qualidade ?? "sem leitura"}${wa?.limite ? ` · ${wa.limite.replace("TIER_", "")}/24h` : ""}`} />
        <Selo ok={d.saude.taxaRejeicao < 0.03} texto={`Rejeição de e-mail ${pct(d.saude.taxaRejeicao, 1)} (parar acima de 3%)`} />
        <Selo ok={d.saude.taxaSpam < 0.001} texto={`Marcado como spam ${pct(d.saude.taxaSpam, 1)} (parar acima de 0,1%)`} />
      </div>

      {/* ─── Por passo ─── */}
      <h2 style={titulo}>Por fluxo</h2>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {d.porPasso.map((p) => {
          const cor = p.canal === "email" ? COR.email : COR.whatsapp;
          return (
            <div key={p.passo} style={{ ...cartao, borderTop: `4px solid ${cor}` }}>
              <div style={{ fontSize: 10.5, fontWeight: 600, letterSpacing: "0.1em", textTransform: "uppercase", color: cor }}>{PASSO[p.passo] ?? p.passo}</div>
              <div style={{ ...numero, fontSize: 24, marginTop: 6 }}>{n(p.enviado)} <span style={{ fontSize: 14, color: COR.mudo }}>/ {n(p.total)}</span></div>
              <Barra total={p.total} partes={[
                { v: p.enviado, cor, rotulo: "enviado" },
                { v: p.reservado, cor: "#E8B48F", rotulo: "saindo" },
                { v: p.falhou + p.pulado, cor: "#C9C3B8", rotulo: "falhou ou saiu" },
              ]} />
              <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
                <tbody>
                  {([
                    ["Entregue", p.entregue, p.enviado],
                    [p.canal === "email" ? "Aberto" : "Lido", p.aberto, p.enviado],
                    ...(p.canal === "email" ? [["Clicou", p.clicado, p.enviado] as const] : []),
                    ["Respondeu", p.respondido, p.enviado],
                    ["Falhou", p.falhou + p.rejeitado, p.enviado],
                    ...(p.aguardando ? [["Esperando o e-mail", p.aguardando, p.total] as const] : []),
                    ["Na fila", p.planejado - p.aguardando, p.total],
                  ] as const).map(([r, v, base]) => (
                    <tr key={r}><td style={{ padding: "3px 0", color: COR.mudo }}>{r}</td><td style={{ textAlign: "right", fontFamily: "ui-monospace, Menlo, monospace" }}>{n(v)}</td><td style={{ textAlign: "right", width: 60, color: COR.mudo }}>{pct(v, base)}</td></tr>
                  ))}
                </tbody>
              </table>
              <div style={{ fontSize: 12, color: COR.mudo, marginTop: 6 }}>custo {gbp(p.custo)}</div>
            </div>
          );
        })}
      </div>

      {/* ─── Por hora ─── */}
      <h2 style={titulo}>Disparos por hora (Londres)</h2>
      {d.porHora.length === 0 ? <p style={{ color: COR.mudo, fontSize: 14 }}>Nada enviado ainda.</p> : (
        <div style={{ display: "flex", alignItems: "flex-end", gap: 4, height: 140, overflowX: "auto", paddingBottom: 22, position: "relative" }}>
          {d.porHora.map((h) => (
            <div key={h.hora} style={{ minWidth: 26, flex: "0 0 26px", display: "flex", flexDirection: "column", justifyContent: "flex-end", height: "100%", position: "relative" }} title={`${hora(h.hora)} · e-mail ${h.email} · WhatsApp ${h.whatsapp}`}>
              <div style={{ height: `${(h.whatsapp / maxHora) * 100}%`, background: COR.whatsapp }} />
              <div style={{ height: `${(h.email / maxHora) * 100}%`, background: COR.email }} />
              <span style={{ position: "absolute", bottom: -20, left: 0, fontSize: 10, color: COR.mudo }}>{hora(h.hora).slice(0, 2)}h</span>
            </div>
          ))}
        </div>
      )}
      <div style={{ fontSize: 12, color: COR.mudo, display: "flex", gap: 14 }}>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: COR.email, marginRight: 5 }} />e-mail</span>
        <span><span style={{ display: "inline-block", width: 10, height: 10, background: COR.whatsapp, marginRight: 5 }} />WhatsApp</span>
      </div>

      {/* ─── Grupos e feed ─── */}
      <div style={{ display: "grid", gridTemplateColumns: "minmax(220px, 1fr) minmax(0, 2.4fr)", gap: 24 }}>
        <div>
          <h2 style={titulo}>Pessoas por grupo</h2>
          {d.grupos.map((g) => (
            <div key={g.grupo} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: `1px solid ${COR.linha}`, fontSize: 14 }}>
              <span>{GRUPO[g.grupo] ?? g.grupo}</span><strong style={{ fontFamily: "ui-monospace, Menlo, monospace" }}>{n(g.pessoas)}</strong>
            </div>
          ))}
        </div>
        <div style={{ minWidth: 0 }}>
          <h2 style={titulo}>Últimos disparos</h2>
          <div style={{ overflowX: "auto" }}>
            <table style={{ width: "100%", fontSize: 13, borderCollapse: "collapse" }}>
              <tbody>
                {d.feed.map((f, i) => (
                  <tr key={i} style={{ borderBottom: `1px solid ${COR.linha}` }}>
                    <td style={{ padding: "6px 8px 6px 0", color: COR.mudo, whiteSpace: "nowrap" }}>{hora(f.quando)}</td>
                    <td style={{ padding: "6px 8px", whiteSpace: "nowrap" }}>{f.nome}</td>
                    <td style={{ padding: "6px 8px", color: COR.mudo, whiteSpace: "nowrap" }}>{f.contato}</td>
                    <td style={{ padding: "6px 8px", color: f.canal === "email" ? COR.email : COR.whatsapp, whiteSpace: "nowrap" }}>{PASSO[f.passo] ?? f.passo}</td>
                    <td style={{ padding: "6px 0 6px 8px", color: f.status === "falhou" ? COR.ruim : f.status === "enviado" ? COR.tinta : COR.mudo }} title={f.erro ?? ""}>{f.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

function Selo({ ok, texto }: { ok: boolean; texto: string }) {
  return (
    <span style={{ border: `1px solid ${ok ? "#1C6B46" : COR.ruim}`, color: ok ? "#1C6B46" : COR.ruim, padding: "5px 10px", fontSize: 13 }}>
      {ok ? "●" : "▲"} {texto}
    </span>
  );
}
