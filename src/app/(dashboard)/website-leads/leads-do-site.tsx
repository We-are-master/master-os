"use client";

/**
 * A aba Leads: quem começou a reservar no site e não pagou. Só a lista.
 *
 * Os números e o gráfico moram na Leads Room do office virtual (dono,
 * 24/09: "pra o OS não ficar carregado à toa"). Aqui é trabalho: a lista por
 * estado e, clicando, o cartão do lead com as informações que importam,
 * contato, ações e a linha do tempo. Quem pagou vira cliente e sai da lista.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Drawer } from "@/components/ui/drawer";

export type AtividadeDaTela = {
  id: string;
  at: string;
  kind: string;
  detail: string;
  opened_at: string | null;
  clicked_at: string | null;
};

export type LeadDaTela = {
  id: string;
  created_at: string;
  last_activity_at: string;
  email: string;
  full_name: string | null;
  phone: string | null;
  postcode: string | null;
  service_label: string | null;
  price: number | null;
  resume_url: string | null;
  source: Record<string, string> | null;
  step_reached: number;
  status: "new" | "hot" | "contacted" | "won" | "lost" | "unsubscribed";
  lost_reason: string | null;
  sequence_state: "scheduled" | "paused" | "stopped" | "done";
  email1_due_at: string | null;
  email2_due_at: string | null;
  email3_due_at: string | null;
  email1_sent_at: string | null;
  email2_sent_at: string | null;
  email3_sent_at: string | null;
  promo_code: string | null;
  won_at: string | null;
  booking_ref: string | null;
  atividades: AtividadeDaTela[];
};

const ESTADO: Record<LeadDaTela["status"], { rotulo: string; cor: string; fundo: string }> = {
  new: { rotulo: "Novo", cor: "#2F4FD6", fundo: "#ECEFFD" },
  hot: { rotulo: "Quente", cor: "#C2410C", fundo: "#FFF1EA" },
  contacted: { rotulo: "Em contato", cor: "#96590A", fundo: "#FFF4E0" },
  won: { rotulo: "Cliente", cor: "#1C6B46", fundo: "#E6F4EE" },
  lost: { rotulo: "Perdido", cor: "#A5251B", fundo: "#FDECEA" },
  unsubscribed: { rotulo: "Descadastrado", cor: "#55524C", fundo: "#F1EFEC" },
};

const ABAS = [
  { id: "abertos", rotulo: "Abertos", filtro: (l: LeadDaTela) => ["new", "hot", "contacted"].includes(l.status) },
  { id: "quentes", rotulo: "Quentes", filtro: (l: LeadDaTela) => l.status === "hot" },
  { id: "contato", rotulo: "Em contato", filtro: (l: LeadDaTela) => l.status === "contacted" },
  { id: "perdidos", rotulo: "Perdidos", filtro: (l: LeadDaTela) => l.status === "lost" || l.status === "unsubscribed" },
  { id: "todos", rotulo: "Todos", filtro: (l: LeadDaTela) => l.status !== "won" },
] as const;

const PASSOS = ["Your job", "Details", "Date and access", "Checkout"];

const MOTIVOS = ["Price", "Date not available", "Outside our area", "Just researching", "No reply", "Booked elsewhere", "Other"];

const libras = (v: number | null) => (v == null ? "·" : `£${Number(v).toLocaleString("en-GB", { maximumFractionDigits: 2 })}`);

function quando(iso: string | null): string {
  if (!iso) return "·";
  return new Intl.DateTimeFormat("pt-BR", { timeZone: "Europe/London", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function origem(l: LeadDaTela): { linha: string; detalhe: string } {
  const s = l.source ?? {};
  if (s.utm_source === "meta") return { linha: `Meta · ${s.utm_campaign ?? ""}`.trim(), detalhe: s.utm_content ?? "" };
  if (s.utm_source) return { linha: `${s.utm_source}${s.utm_campaign ? ` · ${s.utm_campaign}` : ""}`, detalhe: s.utm_content ?? "" };
  return { linha: "Direto", detalhe: "sem origem" };
}

function sequencia(l: LeadDaTela): string {
  if (l.status === "won") return l.email3_sent_at ? "recuperado no e-mail 3" : l.email2_sent_at ? "recuperado no e-mail 2" : l.email1_sent_at ? "recuperado no e-mail 1" : "pagou sem e-mail";
  if (l.sequence_state === "paused") return "pausada (em contato)";
  if (l.sequence_state === "stopped") return "parada";
  if (l.sequence_state === "done") return "3 de 3 enviados";
  const proximo = !l.email1_sent_at ? ["e-mail 1", l.email1_due_at] : !l.email2_sent_at ? ["e-mail 2", l.email2_due_at] : ["e-mail 3", l.email3_due_at];
  return `${proximo[0]} ${quando(proximo[1] as string | null)}`;
}

function Pilula({ status }: { status: LeadDaTela["status"] }) {
  const e = ESTADO[status];
  return <span style={{ fontSize: 11.5, fontWeight: 600, color: e.cor, background: e.fundo, borderRadius: 999, padding: "3px 10px", whiteSpace: "nowrap" }}>{e.rotulo}</span>;
}

export function LeadsDoSite({ leads, motorLigado, exemplo = false }: { leads: LeadDaTela[]; motorLigado: boolean; exemplo?: boolean }) {
  const router = useRouter();
  const [aba, setAba] = useState<(typeof ABAS)[number]["id"]>("abertos");
  const [abertoId, setAbertoId] = useState<string | null>(null);
  const [nota, setNota] = useState("");
  const [motivo, setMotivo] = useState(MOTIVOS[0]);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");

  const filtro = ABAS.find((a) => a.id === aba)!.filtro;
  const lista = leads.filter(filtro);
  const aberto = leads.find((l) => l.id === abertoId) ?? null;

  async function agir(corpo: Record<string, string>) {
    if (!aberto) return;
    setSalvando(true);
    setErro("");
    try {
      const r = await fetch(`/api/site-leads/${aberto.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || j.ok === false) throw new Error(j.error || `Erro ${r.status}`);
      if (corpo.note) setNota("");
      router.refresh();
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não salvou. Tente de novo.");
    } finally {
      setSalvando(false);
    }
  }

  const titulo2: React.CSSProperties = { fontSize: 12, fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-tertiary)", margin: "0 0 12px", paddingBottom: 8, borderBottom: "1px solid var(--border-color)" };
  const botao = (cor: string, cheio = false): React.CSSProperties => ({
    fontSize: 13, fontWeight: 600, padding: "8px 12px", borderRadius: 8, cursor: "pointer",
    border: `1px solid ${cor}`, background: cheio ? cor : "var(--card-bg)", color: cheio ? "#fff" : cor, textDecoration: "none", display: "inline-block",
  });

  return (
    <div style={{ padding: "28px 24px 80px", maxWidth: 1180, margin: "0 auto" }}>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "baseline", justifyContent: "space-between", marginBottom: 6 }}>
        <h1 style={{ fontSize: 28, fontWeight: 800, letterSpacing: "-0.02em", margin: 0 }}>Leads</h1>
        <span style={{ fontSize: 12.5, fontWeight: 600, color: motorLigado ? "#1C6B46" : "#96590A", background: motorLigado ? "#E6F4EE" : "#FFF4E0", borderRadius: 999, padding: "4px 12px" }}>
          E-mails de retomada: {motorLigado ? "ligados" : "desligados (ensaio)"}
        </span>
      </div>
      {exemplo && (
        <p style={{ background: "#FFF4E0", color: "#96590A", border: "1px solid #F2D2A0", padding: "10px 14px", margin: "10px 0 0", fontSize: 14, fontWeight: 600 }}>
          Exemplo local: a migration 294 ainda não rodou, então estes leads são montados a partir dos 4 reais, com dados fictícios. Nada aqui grava no banco.
        </p>
      )}
      <p style={{ color: "var(--text-secondary)", margin: "10px 0 26px", fontSize: 15 }}>
        Quem começou a reservar em getfixfy.com e não pagou. Pagou, vira cliente e sai daqui. Os números estão na Leads Room do office.
      </p>

      <div role="tablist" style={{ display: "flex", flexWrap: "wrap", gap: 6, marginBottom: 12 }}>
        {ABAS.map((a) => {
          const n = leads.filter(a.filtro).length;
          const ativo = a.id === aba;
          return (
            <button key={a.id} role="tab" aria-selected={ativo} onClick={() => setAba(a.id)}
              style={{ fontSize: 13, fontWeight: 600, padding: "6px 12px", borderRadius: 999, cursor: "pointer", border: `1px solid ${ativo ? "#ED4B00" : "var(--border-color)"}`, background: ativo ? "#ED4B00" : "var(--card-bg)", color: ativo ? "#fff" : "var(--text-primary)" }}>
              {a.rotulo} <span style={{ opacity: 0.7 }}>{n}</span>
            </button>
          );
        })}
      </div>

      <div style={{ overflowX: "auto", background: "var(--card-bg)", border: "1px solid var(--border-color)" }}>
        <table style={{ width: "100%", minWidth: 860, borderCollapse: "collapse", fontSize: 13.5 }}>
          <thead>
            <tr style={{ textAlign: "left", color: "var(--text-tertiary)", fontSize: 11.5, textTransform: "uppercase", letterSpacing: "0.04em" }}>
              {["Lead", "Quer", "Parou em", "Veio de", "Sequência", "Estado"].map((h) => (
                <th key={h} style={{ padding: "10px 14px", borderBottom: "1px solid var(--border-color)", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lista.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 22, color: "var(--text-tertiary)" }}>Nenhum lead nesta aba.</td></tr>
            )}
            {lista.map((l) => {
              const o = origem(l);
              return (
                <tr key={l.id} onClick={() => setAbertoId(l.id)} style={{ cursor: "pointer", borderBottom: "1px solid var(--border-light)" }}>
                  <td style={{ padding: "10px 14px" }}>
                    <div style={{ fontWeight: 600 }}>{l.full_name || l.email}</div>
                    <div style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>{quando(l.last_activity_at)}{l.postcode ? ` · ${l.postcode}` : ""}</div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>
                    <div>{l.service_label ?? "·"}</div>
                    <div style={{ color: "var(--text-tertiary)", fontSize: 12.5 }}>{libras(l.price)}</div>
                  </td>
                  <td style={{ padding: "10px 14px" }}>Passo {l.step_reached}</td>
                  <td style={{ padding: "10px 14px" }}>
                    <div>{o.linha}</div>
                    <div style={{ color: "var(--text-tertiary)", fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace" }}>{o.detalhe}</div>
                  </td>
                  <td style={{ padding: "10px 14px", color: "var(--text-secondary)" }}>{sequencia(l)}</td>
                  <td style={{ padding: "10px 14px" }}><Pilula status={l.status} /></td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Drawer
        open={Boolean(aberto)}
        onClose={() => { setAbertoId(null); setErro(""); }}
        title={aberto?.full_name || aberto?.email || "Lead"}
        subtitle={aberto ? `${aberto.service_label ?? "Serviço"} · ${libras(aberto.price)} · passo ${aberto.step_reached}` : undefined}
        width="w-[520px]"
      >
        {aberto && (
          <div style={{ display: "grid", gap: 20, fontSize: 14, padding: "18px 22px 28px" }}>
            <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
              <Pilula status={aberto.status} />
              <span style={{ color: "var(--text-secondary)" }}>{sequencia(aberto)}</span>
            </div>

            <div>
              <div style={titulo2}>Informações</div>
              <dl style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: "6px 12px", margin: 0 }}>
                {([
                  ["Serviço", aberto.service_label ?? "·"],
                  ["Preço", libras(aberto.price)],
                  ["Parou em", `Passo ${aberto.step_reached} · ${PASSOS[aberto.step_reached - 1] ?? ""}`],
                  ["Veio de", `${origem(aberto).linha}${origem(aberto).detalhe ? ` · ${origem(aberto).detalhe}` : ""}`],
                  ["Entrou em", quando(aberto.created_at)],
                  ["Último movimento", quando(aberto.last_activity_at)],
                  ["E-mail 1", aberto.email1_sent_at ? `enviado ${quando(aberto.email1_sent_at)}` : aberto.email1_due_at ? `agendado ${quando(aberto.email1_due_at)}` : "·"],
                  ["E-mail 2", aberto.email2_sent_at ? `enviado ${quando(aberto.email2_sent_at)}` : aberto.email2_due_at ? `agendado ${quando(aberto.email2_due_at)}` : "·"],
                  ["E-mail 3 (10%)", aberto.email3_sent_at ? `enviado ${quando(aberto.email3_sent_at)}` : aberto.email3_due_at ? `agendado ${quando(aberto.email3_due_at)}` : "·"],
                  ...(aberto.promo_code ? [["Código", aberto.promo_code]] : []),
                ] as Array<[string, string]>).map(([k, v]) => (
                  <div key={k} style={{ display: "contents" }}>
                    <dt style={{ color: "var(--text-tertiary)", fontSize: 13 }}>{k}</dt>
                    <dd style={{ margin: 0 }}>{v}</dd>
                  </div>
                ))}
              </dl>
            </div>

            <div>
              <div style={titulo2}>Contato</div>
              <div style={{ display: "grid", gap: 4, marginBottom: 10 }}>
                <span>{aberto.email}</span>
                {aberto.phone && <span>{aberto.phone}</span>}
                {aberto.postcode && <span>{aberto.postcode}</span>}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <a href={`mailto:${aberto.email}`} style={botao("var(--text-primary)")}>E-mail</a>
                {aberto.phone && <a href={`https://wa.me/${aberto.phone.replace(/\D/g, "").replace(/^0/, "44")}`} target="_blank" rel="noreferrer" style={botao("#1FA855")}>WhatsApp</a>}
                {aberto.phone && <a href={`tel:${aberto.phone}`} style={botao("var(--text-primary)")}>Ligar</a>}
                {aberto.resume_url && <a href={aberto.resume_url} target="_blank" rel="noreferrer" style={botao("var(--text-tertiary)")}>Ver a reserva</a>}
              </div>
            </div>

            {["new", "hot", "contacted"].includes(aberto.status) && (
              <div>
                <div style={titulo2}>Estado</div>
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                  {aberto.status !== "contacted" && (
                    <button disabled={salvando} onClick={() => agir({ status: "contacted" })} style={botao("#96590A", true)}>Em contato (pausa os e-mails)</button>
                  )}
                  {aberto.status === "contacted" && (
                    <button disabled={salvando} onClick={() => agir({ status: aberto.step_reached >= 3 ? "hot" : "new" })} style={botao("#2F4FD6")}>Retomar os e-mails</button>
                  )}
                  <select value={motivo} onChange={(e) => setMotivo(e.target.value)} style={{ fontSize: 13, padding: "7px 8px", border: "1px solid var(--border-color)", borderRadius: 8, background: "var(--card-bg)", color: "var(--text-primary)" }}>
                    {MOTIVOS.map((m) => <option key={m}>{m}</option>)}
                  </select>
                  <button disabled={salvando} onClick={() => agir({ status: "lost", reason: motivo })} style={botao("#A5251B")}>Perdido</button>
                </div>
              </div>
            )}
            {aberto.status === "lost" && (
              <div>
                <div style={titulo2}>Estado</div>
                <p style={{ margin: "0 0 8px" }}>Perdido{aberto.lost_reason ? `: ${aberto.lost_reason}` : ""}.</p>
                <button disabled={salvando} onClick={() => agir({ status: aberto.step_reached >= 3 ? "hot" : "new" })} style={botao("#2F4FD6")}>Reabrir</button>
              </div>
            )}

            <div>
              <div style={titulo2}>Nota</div>
              <textarea value={nota} onChange={(e) => setNota(e.target.value)} rows={3} placeholder="O que foi falado, próximo passo…"
                style={{ width: "100%", fontSize: 14, padding: 10, border: "1px solid var(--border-color)", borderRadius: 8, fontFamily: "inherit", resize: "vertical", background: "var(--card-bg)", color: "var(--text-primary)" }} />
              <button disabled={salvando || !nota.trim()} onClick={() => agir({ note: nota })} style={{ ...botao("#ED4B00", true), marginTop: 8, opacity: nota.trim() ? 1 : 0.5 }}>Salvar nota</button>
              {erro && <p role="alert" style={{ color: "#A5251B", margin: "8px 0 0" }}>{erro}</p>}
            </div>

            <div>
              <div style={titulo2}>Linha do tempo</div>
              <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 10 }}>
                {aberto.atividades.map((a) => (
                  <li key={a.id} style={{ display: "grid", gridTemplateColumns: "92px 1fr", gap: 10 }}>
                    <span style={{ color: "var(--text-tertiary)", fontSize: 12.5, fontFamily: "ui-monospace, Menlo, monospace" }}>{quando(a.at)}</span>
                    <span>
                      {a.detail}
                      {a.kind === "email_sent" && (
                        <span style={{ color: "var(--text-secondary)", fontSize: 12.5 }}>
                          {" "}· {a.clicked_at ? "clicou" : a.opened_at ? "abriu" : "não abriu ainda"}
                        </span>
                      )}
                    </span>
                  </li>
                ))}
                {aberto.atividades.length === 0 && <li style={{ color: "var(--text-tertiary)" }}>Sem registros.</li>}
              </ol>
            </div>
          </div>
        )}
      </Drawer>
    </div>
  );
}
