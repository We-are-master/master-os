"use client";

/**
 * A página do Harvey: regras fixas no topo, blocos editáveis agrupados (um
 * aberto por vez, para não virar parede de texto) e a tabela de preços do
 * site só para leitura. Texto em inglês como o resto do OS, sem travessão.
 */

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import type { SecaoDoPrompt, PerfilDoHarvey } from "@/lib/harvey-wa/prompt";
import type { EdicaoSalva } from "@/lib/harvey-wa/conhecimento";
import type { AjustesDoHarvey } from "@/lib/harvey-wa/ajustes";

type Precos = Record<string, number | null>;
export type Catalogo = {
  sizes: Array<{ id: string; label: string }>;
  cleaning: {
    kinds: Array<{ id: string; name: string; forWhat: string; prices: Precos }>;
    includedBathrooms: number;
    extraBathroomSteps: number[];
    extras: Array<{ id: string; label: string; detail: string; price: number; perRoom: boolean }>;
    included: string[];
  };
  painting: { options: Array<{ id: string; label: string; detail: string; price: number; perRoom: boolean }>; materialsPack: { price: number; detail: string } };
  handyman: { packages: Array<{ id: string; label: string; detail: string; price: number }>; note: string };
  certificates: Array<{ id: string; label: string; detail: string; valid: string; price: number | null; prices: Precos | null }>;
};

const REGRAS_FIXAS = [
  "Prices come from the website price list, the same one the online checkout uses.",
  "Payment: 50% now by secure card link, 50% after the job. The link expires in 1 hour.",
  "Days: only days the diary shows free. No same day, no Sundays.",
  "London only.",
];

type Ajustes = AjustesDoHarvey & { atualizado_em: string | null; atualizado_por: string | null };
const HORAS = Array.from({ length: 25 }, (_, h) => h);
const rotuloHora = (h: number) => (h === 0 ? "Midnight" : h === 12 ? "12pm" : h === 24 ? "Midnight (end)" : h < 12 ? `${h}am` : `${h - 12}pm`);

const quando = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const gbp = (n: number | null | undefined) => (n == null ? "Quote" : `£${n}`);

async function salvar(corpo: Record<string, string>) {
  const res = await fetch("/api/agents/harvey/conhecimento", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
}

async function pausar(pausar: boolean) {
  const res = await fetch("/api/harvey-wa/controle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ acao: pausar ? "pausar" : "ligar" }) });
  if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "failed");
}

export function AgenteHarvey({
  secoes,
  edicoes,
  pausado,
  catalogo,
  ajustes,
}: {
  secoes: Record<PerfilDoHarvey, SecaoDoPrompt[]>;
  edicoes: Record<PerfilDoHarvey, Record<string, EdicaoSalva>>;
  pausado: boolean;
  catalogo: Catalogo | null;
  ajustes: Ajustes;
}) {
  const router = useRouter();
  const [aba, setAba] = useState<"cliente" | "parceiro" | "precos">("cliente");
  const [ocupado, setOcupado] = useState(false);
  const editados = (p: PerfilDoHarvey) => Object.keys(edicoes[p]).length;

  async function alternarPausa() {
    setOcupado(true);
    try {
      await pausar(!pausado);
      toast.success(pausado ? "Harvey is back on" : "Harvey paused: new messages go to the team");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <PageTransition>
      <div className="space-y-6 p-6">
        <PageHeader title="Harvey" subtitle="WhatsApp agent. Edit what he knows and how he decides: changes reach live conversations within 30 seconds.">
          <div className="flex items-center gap-2">
            {pausado ? <Badge variant="warning">Paused</Badge> : <Badge variant="success" dot>Live</Badge>}
            <Link href="/harvey-whatsapp">
              <Button variant="outline">Conversations</Button>
            </Link>
            <Button variant={pausado ? "primary" : "outline"} loading={ocupado} onClick={alternarPausa}>
              {pausado ? "Turn Harvey back on" : "Pause Harvey"}
            </Button>
          </div>
        </PageHeader>

        <CartaoDeAjustes inicial={ajustes} onSalvo={() => router.refresh()} />

        <section className="rounded-xl border border-border-light bg-surface-secondary p-4">
          <h2 className="mb-2 text-sm font-semibold text-text-primary">Fixed rules (shared with the website, set in code)</h2>
          <ul className="grid gap-1.5 text-sm text-text-secondary md:grid-cols-2">
            {REGRAS_FIXAS.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-text-tertiary" />
                {r}
              </li>
            ))}
          </ul>
        </section>

        <Tabs
          tabs={[
            { id: "cliente", label: "With customers", count: editados("cliente") || undefined },
            { id: "parceiro", label: "With partners", count: editados("parceiro") || undefined },
            { id: "precos", label: "Prices" },
          ]}
          activeTab={aba}
          onChange={(id) => setAba(id as typeof aba)}
        />

        {aba === "precos" ? (
          <TabelaDePrecos catalogo={catalogo} />
        ) : (
          <Blocos key={aba} perfil={aba} secoes={secoes[aba]} edicoes={edicoes[aba]} onSalvo={() => router.refresh()} />
        )}
      </div>
    </PageTransition>
  );
}

