"use client";

/**
 * Editor das regras: uma aba por público, uma caixa por regra. Escrito para
 * gente: título curto e texto em inglês simples, sem travessão. Os agentes leem
 * isto antes de responder, então é aqui que se muda "o que vale".
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDown, ArrowUp, Trash2 } from "lucide-react";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs } from "@/components/ui/tabs";
import { PUBLICOS, type PublicoDaRegra, type Regras, type Versao } from "@/lib/os-documentos";

type VersaoResumo = Omit<Versao<unknown>, "documento">;
const quando = (iso: string) =>
  new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const CAMPO = "w-full rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary placeholder:text-text-tertiary focus:border-primary focus:outline-none";

async function postar(corpo: Record<string, unknown>) {
  const res = await fetch("/api/os-documentos", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  return { ok: res.ok, ...j };
}

const idNovo = (titulo: string) =>
  `${titulo.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || "rule"}_${Math.random().toString(36).slice(2, 6)}`;

export function EditorDeRegras({ atual, versoes, embedded = false }: { atual: Versao<Regras>; versoes: VersaoResumo[]; embedded?: boolean }) {
  const router = useRouter();
  const [r, setR] = useState<Regras>(() => structuredClone(atual.documento));
  const [aba, setAba] = useState<PublicoDaRegra>("cliente");
  const [nota, setNota] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const mudou = JSON.stringify(r) !== JSON.stringify(atual.documento);
  const lista = r.publicos[aba] ?? [];
  const info = PUBLICOS.find((p) => p.id === aba)!;

  const muda = (fn: (d: Regras) => void) =>
    setR((velho) => {
      const d = structuredClone(velho);
      d.publicos[aba] = d.publicos[aba] ?? [];
      fn(d);
      return d;
    });

  async function salvar() {
    setOcupado(true);
    try {
      const res = await postar({ tipo: "regras", documento: r, nota });
      if (!res.ok) throw new Error(res.error ?? "Could not save");
      toast.success("Saved: agents use the new rules within 30 seconds");
      setNota("");
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(false);
    }
  }

  async function restaurar(id: number) {
    if (!window.confirm(`Restore version ${id}? It becomes the live rules.`)) return;
    const res = await postar({ tipo: "regras", restaurar: id });
    if (!res.ok) return toast.error(res.error ?? "Could not restore");
    toast.success(`Version ${id} is live again`);
    router.refresh();
  }

  const versaoNoAr = <Badge variant="info">{`Live: version ${atual.id} · ${atual.criado_por ?? "system"}, ${quando(atual.criado_em)}`}</Badge>;
  return (
    <PageTransition>
      <div className={embedded ? "space-y-6 pb-28" : "space-y-6 p-6 pb-28"}>
        {embedded ? (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-sm text-text-secondary">What applies to customers, partners and accounts. Agents read these before every reply; the website shows the customer ones.</p>
            {versaoNoAr}
          </div>
        ) : (
          <PageHeader title="Rules" subtitle="What applies to customers, partners and accounts. Agents read these before every reply; the website shows the customer ones.">
            {versaoNoAr}
          </PageHeader>
        )}

        <Tabs
          tabs={PUBLICOS.map((p) => ({ id: p.id, label: p.titulo, count: (r.publicos[p.id] ?? []).length }))}
          activeTab={aba}
          onChange={(id) => setAba(id as PublicoDaRegra)}
        />
        <p className="text-sm text-text-tertiary">{info.ajuda} Write it as you would tell a new team member: short, plain English, no dashes.</p>

        <div className="space-y-3">
          {lista.map((regra, i) => (
            <div key={regra.id} className="space-y-2 rounded-xl border border-border-light bg-card p-4">
              <div className="flex items-center gap-2">
                <input className={`${CAMPO} h-9 font-medium`} value={regra.titulo} onChange={(e) => muda((d) => void (d.publicos[aba][i].titulo = e.target.value))} />
                <Button size="sm" variant="outline" disabled={i === 0} aria-label="Move up" onClick={() => muda((d) => void d.publicos[aba].splice(i - 1, 0, ...d.publicos[aba].splice(i, 1)))}>
                  <ArrowUp className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" disabled={i === lista.length - 1} aria-label="Move down" onClick={() => muda((d) => void d.publicos[aba].splice(i + 1, 0, ...d.publicos[aba].splice(i, 1)))}>
                  <ArrowDown className="h-4 w-4" />
                </Button>
                <Button size="sm" variant="outline" aria-label="Delete rule" onClick={() => window.confirm(`Delete "${regra.titulo}"?`) && muda((d) => void d.publicos[aba].splice(i, 1))}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
              <textarea
                className={`${CAMPO} resize-y py-2 leading-relaxed`}
                rows={Math.max(3, Math.ceil(regra.texto.length / 110) + 1)}
                value={regra.texto}
                onChange={(e) => muda((d) => void (d.publicos[aba][i].texto = e.target.value))}
              />
            </div>
          ))}
          <Button variant="outline" onClick={() => muda((d) => void d.publicos[aba].push({ id: idNovo("new rule"), titulo: "New rule", texto: "" }))}>
            Add a rule
          </Button>
        </div>

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
        </section>
      </div>

      {mudou ? (
        <div className="fixed inset-x-0 bottom-0 z-30 flex flex-wrap items-center gap-2 border-t border-border bg-card/95 px-6 py-3 backdrop-blur">
          <input className={`${CAMPO} h-9 max-w-md`} placeholder="What changed? (optional)" value={nota} onChange={(e) => setNota(e.target.value)} />
          <Button loading={ocupado} onClick={salvar}>
            Save and go live
          </Button>
          <Button variant="outline" onClick={() => setR(structuredClone(atual.documento))}>
            Discard changes
          </Button>
        </div>
      ) : null}
    </PageTransition>
  );
}
