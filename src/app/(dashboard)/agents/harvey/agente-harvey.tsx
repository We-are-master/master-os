"use client";

/**
 * A página do Harvey: regras fixas no topo, blocos editáveis agrupados (um
 * aberto por vez, para não virar parede de texto) e a tabela de preços do
 * site só para leitura. Texto em inglês como o resto do OS, sem travessão.
 */

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ChevronDown } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { PainelDoHarvey } from "./painel-do-harvey";
import type { SecaoDoPrompt, PerfilDoHarvey } from "@/lib/harvey-wa/prompt";
import type { EdicaoSalva } from "@/lib/harvey-wa/conhecimento";
import type { AjustesDoHarvey } from "@/lib/harvey-wa/ajustes";
import type { AreaDeAutonomia, Autonomia, ModoDeAutonomia } from "@/lib/harvey/autonomia";
import type { PapeisDaEquipe, PapelDaEquipe } from "@/lib/responsavel-operacao";

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
  "Prices come from Services, the same ones the website and checkout use.",
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
  papeis,
  autonomia,
  regras,
}: {
  secoes: Record<PerfilDoHarvey, SecaoDoPrompt[]>;
  edicoes: Record<PerfilDoHarvey, Record<string, EdicaoSalva>>;
  pausado: boolean;
  catalogo: Catalogo | null;
  ajustes: Ajustes;
  papeis: Papeis;
  autonomia: AutonomiaNaTela;
  regras: { texto: string; padrao: string; editado: boolean };
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
      <div className="space-y-6">
        <PageHeader title="Harvey" subtitle="WhatsApp agent. Edit what he knows and how he decides: changes reach live conversations within 30 seconds.">
          <div className="flex items-center gap-2">
            {pausado ? <Badge variant="warning">Paused</Badge> : <Badge variant="success" dot>Live</Badge>}
            <Link href="/harvey-whatsapp">
              <Button variant="outline">Conversations</Button>
            </Link>
            <Button variant={pausado ? "primary" : "outline"} loading={ocupado} onClick={alternarPausa}>
              {pausado ? "Turn WhatsApp back on" : "Pause WhatsApp"}
            </Button>
          </div>
        </PageHeader>

        <PainelDoHarvey />

        <CartaoDeAutonomia inicial={autonomia} regras={regras} onSalvo={() => router.refresh()} />

        <CartaoDeAjustes inicial={ajustes} onSalvo={() => router.refresh()} />

        <CartaoDePapeis inicial={papeis} onSalvo={() => router.refresh()} />

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
            { id: "cliente", label: "Customers", count: editados("cliente") || undefined },
            { id: "parceiro", label: "Partners", count: editados("parceiro") || undefined },
            { id: "precos", label: "Pricing" },
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
  if (!catalogo) return <p className="text-sm text-text-tertiary">No price list in the OS yet.</p>;
  const tamanhos = catalogo.sizes;
  return (
    <div className="space-y-6">
      <p className="text-sm text-text-tertiary">
        What the website sells, with prices from Services (the website, the checkout and Harvey all use them).{" "}
        <Link href="/services" className="font-medium text-primary hover:underline">
          Edit in Services
        </Link>
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
  const base = (): AjustesDoHarvey => ({
    janelaInicio: inicial.janelaInicio,
    janelaFim: inicial.janelaFim,
    cincoQuartos: inicial.cincoQuartos,
    transferencia: inicial.transferencia,
    acessos: { ...inicial.acessos },
    pagamento: { ...inicial.pagamento },
  });
  const [a, setA] = useState<AjustesDoHarvey>(base);
  const [ocupado, setOcupado] = useState(false);
  const mudou = JSON.stringify(a) !== JSON.stringify(base());
  const { pode, naoPode } = podeENaoPode(a);
  const acesso = (k: keyof AjustesDoHarvey["acessos"], v: boolean) => setA({ ...a, acessos: { ...a.acessos, [k]: v } });
  const pagar = (p: Partial<AjustesDoHarvey["pagamento"]>) => setA({ ...a, pagamento: { ...a.pagamento, ...p } });
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

      <div className="grid gap-3 md:grid-cols-2">
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 dark:border-emerald-900 dark:bg-emerald-950/30">
          <p className="mb-1 text-sm font-semibold text-emerald-900 dark:text-emerald-200">He can</p>
          <ul className="space-y-0.5 text-sm text-emerald-900 dark:text-emerald-200">
            {pode.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <div className="rounded-lg border border-red-200 bg-red-50 p-3 dark:border-red-900 dark:bg-red-950/30">
          <p className="mb-1 text-sm font-semibold text-red-900 dark:text-red-200">He cannot</p>
          <ul className="space-y-0.5 text-sm text-red-900 dark:text-red-200">
            {naoPode.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">Access to the OS</p>
          <p className="text-xs text-text-tertiary">Each switch is a real tool. Off means he cannot use it and passes to the team instead.</p>
          {(
            [
              ["precos", "Price list (quote prices)"],
              ["agenda", "Diary (offer free days)"],
              ["reservas", "Customer bookings"],
              ["cotacao", "Photo quotes (request a quote)"],
              ["parceiro", "Partner account and documents"],
            ] as const
          ).map(([k, rotulo]) => (
            <Interruptor key={k} rotulo={rotulo} ligado={a.acessos[k]} onChange={(v) => acesso(k, v)} />
          ))}
        </div>
        <div className="space-y-2">
          <p className="text-sm font-medium text-text-primary">Payments (Stripe)</p>
          <p className="text-xs text-text-tertiary">How Harvey takes payment on WhatsApp. Prices always come from the price list.</p>
          <Interruptor rotulo="Send Stripe card links" ligado={a.pagamento.link} onChange={(v) => pagar({ link: v })} />
          <label className="flex items-center justify-between gap-3 text-sm text-text-secondary">
            The card link asks for
            <select className={SELECT} value={a.pagamento.modo} disabled={!a.pagamento.link} onChange={(e) => pagar({ modo: e.target.value as AjustesDoHarvey["pagamento"]["modo"] })}>
              <option value="deposito">50% now, 50% after the job</option>
              <option value="total">Full price now</option>
              <option value="cliente">Customer chooses</option>
            </select>
          </label>
          <Interruptor rotulo="Accept discount codes" ligado={a.pagamento.cupons} onChange={(v) => pagar({ cupons: v })} />
        </div>
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
          <Button size="sm" variant="outline" onClick={() => setA(base())}>
            Discard changes
          </Button>
        ) : null}
      </div>
    </section>
  );
}