function Blocos({ perfil, secoes, edicoes, onSalvo }: { perfil: PerfilDoHarvey; secoes: SecaoDoPrompt[]; edicoes: Record<string, EdicaoSalva>; onSalvo: () => void }) {
  const [aberto, setAberto] = useState<string | null>(null);
  const grupos = useMemo(() => {
    const m = new Map<string, SecaoDoPrompt[]>();
    for (const s of secoes) m.set(s.grupo, [...(m.get(s.grupo) ?? []), s]);
    return [...m.entries()];
  }, [secoes]);
  return (
    <div className="space-y-6">
      <p className="text-sm text-text-tertiary">
        Write in plain English, as you would brief a new team member. Harvey reads these blocks before every reply.
      </p>
      {grupos.map(([grupo, lista]) => (
        <section key={grupo} className="space-y-2">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-text-tertiary">{grupo}</h2>
          {lista.map((s) => (
            <Bloco
              key={s.id}
              perfil={perfil}
              secao={s}
              edicao={edicoes[s.id]}
              aberto={aberto === s.id}
              onAbrir={() => setAberto(aberto === s.id ? null : s.id)}
              onSalvo={onSalvo}
            />
          ))}
        </section>
      ))}
    </div>
  );
}

function Bloco({
  perfil,
  secao,
  edicao,
  aberto,
  onAbrir,
  onSalvo,
}: {
  perfil: PerfilDoHarvey;
  secao: SecaoDoPrompt;
  edicao: EdicaoSalva | undefined;
  aberto: boolean;
  onAbrir: () => void;
  onSalvo: () => void;
}) {
  const atual = edicao?.texto ?? secao.texto;
  const [texto, setTexto] = useState(atual);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const mudou = texto.trim() !== atual.trim();

  async function agir(chave: string, corpo: Record<string, string>, ok: string, depois?: (t: string) => void) {
    setOcupado(chave);
    try {
      await salvar({ perfil, id: secao.id, ...corpo });
      toast.success(ok);
      depois?.(texto);
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(null);
    }
  }

  return (
    <div className={`rounded-xl border ${edicao ? "border-primary/40" : "border-border-light"} bg-card`}>
      <button type="button" onClick={onAbrir} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="font-medium text-text-primary">{secao.titulo}</span>
            {edicao ? <Badge variant="primary">{`Edited · ${edicao.atualizado_por ?? "team"}, ${quando(edicao.atualizado_em)}`}</Badge> : <Badge>Default</Badge>}
          </div>
          <p className="truncate text-xs text-text-tertiary">{secao.ajuda}</p>
        </div>
        <ChevronDown className={`h-4 w-4 shrink-0 text-text-tertiary transition-transform ${aberto ? "rotate-180" : ""}`} />
      </button>
      {aberto ? (
        <div className="space-y-3 border-t border-border-light px-4 py-3">
          <textarea
            value={texto}
            onChange={(e) => setTexto(e.target.value)}
            rows={Math.min(24, Math.max(6, Math.ceil(texto.length / 90) + texto.split("\n").length))}
            className="w-full resize-y rounded-lg border border-border bg-surface-secondary p-3 text-sm leading-relaxed text-text-primary focus:border-primary focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" disabled={!mudou} loading={ocupado === "salvar"} onClick={() => agir("salvar", { texto }, "Saved: Harvey uses it within 30 seconds")}>
              Save
            </Button>
            {mudou ? (
              <Button size="sm" variant="outline" onClick={() => setTexto(atual)}>
                Discard changes
              </Button>
            ) : null}
            {edicao?.anterior ? (
              <Button size="sm" variant="outline" loading={ocupado === "desfazer"} onClick={() => agir("desfazer", { acao: "desfazer" }, "Back to the previous version", () => setTexto(edicao.anterior ?? atual))}>
                Undo last save
              </Button>
            ) : null}
            {edicao ? (
              <Button size="sm" variant="outline" loading={ocupado === "reset"} onClick={() => agir("reset", { acao: "reset" }, "Back to the default text", () => setTexto(secao.texto))}>
                Reset to default
              </Button>
            ) : null}
            <span className="ml-auto text-xs text-text-tertiary">{texto.length} characters</span>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TabelaDePrecos({ catalogo }: { catalogo: Catalogo | null }) {
  if (!catalogo) return <p className="text-sm text-text-tertiary">The website price list did not answer. Try again in a minute.</p>;
  const tamanhos = catalogo.sizes;
  return (
    <div className="space-y-6">
      <p className="text-sm text-text-tertiary">
        Live from the website price list. Harvey quotes exactly these prices. To change a price, change it on the website so the site and Harvey always charge the same.
      </p>

      <Cartao titulo="Cleaning" nota={`Includes ${catalogo.cleaning.includedBathrooms} bathroom. Extra bathrooms: ${catalogo.cleaning.extraBathroomSteps.map((p) => `£${p}`).join(", ")}. Included: ${catalogo.cleaning.included.join(", ")}.`}>
        <table className="w-full text-sm">
          <thead className="text-left text-xs text-text-tertiary">
            <tr>
              <th className="py-2 pr-3 font-medium">Service</th>
              {tamanhos.map((t) => (
                <th key={t.id} className="py-2 pr-3 text-right font-medium">
                  {t.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {catalogo.cleaning.kinds.map((k) => (
              <tr key={k.id} className="border-t border-border-light">
                <td className="py-2 pr-3">
                  <span className="font-medium text-text-primary">{k.name}</span>
                  <p className="text-xs text-text-tertiary">{k.forWhat}</p>
                </td>
                {tamanhos.map((t) => (
                  <td key={t.id} className="py-2 pr-3 text-right tabular-nums">
                    {gbp(k.prices[t.id])}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Cartao>

      <div className="grid gap-4 md:grid-cols-2">
        <Cartao titulo="Cleaning extras">
          <Lista itens={catalogo.cleaning.extras.map((e) => ({ nome: e.label, detalhe: e.detail, preco: `${gbp(e.price)}${e.perRoom ? " per room" : ""}` }))} />
        </Cartao>
        <Cartao titulo="Handyman" nota={catalogo.handyman.note}>
          <Lista itens={catalogo.handyman.packages.map((p) => ({ nome: p.label, detalhe: p.detail, preco: gbp(p.price) }))} />
        </Cartao>
        <Cartao titulo="Painting" nota={`Paint and materials pack: £${catalogo.painting.materialsPack.price}. ${catalogo.painting.materialsPack.detail}`}>
          <Lista itens={catalogo.painting.options.map((o) => ({ nome: o.label, detalhe: o.detail, preco: `${gbp(o.price)}${o.perRoom ? " per room" : ""}` }))} />
        </Cartao>
        <Cartao titulo="Landlord certificates">
          <Lista
            itens={catalogo.certificates.map((c) => ({
              nome: c.label,
              detalhe: `${c.detail}. ${c.valid}.`,
              preco: c.price != null ? gbp(c.price) : c.prices ? `from ${gbp(Math.min(...Object.values(c.prices).filter((v): v is number => v != null)))}` : "Quote",
            }))}
          />
        </Cartao>
      </div>
    </div>
  );
}

function Cartao({ titulo, nota, children }: { titulo: string; nota?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-light bg-card p-4">
      <h3 className="mb-2 font-medium text-text-primary">{titulo}</h3>
      {children}
      {nota ? <p className="mt-2 text-xs text-text-tertiary">{nota}</p> : null}
    </section>
  );
}

function Lista({ itens }: { itens: Array<{ nome: string; detalhe: string; preco: string }> }) {
  return (
    <ul className="divide-y divide-border-light">
      {itens.map((i) => (
        <li key={i.nome} className="flex items-start justify-between gap-4 py-2 text-sm">
          <div className="min-w-0">
            <p className="text-text-primary">{i.nome}</p>
            <p className="text-xs text-text-tertiary">{i.detalhe}</p>
          </div>
          <span className="shrink-0 tabular-nums text-text-primary">{i.preco}</span>
        </li>
      ))}
    </ul>
  );
}

function CartaoDeAjustes({ inicial, onSalvo }: { inicial: Ajustes; onSalvo: () => void }) {
  const [a, setA] = useState<AjustesDoHarvey>({ janelaInicio: inicial.janelaInicio, janelaFim: inicial.janelaFim, cincoQuartos: inicial.cincoQuartos, transferencia: inicial.transferencia });
  const [ocupado, setOcupado] = useState(false);
  const mudou =
    a.janelaInicio !== inicial.janelaInicio || a.janelaFim !== inicial.janelaFim || a.cincoQuartos !== inicial.cincoQuartos || a.transferencia !== inicial.transferencia;
  const erro = a.janelaFim <= a.janelaInicio ? "The start hour must be before the end hour." : null;

  async function salvarAjustes() {
    setOcupado(true);
    try {
      const res = await fetch("/api/agents/harvey/ajustes", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(a) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      toast.success("Settings saved: Harvey uses them within 30 seconds");
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(false);
    }
  }

  const SELECT = "h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary focus:border-primary focus:outline-none";
  return (
    <section className="space-y-4 rounded-xl border border-border-light bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Settings</h2>
        <span className="text-xs text-text-tertiary">
          {inicial.atualizado_em ? `Last changed by ${inicial.atualizado_por ?? "team"}, ${quando(inicial.atualizado_em)}` : "Default settings"}
        </span>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-text-primary">First WhatsApp to new leads</span>
          <span className="block text-xs text-text-tertiary">Outside these hours the lead is saved and gets the message when the window opens.</span>
          <div className="flex items-center gap-2">
            <select className={SELECT} value={a.janelaInicio} onChange={(e) => setA({ ...a, janelaInicio: Number(e.target.value) })}>
              {HORAS.slice(0, 24).map((h) => (
                <option key={h} value={h}>
                  {rotuloHora(h)}
                </option>
              ))}
            </select>
            <span className="text-sm text-text-tertiary">to</span>
            <select className={SELECT} value={a.janelaFim} onChange={(e) => setA({ ...a, janelaFim: Number(e.target.value) })}>
              {HORAS.slice(1).map((h) => (
                <option key={h} value={h}>
                  {rotuloHora(h)}
                </option>
              ))}
            </select>
          </div>
          {erro ? <span className="block text-xs text-red-600">{erro}</span> : null}
        </label>

        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-text-primary">5+ bedroom cleans</span>
          <span className="block text-xs text-text-tertiary">Big properties: price from photos with the team, or quote straight from the price list.</span>
          <select className={`${SELECT} w-full`} value={a.cincoQuartos} onChange={(e) => setA({ ...a, cincoQuartos: e.target.value as AjustesDoHarvey["cincoQuartos"] })}>
            <option value="equipe">Pass to the team for a photo quote</option>
            <option value="tabela">Quote from the price list</option>
          </select>
        </label>

        <label className="space-y-1.5">
          <span className="block text-sm font-medium text-text-primary">Customer wants to pay by bank transfer</span>
          <span className="block text-xs text-text-tertiary">Harvey always sends the card link first. This is what he does when they ask for a transfer.</span>
          <select className={`${SELECT} w-full`} value={a.transferencia} onChange={(e) => setA({ ...a, transferencia: e.target.value as AjustesDoHarvey["transferencia"] })}>
            <option value="equipe">Pass to the team with the booking details</option>
            <option value="so_cartao">Card only: explain kindly and carry on</option>
          </select>
        </label>
      </div>

      <div className="flex items-center gap-2">
        <Button size="sm" disabled={!mudou || !!erro} loading={ocupado} onClick={salvarAjustes}>
          Save settings
        </Button>
        {mudou ? (
          <Button size="sm" variant="outline" onClick={() => setA({ janelaInicio: inicial.janelaInicio, janelaFim: inicial.janelaFim, cincoQuartos: inicial.cincoQuartos, transferencia: inicial.transferencia })}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </section>
  );
}
