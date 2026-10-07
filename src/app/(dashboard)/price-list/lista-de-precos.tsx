"use client";

/**
 * Price list em lista (dono, 07/10/2026): uma linha por serviço, "Add service"
 * abre a gaveta com o passo a passo (o quê → como cobra → preços → extras →
 * descrição). Editar abre a mesma gaveta com tudo preenchido. Nada vai ao ar
 * até "Save and go live", que grava uma versão nova (com a trava de 30%).
 */

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import type { Versao } from "@/lib/os-documentos";
import {
  CATEGORIAS,
  NOME_DA_COBRANCA,
  TIPOS_DE_PACOTE,
  vaiProSite,
  type Categoria,
  type Cobranca,
  type Extra,
  type Pacote,
  type ServicoV2,
  type TabelaV2,
  type TipoDePacote,
} from "@/lib/tabela-v2";

type VersaoResumo = Omit<Versao<unknown>, "documento">;

/** O site precisa destes para funcionar: não dá para desligar nem apagar. */
const ESSENCIAIS = new Set(["eot", "deep", "after", "touchup", "rooms", "fix", "gas", "eicr", "epc"]);

const CAMPO = "h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none";
const quando = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
/** Sufixo aleatório para ids novos (só em clique, nunca na renderização). */
function sufixo(n = 4): string {
  return Math.random().toString(36).slice(2, 2 + n);
}
const novoId = (nome: string) => `${nome.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 24) || "service"}_${sufixo(4)}`;
const nomeDaCategoria = (c: Categoria) => CATEGORIAS.find((x) => x.id === c)?.nome ?? c;

function resumoDoPreco(s: ServicoV2, t: TabelaV2): string {
  const gbp = (n: number | null | undefined) => (n == null ? "Quote" : `£${n}`);
  if (s.cobranca === "por_tamanho") {
    const vals = t.tamanhos.map((z) => s.precosPorTamanho?.[z.id]).filter((v): v is number => typeof v === "number");
    return vals.length ? `from £${Math.min(...vals)} · ${vals.length} sizes` : "Quote";
  }
  if (s.cobranca === "pacotes") return (s.pacotes ?? []).map((p) => `${p.rotulo} ${gbp(p.preco)}`).join(" · ") || "No prices yet";
  if (s.cobranca === "por_unidade") return `${gbp(s.preco)} per ${s.unidade || "unit"}`;
  return gbp(s.preco);
}

async function postar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/os-documentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string; confirmar?: string[] };
  return { ok: res.ok, status: res.status, ...j };
}