type AutonomiaNaTela = Autonomia & { atualizado_em: string | null; atualizado_por: string | null; teto: Record<AreaDeAutonomia, ModoDeAutonomia> };

const AREAS_NA_TELA: Array<[AreaDeAutonomia, string, string]> = [
  ["cotacao", "Classify and invite partners", "A request that needs a quote goes to every partner who covers the trade and postcode."],
  ["lances", "Price partner bids", "Reads bids from the portal and from partner emails and turns the best one into our price."],
  ["envio", "Send the price to the customer", "The priced quote goes out on its own (WhatsApp or email), up to the limit below."],
  ["b2b_hora", "Accept B2B hourly jobs", "Business account asks for hourly work: accepted at the account's own rate, job left unassigned."],
  ["perguntas", "Relay questions", "Partner question goes to the customer and the answer goes back, without the team."],
  ["aceite", "Read approvals by email", "\"Approved / go ahead\" on a sent quote creates the job and tells the partner."],
];
const ROTULO_DO_MODO: Record<ModoDeAutonomia, string> = { on: "On", ensaio: "Dry run", off: "Off" };
const NIVEL: Record<ModoDeAutonomia, number> = { off: 0, ensaio: 1, on: 2 };

/** O que o Harvey faz sozinho: Pausar tudo, uma linha por área (on, ensaio, off), teto e regras. */
function CartaoDeAutonomia({ inicial, regras, onSalvo }: { inicial: AutonomiaNaTela; regras: { texto: string; padrao: string; editado: boolean }; onSalvo: () => void }) {
  const base = (): Autonomia => ({ geral: inicial.geral, areas: { ...inicial.areas }, tetoEnvio: inicial.tetoEnvio });
  const [a, setA] = useState<Autonomia>(base);
  const [texto, setTexto] = useState(regras.texto);
  const [ocupado, setOcupado] = useState<string | null>(null);
  const mudou = JSON.stringify(a) !== JSON.stringify(base()) || texto.trim() !== regras.texto.trim();

  async function enviar(corpo: Record<string, unknown>, ok: string, qual: string) {
    setOcupado(qual);
    try {
      const res = await fetch("/api/agents/harvey/autonomia", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      toast.success(ok);
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(null);
    }
  }

  const SELECT = "h-9 rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary focus:border-primary focus:outline-none";
  return (
    <section className="space-y-4 rounded-xl border border-border-light bg-card p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-text-primary">Autonomy</h2>
          <p className="text-xs text-text-tertiary">
            What Harvey does on his own across Zendesk, WhatsApp and quotes. Dry run means he writes what he would do as an internal note and sends nothing.
          </p>
          <p className="mt-1 text-xs text-text-tertiary">
            {inicial.atualizado_em ? `Last changed by ${inicial.atualizado_por ?? "team"}, ${quando(inicial.atualizado_em)}` : "Default settings"}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {inicial.geral ? <Badge variant="success" dot>Running</Badge> : <Badge variant="warning">Everything paused</Badge>}
          <Button
            variant={inicial.geral ? "danger" : "primary"}
            loading={ocupado === "geral"}
            onClick={() =>
              enviar(
                { acao: inicial.geral ? "pausar_tudo" : "ligar_tudo" },
                inicial.geral ? "Harvey paused everywhere: the team does it by hand" : "Harvey is running again",
                "geral",
              )
            }
          >
            {inicial.geral ? "Pause everything" : "Turn everything back on"}
          </Button>
        </div>
      </div>

      <ul className={`divide-y divide-border-light ${inicial.geral ? "" : "opacity-60"}`}>
        {AREAS_NA_TELA.map(([area, rotulo, ajuda]) => {
          const teto = inicial.teto[area];
          const limitado = NIVEL[teto] < NIVEL[a.areas[area]];
          return (
            <li key={area} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
              <div className="min-w-0 flex-1">
                <p className="text-sm text-text-primary">{rotulo}</p>
                <p className="text-xs text-text-tertiary">{ajuda}</p>
                {limitado ? <p className="text-xs text-amber-700 dark:text-amber-300">Held at {ROTULO_DO_MODO[teto].toLowerCase()} by the server setting.</p> : null}
              </div>
              <select className={SELECT} value={a.areas[area]} onChange={(e) => setA({ ...a, areas: { ...a.areas, [area]: e.target.value as ModoDeAutonomia } })}>
                <option value="on">On</option>
                <option value="ensaio">Dry run</option>
                <option value="off">Off</option>
              </select>
            </li>
          );
        })}
      </ul>

      <label className="flex flex-wrap items-center justify-between gap-3 text-sm text-text-secondary">
        <span>
          <span className="block text-sm text-text-primary">Most he sends on his own</span>
          <span className="block text-xs text-text-tertiary">Quotes above this go to the team to send.</span>
        </span>
        <span className="flex items-center gap-1">
          £
          <input
            type="number"
            min={50}
            step={50}
            className={`${SELECT} w-28`}
            placeholder="600"
            value={a.tetoEnvio ?? ""}
            onChange={(e) => setA({ ...a, tetoEnvio: e.target.value ? Number(e.target.value) : null })}
          />
        </span>
      </label>

      <div className="space-y-1.5">
        <p className="text-sm text-text-primary">How Fixfy sells and prices</p>
        <p className="text-xs text-text-tertiary">Every Harvey reads this before deciding: WhatsApp, the email quoter and the price list matcher.</p>
        <textarea
          className="min-h-[180px] w-full rounded-lg border border-border bg-card p-3 text-sm text-text-primary focus:border-primary focus:outline-none"
          value={texto}
          onChange={(e) => setTexto(e.target.value)}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          disabled={!mudou}
          loading={ocupado === "salvar"}
          onClick={() => enviar({ autonomia: a, regras: texto.trim() === regras.padrao.trim() ? "" : texto }, "Saved: Harvey uses it within 30 seconds", "salvar")}
        >
          Save
        </Button>
        {mudou ? (
          <Button size="sm" variant="outline" onClick={() => { setA(base()); setTexto(regras.texto); }}>
            Discard changes
          </Button>
        ) : null}
        {regras.editado ? (
          <Button size="sm" variant="ghost" onClick={() => setTexto(regras.padrao)}>
            Reset rules to default
          </Button>
        ) : null}
      </div>
    </section>
  );
}

type Papeis = PapeisDaEquipe & { atualizado_em: string | null; atualizado_por: string | null };
type AgenteZd = { id: number; name: string; email: string | null };

const PAPEIS_NA_TELA: Array<[PapelDaEquipe, string, string]> = [
  ["operacao", "Operations owner", "Complaints and operations hand-offs are assigned to them (Needs Attention)."],
  ["autor_emails", "Sender of chase emails", "Quote and lead follow-up emails go out in their name, with their Zendesk signature."],
  ["autor_aviso_cotacao", "Sender of quote notices", "Signs the \"we're working on a quote\" reply and quotes sent by email."],
  ["vendas", "Sales owner", "Owns tickets until they become a job: Lead, Needs Quote, Bidding, Quote Ready, Approval, Deposit Pending."],
  ["financeiro", "Finance owner", "Owns payment tickets: Awaiting Payment, Payment Failed, Finance."],
];

/** Papéis da equipe: quem faz cada coisa é ajuste, não pessoa no código (dono, 15/10/2026). Só admin edita. */
function CartaoDePapeis({ inicial, onSalvo }: { inicial: Papeis; onSalvo: () => void }) {
  const base = () => Object.fromEntries(PAPEIS_NA_TELA.map(([p]) => [p, inicial[p].zendesk_user_id])) as Record<PapelDaEquipe, number>;
  const [escolha, setEscolha] = useState<Record<PapelDaEquipe, number>>(base);
  const [agentes, setAgentes] = useState<AgenteZd[] | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const mudou = JSON.stringify(escolha) !== JSON.stringify(base());

  useEffect(() => {
    let vivo = true;
    fetch("/api/agents/harvey/papeis")
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { agentes?: AgenteZd[]; error?: string };
        if (!vivo) return;
        if (!r.ok) setAviso(j.error ?? `Could not load Zendesk agents (${r.status})`);
        else setAgentes(j.agentes ?? []);
      })
      .catch(() => vivo && setAviso("Could not load Zendesk agents"));
    return () => {
      vivo = false;
    };
  }, []);

  async function salvarPapeis() {
    setOcupado(true);
    try {
      const res = await fetch("/api/agents/harvey/papeis", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(escolha) });
      const j = (await res.json().catch(() => ({}))) as { error?: string };
      if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
      toast.success("Team roles saved: they apply within a minute");
      onSalvo();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(false);
    }
  }

  const SELECT = "h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary focus:border-primary focus:outline-none";
  return (
    <section className="space-y-4 rounded-xl border border-border-light bg-card p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold text-text-primary">Team roles</h2>
        <span className="text-xs text-text-tertiary">
          {inicial.atualizado_em ? `Last changed by ${inicial.atualizado_por ?? "team"}, ${quando(inicial.atualizado_em)}` : "Default roles"}
        </span>
      </div>
      <div className="grid gap-4 md:grid-cols-3">
        {PAPEIS_NA_TELA.map(([papel, rotulo, nota]) => (
          <label key={papel} className="space-y-1.5">
            <span className="block text-sm font-medium text-text-primary">{rotulo}</span>
            <span className="block text-xs text-text-tertiary">{nota}</span>
            {agentes ? (
              <select className={SELECT} value={escolha[papel]} onChange={(e) => setEscolha({ ...escolha, [papel]: Number(e.target.value) })}>
                {agentes.some((a) => a.id === escolha[papel]) ? null : <option value={escolha[papel]}>{inicial[papel].nome}</option>}
                {agentes.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.name}
                    {a.email ? ` (${a.email})` : ""}
                  </option>
                ))}
              </select>
            ) : (
              <span className="block text-sm text-text-secondary">{inicial[papel].nome}</span>
            )}
          </label>
        ))}
      </div>
      {aviso ? <p className="text-xs text-text-tertiary">{aviso}</p> : null}
      {agentes ? (
        <div className="flex items-center gap-2">
          <Button size="sm" disabled={!mudou} loading={ocupado} onClick={salvarPapeis}>
            Save roles
          </Button>
          {mudou ? (
            <Button size="sm" variant="outline" onClick={() => setEscolha(base())}>
              Discard changes
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}

function Interruptor({ rotulo, ligado, onChange }: { rotulo: string; ligado: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 text-sm text-text-secondary">
      {rotulo}
      <button
        type="button"
        role="switch"
        aria-checked={ligado}
        onClick={() => onChange(!ligado)}
        className={`relative h-5 w-9 shrink-0 rounded-full transition-colors ${ligado ? "bg-emerald-500" : "bg-border"}`}
      >
        <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${ligado ? "left-[18px]" : "left-0.5"}`} />
      </button>
    </label>
  );
}

/** O quadro do topo, gerado dos ajustes: nunca diz algo que ele não faz. */
function podeENaoPode(a: AjustesDoHarvey): { pode: string[]; naoPode: string[] } {
  const pode: string[] = [];
  const naoPode: string[] = ["Give discounts or change prices", "Cancel or move bookings (the team does)", "Book same day or Sundays"];
  (a.acessos.precos ? pode : naoPode).push("Quote from the price list");
  (a.acessos.agenda ? pode : naoPode).push("Offer free days from the diary");
  if (a.pagamento.link) {
    pode.push(a.pagamento.modo === "total" ? "Send a Stripe link for the full price" : a.pagamento.modo === "cliente" ? "Send a Stripe link, 50% or full (customer chooses)" : "Send a Stripe link for 50% now");
  } else naoPode.push("Send payment links (the team does)");
  (a.acessos.reservas ? pode : naoPode).push("Tell customers about their bookings");
  (a.acessos.cotacao ? pode : naoPode).push("Ask the team for a photo quote");
  (a.acessos.parceiro ? pode : naoPode).push("Check and approve partner documents");
  if (a.transferencia === "equipe") pode.push("Pass bank transfer requests to the team");
  else naoPode.push("Take bank transfers (card only)");
  (a.pagamento.cupons ? pode : naoPode).push(a.pagamento.cupons ? "Apply discount codes the customer gives" : "Apply discount codes");
  if (a.cincoQuartos === "tabela") pode.push("Quote 5+ bedrooms from the price list");
  return { pode, naoPode };
}
