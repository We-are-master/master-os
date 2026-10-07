"use client";

/**
 * Editor da tabela de preços. Uma tela só, por seção, como o cliente vê no
 * site: tamanhos, limpeza (grade tipo × tamanho), banheiros, extras, pintura,
 * reparos e certificados. Campo vazio na grade = "Quote" (sob consulta).
 * Save grava uma versão nova; preço que muda mais de 30% pede confirmação.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TabelaDePrecos, Versao } from "@/lib/os-documentos";

type VersaoResumo = Omit<Versao<unknown>, "documento">;

const quando = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const CAMPO = "h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none";
const NUM = "h-9 w-full rounded-lg border border-border bg-card px-2 text-right text-sm tabular-nums text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none";

async function postar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/os-documentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string; confirmar?: string[] };
  return { ok: res.ok, status: res.status, ...j };
}

export function EditorDaTabela({ atual, versoes }: { atual: Versao<TabelaDePrecos>; versoes: VersaoResumo[] }) {
  const router = useRouter();
  const [t, setT] = useState<TabelaDePrecos>(() => structuredClone(atual.documento));
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const mudou = JSON.stringify(t) !== JSON.stringify(atual.documento);

  /** Muda uma cópia e guarda: o estado nunca é mexido direto. */
  const muda = (fn: (d: TabelaDePrecos) => void) =>
    setT((velho) => {
      const d = structuredClone(velho);
      fn(d);
      return d;
    });

  async function salvar(confirmado = false) {
    setOcupado(true);
    try {
      const r = await postar({ tipo: "tabela_de_precos", documento: t, nota, confirmar: confirmado });
      if (r.status === 409 && r.confirmar) {
        setConfirmar(r.confirmar);
        return;
      }
      if (!r.ok) throw new Error(r.error ?? "Could not save");
      toast.success("Saved: the website, checkout and Harvey use it within about a minute");
      setConfirmar(null);
      setNota("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(id: number) {
    if (!window.confirm(`Restore version ${id}? It becomes the live price list.`)) return;
    const r = await postar({ tipo: "tabela_de_precos", restaurar: id });
    if (!r.ok) return toast.error(r.error ?? "Could not restore");
    toast.success(`Version ${id} is live again`);
    router.refresh();
  }

  const tamanhos = t.sizes;

  return (
    <PageTransition>
      <div className="space-y-6 p-6 pb-28">
        <PageHeader
          title="Price list"
          subtitle="The website, the online checkout and Harvey all quote from this list. Saved changes go live within about a minute."
        >
          <Badge variant="info">{`Live: version ${atual.id} · ${atual.criado_por ?? "system"}, ${quando(atual.criado_em)}`}</Badge>
        </PageHeader>

        <Secao titulo="Property sizes" ajuda="Sizes switched off do not show on the website and cannot be booked. A team of two goes from the size you pick.">
          <div className="grid gap-2 md:grid-cols-2">
            {tamanhos.map((s, i) => (
              <div key={s.id} className="flex items-center gap-2">
                <input
                  type="checkbox"
                  className="h-4 w-4 accent-[var(--color-primary,#ED4B00)]"
                  checked={s.ativo !== false}
                  onChange={(e) => muda((d) => void (d.sizes[i].ativo = e.target.checked))}
                  aria-label={`${s.label} on the website`}
                />
                <input className={CAMPO} value={s.label} onChange={(e) => muda((d) => void (d.sizes[i].label = e.target.value))} />
                <input className={`${CAMPO} max-w-24`} value={s.short} onChange={(e) => muda((d) => void (d.sizes[i].short = e.target.value))} title="Short label" />
              </div>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm text-text-secondary">
            Team of two from
            <select className={`${CAMPO} max-w-40`} value={t.clean.teamOfTwoFromSize} onChange={(e) => muda((d) => void (d.clean.teamOfTwoFromSize = e.target.value))}>
              {tamanhos.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.label}
                </option>
              ))}
            </select>
          </label>
        </Secao>

        <Secao titulo="Cleaning" ajuda="Price per size for each type. Leave a box empty to show Quote (the customer asks for a price). Greyed columns are sizes switched off.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="text-left text-xs text-text-tertiary">
                <tr>
                  <th className="min-w-[240px] py-2 pr-3 font-medium">Type</th>
                  {tamanhos.map((s) => (
                    <th key={s.id} className={`py-2 pr-2 text-right font-medium ${s.ativo === false ? "opacity-40" : ""}`}>
                      {s.short}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {t.clean.kinds.map((k, ki) => (
                  <tr key={k.id} className="border-t border-border-light align-top">
                    <td className="space-y-1.5 py-2 pr-3">
                      <input className={CAMPO} value={k.name} onChange={(e) => muda((d) => void (d.clean.kinds[ki].name = e.target.value))} />
                      <input className={CAMPO} value={k.detail} onChange={(e) => muda((d) => void (d.clean.kinds[ki].detail = e.target.value))} title="Website line" />
                    </td>
                    {tamanhos.map((s) => (
                      <td key={s.id} className={`py-2 pr-2 ${s.ativo === false ? "opacity-40" : ""}`}>
                        <Preco valor={k.prices[s.id] ?? null} cotacao onChange={(v) => muda((d) => void (d.clean.kinds[ki].prices[s.id] = v))} />
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <label className="space-y-1.5 text-sm">
              <span className="text-text-secondary">Bathrooms included in the price</span>
              <input type="number" min={1} className={`${NUM} max-w-24`} value={t.clean.includedBathrooms} onChange={(e) => muda((d) => void (d.clean.includedBathrooms = Number(e.target.value)))} />
            </label>
            <div className="space-y-1.5 text-sm">
              <span className="text-text-secondary">Each extra bathroom (2nd, 3rd, 4th and over)</span>
              <div className="flex gap-2">
                {t.clean.extraBathroomSteps.map((v, i) => (
                  <Preco key={i} valor={v} onChange={(n) => muda((d) => void (d.clean.extraBathroomSteps[i] = n ?? 0))} />
                ))}
              </div>
            </div>
          </div>
        </Secao>

        <Secao titulo="Cleaning extras" ajuda="Add-ons the customer can pick on top of any clean.">
          <Linhas
            itens={t.clean.extras.map((e, i) => ({
              chave: e.id,
              nome: e.label,
              detalhe: e.detail,
              preco: e.price,
              sufixo: e.unit ? "per room" : undefined,
              onNome: (v: string) => muda((d) => void (d.clean.extras[i].label = v)),
              onDetalhe: (v: string) => muda((d) => void (d.clean.extras[i].detail = v)),
              onPreco: (v: number | null) => muda((d) => void (d.clean.extras[i].price = v ?? 0)),
            }))}
          />
        </Secao>

        <Secao titulo="Painting" ajuda="Touch-ups is a fixed price; full repaint is per room. The materials pack is optional.">
          <Linhas
            itens={[
              ...t.paint.options.map((o, i) => ({
                chave: o.id,
                nome: o.label,
                detalhe: o.detail,
                preco: o.price,
                sufixo: o.unit ? "per room" : undefined,
                onNome: (v: string) => muda((d) => void (d.paint.options[i].label = v)),
                onDetalhe: (v: string) => muda((d) => void (d.paint.options[i].detail = v)),
                onPreco: (v: number | null) => muda((d) => void (d.paint.options[i].price = v ?? 0)),
              })),
              {
                chave: "materials",
                nome: t.paint.materials.label,
                detalhe: t.paint.materials.detail,
                preco: t.paint.materials.price,
                onNome: (v: string) => muda((d) => void (d.paint.materials.label = v)),
                onDetalhe: (v: string) => muda((d) => void (d.paint.materials.detail = v)),
                onPreco: (v: number | null) => muda((d) => void (d.paint.materials.price = v ?? 0)),
              },
            ]}
          />
        </Secao>

        <Secao titulo="Repairs (handyman)" ajuda="Sold by time only. Tools are included and there is no call out fee; materials are never included.">
          <Linhas
            itens={t.fix.packages.map((p, i) => ({
              chave: p.id,
              nome: p.label,
              detalhe: p.detail,
              preco: p.price,
              onNome: (v: string) => muda((d) => void (d.fix.packages[i].label = v)),
              onDetalhe: (v: string) => muda((d) => void (d.fix.packages[i].detail = v)),
              onPreco: (v: number | null) => muda((d) => void (d.fix.packages[i].price = v ?? 0)),
            }))}
          />
        </Secao>

        <Secao titulo="Landlord certificates" ajuda="A fixed price, or a price per size. Leave a size empty to show Quote.">
          <div className="space-y-4">
            {t.cert.items.map((c, ci) => (
              <div key={c.id} className="space-y-2 rounded-lg border border-border-light p-3">
                <div className="grid gap-2 md:grid-cols-3">
                  <input className={CAMPO} value={c.label} onChange={(e) => muda((d) => void (d.cert.items[ci].label = e.target.value))} />
                  <input className={CAMPO} value={c.detail} onChange={(e) => muda((d) => void (d.cert.items[ci].detail = e.target.value))} title="Website line" />
                  <input className={CAMPO} value={c.valid} onChange={(e) => muda((d) => void (d.cert.items[ci].valid = e.target.value))} title="How long it lasts" />
                </div>
                {c.prices ? (
                  <div className="grid grid-cols-3 gap-2 md:grid-cols-11">
                    {tamanhos.map((s) => (
                      <label key={s.id} className={`space-y-1 text-xs text-text-tertiary ${s.ativo === false ? "opacity-40" : ""}`}>
                        {s.short}
                        <Preco valor={c.prices?.[s.id] ?? null} cotacao onChange={(v) => muda((d) => void ((d.cert.items[ci].prices as Record<string, number | null>)[s.id] = v))} />
                      </label>
                    ))}
                  </div>
                ) : (
                  <div className="max-w-32">
                    <Preco valor={c.price ?? null} onChange={(v) => muda((d) => void (d.cert.items[ci].price = v))} />
                  </div>
                )}
              </div>
            ))}
          </div>
        </Secao>

        <Secao titulo="History" ajuda="Every save is a version. Restore puts an older version live again (as a new version, so nothing is lost).">
          <ul className="divide-y divide-border-light text-sm">
            {versoes.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-text-primary">Version {v.id}</span>
                  <span className="text-text-tertiary">{` · ${v.criado_por ?? "system"}, ${quando(v.criado_em)}${v.nota ? ` · ${v.nota}` : ""}`}</span>
                </span>
                {v.id === atual.id ? (
                  <Badge variant="success">Live</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => restaurar(v.id)}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </Secao>
      </div>

      {mudou || confirmar ? (
        <div className="fixed inset-x-0 bottom-0 z-30 border-t border-border bg-card/95 px-6 py-3 backdrop-blur">
          {confirmar ? (
            <div className="mb-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
              <p className="font-medium">These prices change by more than 30%. Typo?</p>
              <ul className="mt-1 list-disc pl-5">
                {confirmar.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap items-center gap-2">
            <input className={`${CAMPO} max-w-md`} placeholder="What changed? (optional)" value={nota} onChange={(e) => setNota(e.target.value)} />
            {confirmar ? (
              <Button loading={ocupado} onClick={() => salvar(true)}>
                Yes, save these prices
              </Button>
            ) : (
              <Button loading={ocupado} onClick={() => salvar(false)}>
                Save and go live
              </Button>
            )}
            <Button
              variant="outline"
              onClick={() => {
                setT(structuredClone(atual.documento));
                setConfirmar(null);
              }}
            >
              Discard changes
            </Button>
          </div>
        </div>
      ) : null}
    </PageTransition>
  );
}

function Secao({ titulo, ajuda, children }: { titulo: string; ajuda: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-border-light bg-card p-4">
      <h2 className="font-medium text-text-primary">{titulo}</h2>
      <p className="mb-3 text-xs text-text-tertiary">{ajuda}</p>
      {children}
    </section>
  );
}

/** Preço em libras. Com `cotacao`, vazio = null (Quote). */
function Preco({ valor, onChange, cotacao = false }: { valor: number | null; onChange: (v: number | null) => void; cotacao?: boolean }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">£</span>
      <input
        inputMode="decimal"
        className={`${NUM} pl-5`}
        placeholder={cotacao ? "Quote" : "0"}
        value={valor ?? ""}
        onChange={(e) => {
          const s = e.target.value.replace(/[^\d.]/g, "");
          onChange(s === "" ? (cotacao ? null : 0) : Number(s));
        }}
      />
    </div>
  );
}

type Item = {
  chave: string;
  nome: string;
  detalhe: string;
  preco: number;
  sufixo?: string;
  onNome: (v: string) => void;
  onDetalhe: (v: string) => void;
  onPreco: (v: number | null) => void;
};

function Linhas({ itens }: { itens: Item[] }) {
  return (
    <div className="space-y-2">
      {itens.map((i) => (
        <div key={i.chave} className="grid items-center gap-2 md:grid-cols-[1fr_2fr_140px]">
          <input className={CAMPO} value={i.nome} onChange={(e) => i.onNome(e.target.value)} />
          <input className={CAMPO} value={i.detalhe} onChange={(e) => i.onDetalhe(e.target.value)} />
          <div className="flex items-center gap-2">
            <Preco valor={i.preco} onChange={i.onPreco} />
            {i.sufixo ? <span className="shrink-0 text-xs text-text-tertiary">{i.sufixo}</span> : null}
          </div>
        </div>
      ))}
    </div>
  );
}