export function ListaDePrecos({
  versao,
  inicial,
  versoes,
  tiposDeTrabalho,
}: {
  versao: { id: number; criado_em: string; criado_por: string | null };
  inicial: TabelaV2;
  versoes: VersaoResumo[];
  tiposDeTrabalho: string[];
}) {
  const router = useRouter();
  const [t, setT] = useState<TabelaV2>(() => structuredClone(inicial));
  const [aberto, setAberto] = useState<{ servico: ServicoV2; novo: boolean } | null>(null);
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [confirmar, setConfirmar] = useState<string[] | null>(null);
  const mudou = JSON.stringify(t) !== JSON.stringify(inicial);
  const porCategoria = useMemo(() => CATEGORIAS.map((c) => ({ ...c, servicos: t.servicos.filter((s) => s.categoria === c.id) })).filter((c) => c.servicos.length), [t]);

  function aplicar(s: ServicoV2, novo: boolean, ligarTamanhos: string[]) {
    setT((velho) => {
      const d = structuredClone(velho);
      for (const id of ligarTamanhos) {
        const z = d.tamanhos.find((x) => x.id === id);
        if (z) z.ativo = true;
      }
      if (novo) d.servicos.push(s);
      else d.servicos = d.servicos.map((x) => (x.id === s.id ? s : x));
      return d;
    });
    setAberto(null);
  }

  function apagar(id: string) {
    setT((velho) => ({ ...velho, servicos: velho.servicos.filter((s) => s.id !== id) }));
    setAberto(null);
  }

  async function salvar(confirmado = false) {
    setOcupado(true);
    try {
      const r = await postar({ tipo: "tabela_de_precos", documento: t, nota, confirmar: confirmado });
      if (r.status === 409 && r.confirmar) return setConfirmar(r.confirmar);
      if (!r.ok) throw new Error(r.error ?? "Could not save");
      toast.success("Live: the website, checkout and Harvey use it within about a minute");
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

  function novoServico() {
    setAberto({
      novo: true,
      servico: { id: "", nome: "", categoria: "cleaning", descricao: "", osTitle: "", cobranca: "por_tamanho", precosPorTamanho: {}, extras: [], ativo: true },
    });
  }

  return (
    <PageTransition>
      <div className="space-y-6 p-6 pb-28">
        <PageHeader title="Price list" subtitle="Every service Fixfy sells and how it is charged. The website, the checkout and Harvey all use this list.">
          <div className="flex items-center gap-2">
            <Badge variant="info">{`Live: version ${versao.id} · ${versao.criado_por ?? "system"}, ${quando(versao.criado_em)}`}</Badge>
            <Button onClick={novoServico}>
              <Plus className="h-4 w-4" /> Add service
            </Button>
          </div>
        </PageHeader>

        <div className="overflow-x-auto rounded-xl border border-border-light bg-card">
          <table className="w-full min-w-[860px] text-sm">
            <thead className="bg-surface-secondary text-left text-xs text-text-tertiary">
              <tr>
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">How it is charged</th>
                <th className="px-4 py-3 font-medium">Prices</th>
                <th className="px-4 py-3 font-medium">Extras</th>
                <th className="px-4 py-3 font-medium">Where</th>
              </tr>
            </thead>
            {porCategoria.map((c) => (
              <tbody key={c.id}>
                <tr className="border-t border-border-light">
                  <td colSpan={5} className="bg-surface-secondary/50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-text-tertiary">
                    {c.nome}
                  </td>
                </tr>
                {c.servicos.map((s) => (
                  <tr key={s.id} className="cursor-pointer border-t border-border-light hover:bg-surface-hover" onClick={() => setAberto({ servico: structuredClone(s), novo: false })}>
                    <td className="px-4 py-3">
                      <p className="font-medium text-text-primary">{s.nome}</p>
                      <p className="max-w-xs truncate text-xs text-text-tertiary">{s.descricao}</p>
                    </td>
                    <td className="px-4 py-3 text-text-secondary">{NOME_DA_COBRANCA[s.cobranca]}</td>
                    <td className="px-4 py-3 tabular-nums text-text-primary">{resumoDoPreco(s, t)}</td>
                    <td className="px-4 py-3 text-text-secondary">{s.extras.length || "None"}</td>
                    <td className="px-4 py-3">
                      {!s.ativo ? <Badge>Off</Badge> : vaiProSite(s) ? <Badge variant="success">Website + Harvey</Badge> : <Badge variant="warning">Harvey only</Badge>}
                    </td>
                  </tr>
                ))}
              </tbody>
            ))}
          </table>
        </div>
        <p className="text-xs text-text-tertiary">
          Harvey only: the website cannot sell it by itself yet (per hour, call-out, week, month, other services, extras outside cleaning). Harvey quotes it and passes to the team to book.
        </p>

        <RegrasDeLimpeza t={t} setT={setT} />

        <section className="rounded-xl border border-border-light bg-card p-4">
          <h2 className="font-medium text-text-primary">History</h2>
          <p className="mb-3 text-xs text-text-tertiary">Every save is a version. Restore puts an older version live again.</p>
          <ul className="divide-y divide-border-light text-sm">
            {versoes.map((v) => (
              <li key={v.id} className="flex items-center justify-between gap-4 py-2">
                <span className="min-w-0 truncate">
                  <span className="font-medium text-text-primary">Version {v.id}</span>
                  <span className="text-text-tertiary">{` · ${v.criado_por ?? "system"}, ${quando(v.criado_em)}${v.nota ? ` · ${v.nota}` : ""}`}</span>
                </span>
                {v.id === versao.id ? (
                  <Badge variant="success">Live</Badge>
                ) : (
                  <Button size="sm" variant="outline" onClick={() => restaurar(v.id)}>
                    Restore
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </div>

      {aberto ? (
        <EditorDeServico
          key={aberto.servico.id || "novo"}
          inicial={aberto.servico}
          novo={aberto.novo}
          tabela={t}
          tiposDeTrabalho={tiposDeTrabalho}
          onFechar={() => setAberto(null)}
          onAplicar={aplicar}
          onApagar={apagar}
        />
      ) : null}

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
            <span className="text-sm text-text-secondary">Changes are not live yet.</span>
            <input className={`${CAMPO} max-w-md`} placeholder="What changed? (optional)" value={nota} onChange={(e) => setNota(e.target.value)} />
            <Button loading={ocupado} onClick={() => salvar(Boolean(confirmar))}>
              {confirmar ? "Yes, save these prices" : "Save and go live"}
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setT(structuredClone(inicial));
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

// ── a gaveta: criar (passo a passo) ou editar ───────────────────────────────

function EditorDeServico({
  inicial,
  novo,
  tabela,
  tiposDeTrabalho,
  onFechar,
  onAplicar,
  onApagar,
}: {
  inicial: ServicoV2;
  novo: boolean;
  tabela: TabelaV2;
  tiposDeTrabalho: string[];
  onFechar: () => void;
  onAplicar: (s: ServicoV2, novo: boolean, ligarTamanhos: string[]) => void;
  onApagar: (id: string) => void;
}) {
  const [s, setS] = useState<ServicoV2>(inicial);
  const [passo, setPasso] = useState(novo ? 1 : 5);
  const [temExtras, setTemExtras] = useState(inicial.extras.length > 0);
  const essencial = ESSENCIAIS.has(inicial.id);
  const categoria = CATEGORIAS.find((c) => c.id === s.categoria)!;
  const muda = (p: Partial<ServicoV2>) => setS((x) => ({ ...x, ...p }));

  // Tamanhos que aparecem nas linhas: os ligados no site + os que já têm preço neste serviço.
  const [extrasDeTamanho, setExtrasDeTamanho] = useState<string[]>([]);
  const tamanhosVisiveis = tabela.tamanhos.filter((z) => z.ativo !== false || s.precosPorTamanho?.[z.id] != null || extrasDeTamanho.includes(z.id));
  const proximoTamanho = tabela.tamanhos.find((z) => !tamanhosVisiveis.includes(z));
  const ligarTamanhos = tabela.tamanhos.filter((z) => z.ativo === false && typeof s.precosPorTamanho?.[z.id] === "number").map((z) => z.id);

  const podeAvancar =
    passo === 1 ? s.nome.trim().length > 1 : passo === 2 ? Boolean(s.cobranca) : passo === 3 ? true : passo === 4 ? true : s.descricao.trim().length > 0 && s.osTitle.trim().length > 0;

  function escolherCategoria(c: Categoria) {
    const cob = CATEGORIAS.find((x) => x.id === c)!.cobrancas[0];
    muda({
      categoria: c,
      cobranca: cob,
      osTitle: s.osTitle || (c === "cleaning" ? "Cleaning" : c === "handyman" ? "General Maintenance" : c === "painting" ? "Painter" : ""),
    });
  }

  function escolherCobranca(c: Cobranca) {
    muda({
      cobranca: c,
      ...(c === "por_tamanho" && !s.precosPorTamanho ? { precosPorTamanho: {} } : {}),
      ...(c === "pacotes" && !s.pacotes?.length ? { pacotes: [] } : {}),
      ...(c === "por_unidade" && !s.unidade ? { unidade: "room", maxUnidades: 8 } : {}),
    });
  }

  function addPacote(tipo: TipoDePacote) {
    const info = TIPOS_DE_PACOTE.find((t) => t.id === tipo)!;
    const p: Pacote = { id: tipo === "half_day" ? "half" : tipo === "full_day" ? "day" : `${tipo}_${sufixo(3)}`, tipo, rotulo: info.nome, detalhe: info.horas ? `Up to ${info.horas} hours` : "", horas: info.horas, preco: 0 };
    muda({ pacotes: [...(s.pacotes ?? []), p] });
  }

  function aplicar() {
    const final: ServicoV2 = { ...s, id: s.id || novoId(s.nome), extras: temExtras ? s.extras : [] };
    onAplicar(final, novo, ligarTamanhos);
  }


  return (
    <Drawer open onClose={onFechar} title={novo ? "Add service" : s.nome} subtitle={novo ? `Step ${Math.min(passo, 5)} of 5` : nomeDaCategoria(s.categoria)}>
      <div className="space-y-6 p-5">
        {/* 1 · o quê */}
        <Passo n={1} titulo="What is it?" visivel={passo >= 1}>
          <input className={CAMPO} placeholder="Service name, e.g. Oven clean" value={s.nome} onChange={(e) => muda({ nome: e.target.value })} autoFocus={novo} />
          <div className="flex flex-wrap gap-2">
            {CATEGORIAS.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={!novo}
                onClick={() => escolherCategoria(c.id)}
                className={`rounded-full border px-3 py-1 text-sm ${s.categoria === c.id ? "border-primary bg-primary/10 text-primary" : "border-border text-text-secondary"} ${!novo ? "opacity-60" : ""}`}
              >
                {c.nome}
              </button>
            ))}
          </div>
        </Passo>

        {/* 2 · como cobra */}
        <Passo n={2} titulo="How is it charged?" visivel={passo >= 2}>
          <div className="flex flex-wrap gap-2">
            {categoria.cobrancas.map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => escolherCobranca(c)}
                className={`rounded-full border px-3 py-1 text-sm ${s.cobranca === c ? "border-primary bg-primary/10 text-primary" : "border-border text-text-secondary"}`}
              >
                {NOME_DA_COBRANCA[c]}
              </button>
            ))}
          </div>
          {s.cobranca === "pacotes" ? (
            <div className="space-y-1">
              <p className="text-xs text-text-tertiary">Add every way this service can be charged:</p>
              <div className="flex flex-wrap gap-2">
                {TIPOS_DE_PACOTE.map((tp) => (
                  <button key={tp.id} type="button" onClick={() => addPacote(tp.id)} className="rounded-full border border-dashed border-border px-3 py-1 text-sm text-text-secondary hover:border-primary hover:text-primary">
                    + {tp.nome}
                    {!tp.noSite ? " (Harvey only)" : ""}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
        </Passo>

        {/* 3 · preços */}
        <Passo n={3} titulo="Prices" visivel={passo >= 3}>
          {s.cobranca === "por_tamanho" ? (
            <div className="space-y-2">
              {tamanhosVisiveis.map((z, i) => (
                <div key={z.id} className="grid grid-cols-[1fr_140px] items-center gap-2">
                  <span className="text-sm text-text-secondary">
                    {z.label}
                    {i === 0 ? <span className="ml-1 text-xs text-text-tertiary">(base price)</span> : null}
                    {z.ativo === false ? <span className="ml-1 text-xs text-amber-700">(new size: turns on for the website)</span> : null}
                  </span>
                  <Num valor={s.precosPorTamanho?.[z.id]} placeholder="Quote" onChange={(v) => muda({ precosPorTamanho: { ...(s.precosPorTamanho ?? {}), [z.id]: v } })} />
                </div>
              ))}
              {proximoTamanho ? (
                <Button size="sm" variant="outline" onClick={() => setExtrasDeTamanho((x) => [...x, proximoTamanho.id])}>
                  <Plus className="h-4 w-4" /> Add {proximoTamanho.label}
                </Button>
              ) : null}
              <p className="text-xs text-text-tertiary">Leave a size empty to show Quote. Bathrooms, extra bathrooms and team of two are in Cleaning rules below the list.</p>
            </div>
          ) : s.cobranca === "pacotes" ? (
            <div className="space-y-2">
              {(s.pacotes ?? []).length === 0 ? <p className="text-sm text-text-tertiary">Pick at least one way to charge in step 2.</p> : null}
              {(s.pacotes ?? []).map((p, i) => (
                <div key={p.id} className="grid grid-cols-[1fr_90px_120px_32px] items-center gap-2">
                  <input className={CAMPO} value={p.rotulo} onChange={(e) => muda({ pacotes: (s.pacotes ?? []).map((x, j) => (j === i ? { ...x, rotulo: e.target.value } : x)) })} />
                  <input
                    className={CAMPO}
                    placeholder="hours"
                    disabled={!TIPOS_DE_PACOTE.find((t) => t.id === p.tipo)?.noSite}
                    value={p.horas ?? ""}
                    onChange={(e) => muda({ pacotes: (s.pacotes ?? []).map((x, j) => (j === i ? { ...x, horas: e.target.value ? Number(e.target.value) : null } : x)) })}
                    title="Hours"
                  />
                  <Num valor={p.preco} onChange={(v) => muda({ pacotes: (s.pacotes ?? []).map((x, j) => (j === i ? { ...x, preco: v ?? 0 } : x)) })} />
                  <button type="button" aria-label="Remove" onClick={() => muda({ pacotes: (s.pacotes ?? []).filter((_, j) => j !== i) })} className="text-text-tertiary hover:text-red-600">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-[1fr_140px] items-center gap-2">
              <span className="text-sm text-text-secondary">{s.cobranca === "por_unidade" ? `Price per ${s.unidade || "unit"}` : "Price"}</span>
              <Num valor={s.preco} placeholder={s.cobranca === "fixo" ? "Quote" : "0"} onChange={(v) => muda({ preco: v })} />
              {s.cobranca === "por_unidade" ? (
                <>
                  <span className="text-sm text-text-secondary">Unit</span>
                  <input className={CAMPO} value={s.unidade ?? ""} onChange={(e) => muda({ unidade: e.target.value })} placeholder="room" />
                </>
              ) : null}
            </div>
          )}
        </Passo>

        {/* 4 · extras */}
        <Passo n={4} titulo="Does this service have extras?" visivel={passo >= 4}>
          <div className="flex gap-2">
            {[true, false].map((v) => (
              <button key={String(v)} type="button" onClick={() => setTemExtras(v)} className={`rounded-full border px-3 py-1 text-sm ${temExtras === v ? "border-primary bg-primary/10 text-primary" : "border-border text-text-secondary"}`}>
                {v ? "Yes" : "No"}
              </button>
            ))}
          </div>
          {temExtras ? (
            <div className="space-y-2">
              {s.extras.map((e, i) => (
                <div key={e.id} className="space-y-1 rounded-lg border border-border-light p-2">
                  <div className="grid grid-cols-[1fr_120px_32px] items-center gap-2">
                    <input className={CAMPO} placeholder="Extra, e.g. Inside the fridge" value={e.rotulo} onChange={(ev) => muda({ extras: s.extras.map((x, j) => (j === i ? { ...x, rotulo: ev.target.value } : x)) })} />
                    <Num valor={e.preco} onChange={(v) => muda({ extras: s.extras.map((x, j) => (j === i ? { ...x, preco: v ?? 0 } : x)) })} />
                    <button type="button" aria-label="Remove extra" onClick={() => muda({ extras: s.extras.filter((_, j) => j !== i) })} className="text-text-tertiary hover:text-red-600">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                  <div className="grid grid-cols-[1fr_auto] items-center gap-2">
                    <input className={CAMPO} placeholder="What it includes" value={e.detalhe} onChange={(ev) => muda({ extras: s.extras.map((x, j) => (j === i ? { ...x, detalhe: ev.target.value } : x)) })} />
                    <label className="flex items-center gap-1 text-xs text-text-secondary">
                      <input type="checkbox" checked={e.porUnidade} onChange={(ev) => muda({ extras: s.extras.map((x, j) => (j === i ? { ...x, porUnidade: ev.target.checked } : x)) })} />
                      per room
                    </label>
                  </div>
                </div>
              ))}
              <Button
                size="sm"
                variant="outline"
                onClick={() => muda({ extras: [...s.extras, { id: `extra_${sufixo(5)}`, rotulo: "", detalhe: "", preco: 0, porUnidade: false } as Extra] })}
              >
                <Plus className="h-4 w-4" /> Add extra
              </Button>
              {s.categoria === "cleaning" ? <p className="text-xs text-text-tertiary">The website offers cleaning extras on every clean, so an extra must have the same price in every cleaning service.</p> : null}
            </div>
          ) : null}
        </Passo>

        {/* 5 · descrição */}
        <Passo n={5} titulo="Description" visivel={passo >= 5}>
          <textarea
            className={`${CAMPO} h-auto resize-y py-2 leading-relaxed`}
            rows={3}
            placeholder="What it is and who it is for. The website and Harvey use this text."
            value={s.descricao}
            onChange={(e) => muda({ descricao: e.target.value })}
          />
          <label className="block space-y-1 text-sm text-text-secondary">
            Type of work (how the job shows in the OS)
            <input className={CAMPO} list="tipos-de-trabalho" value={s.osTitle} onChange={(e) => muda({ osTitle: e.target.value })} />
            <datalist id="tipos-de-trabalho">
              {tiposDeTrabalho.map((x) => (
                <option key={x} value={x} />
              ))}
            </datalist>
          </label>
          {!essencial ? (
            <label className="flex items-center gap-2 text-sm text-text-secondary">
              <input type="checkbox" checked={s.ativo} onChange={(e) => muda({ ativo: e.target.checked })} />
              On (shown on the website and quoted by Harvey)
            </label>
          ) : (
            <p className="text-xs text-text-tertiary">Core service: the website needs it, so it cannot be switched off or removed.</p>
          )}
        </Passo>

        <div className="flex flex-wrap items-center gap-2 border-t border-border-light pt-4">
          {passo < 5 ? (
            <Button disabled={!podeAvancar} onClick={() => setPasso((p) => p + 1)}>
              Next
            </Button>
          ) : (
            <Button disabled={!podeAvancar} onClick={aplicar}>
              {novo ? "Add to the list" : "Apply changes"}
            </Button>
          )}
          <Button variant="outline" onClick={onFechar}>
            Cancel
          </Button>
          {!novo && !essencial ? (
            <Button variant="outline" className="ml-auto" onClick={() => window.confirm(`Remove ${s.nome}?`) && onApagar(s.id)}>
              <Trash2 className="h-4 w-4" /> Remove
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-text-tertiary">Nothing goes live until you press Save and go live at the bottom of the list.</p>
      </div>
    </Drawer>
  );
}


/** Campo de preço em libras: vazio = null (Quote, onde vale). Fora do componente para não perder o foco. */
function Num({ valor, onChange, placeholder = "0" }: { valor: number | null | undefined; onChange: (v: number | null) => void; placeholder?: string }) {
  return (
    <div className="relative">
      <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-xs text-text-tertiary">£</span>
      <input
        inputMode="decimal"
        className={`${CAMPO} pl-5 text-right tabular-nums`}
        placeholder={placeholder}
        value={valor ?? ""}
        onChange={(e) => {
          const v = e.target.value.replace(/[^\d.]/g, "");
          onChange(v === "" ? null : Number(v));
        }}
      />
    </div>
  );
}

function Passo({ n, titulo, visivel, children }: { n: number; titulo: string; visivel: boolean; children: React.ReactNode }) {
  if (!visivel) return null;
  return (
    <section className="space-y-2">
      <h3 className="flex items-center gap-2 text-sm font-semibold text-text-primary">
        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-xs text-primary">{n}</span>
        {titulo}
      </h3>
      {children}
    </section>
  );
}

// ── tamanhos e regras de limpeza (valem para todos os serviços de limpeza) ──

function RegrasDeLimpeza({ t, setT }: { t: TabelaV2; setT: React.Dispatch<React.SetStateAction<TabelaV2>> }) {
  const muda = (fn: (d: TabelaV2) => void) =>
    setT((v) => {
      const d = structuredClone(v);
      fn(d);
      return d;
    });
  return (
    <section className="space-y-3 rounded-xl border border-border-light bg-card p-4">
      <div>
        <h2 className="font-medium text-text-primary">Sizes and cleaning rules</h2>
        <p className="text-xs text-text-tertiary">Sizes switched off do not show on the website. These rules apply to every cleaning service.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {t.tamanhos.map((z, i) => (
          <label key={z.id} className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-sm ${z.ativo !== false ? "border-primary/40 text-text-primary" : "border-border text-text-tertiary"}`}>
            <input type="checkbox" checked={z.ativo !== false} onChange={(e) => muda((d) => void (d.tamanhos[i].ativo = e.target.checked))} />
            {z.label}
          </label>
        ))}
      </div>
      <div className="grid gap-3 md:grid-cols-3">
        <label className="space-y-1 text-sm text-text-secondary">
          Bathrooms included
          <input type="number" min={1} className={CAMPO} value={t.limpeza.banheirosInclusos} onChange={(e) => muda((d) => void (d.limpeza.banheirosInclusos = Number(e.target.value)))} />
        </label>
        <label className="space-y-1 text-sm text-text-secondary">
          Each extra bathroom (2nd, 3rd, 4th+)
          <div className="flex gap-2">
            {t.limpeza.banheiroExtra.map((v, i) => (
              <input key={i} inputMode="decimal" className={`${CAMPO} text-right`} value={v} onChange={(e) => muda((d) => void (d.limpeza.banheiroExtra[i] = Number(e.target.value.replace(/[^\d.]/g, "")) || 0))} />
            ))}
          </div>
        </label>
        <label className="space-y-1 text-sm text-text-secondary">
          Team of two from
          <select className={CAMPO} value={t.limpeza.equipeDeDoisAPartir} onChange={(e) => muda((d) => void (d.limpeza.equipeDeDoisAPartir = e.target.value))}>
            {t.tamanhos.map((z) => (
              <option key={z.id} value={z.id}>
                {z.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}
