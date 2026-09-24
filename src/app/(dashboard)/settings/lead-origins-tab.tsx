"use client";

/**
 * Settings → Lead origins: de onde o lead chegou (WhatsApp, indicação, TikTok…).
 *
 * Lê e grava a tabela lead_channels (migration 296) com a sessão do admin.
 * A CHAVE nasce do nome na criação e nunca muda (é o que fica em cada lead);
 * o nome, os apelidos do CSV, a ordem e o "ativa" mudam à vontade. Não tem
 * apagar: desativar tira dos formulários e do CSV e mantém os leads antigos.
 */

import { useEffect, useState } from "react";
import { ArrowDown, ArrowUp, Loader2, Plus } from "lucide-react";
import { toast } from "sonner";
import { Card, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { getSupabase } from "@/services/base";

type Origem = { key: string; label: string; active: boolean; sort: number; aliases: string[]; nova?: boolean };

const CAMPO = "h-8 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary placeholder:text-text-tertiary";

const chaveDe = (nome: string) =>
  nome.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 30);

export function LeadOriginsTab() {
  const [origens, setOrigens] = useState<Origem[]>([]);
  const [carregando, setCarregando] = useState(true);
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState("");
  const [novoNome, setNovoNome] = useState("");

  // Busca separada de aplicar: o efeito só mexe no estado depois do await.
  async function buscar(): Promise<{ lista: Origem[]; erro: string }> {
    const { data, error } = await getSupabase().from("lead_channels").select("key, label, active, sort, aliases").order("sort").order("label");
    if (error) {
      return { lista: [], erro: /lead_channels|does not exist|42P01/i.test(error.message) ? "The lead origins table is missing. Run migration 296 in the Supabase SQL editor." : error.message };
    }
    return { lista: (data ?? []).map((o) => ({ ...o, aliases: (o.aliases as string[]) ?? [] })) as Origem[], erro: "" };
  }

  function aplicar(r: { lista: Origem[]; erro: string }) {
    setOrigens(r.lista);
    setErro(r.erro);
    setCarregando(false);
  }

  useEffect(() => {
    let vivo = true;
    void buscar().then((r) => { if (vivo) aplicar(r); });
    return () => { vivo = false; };
  }, []);

  const muda = (key: string, patch: Partial<Origem>) => setOrigens((xs) => xs.map((o) => (o.key === key ? { ...o, ...patch } : o)));

  function mover(i: number, delta: number) {
    setOrigens((xs) => {
      const j = i + delta;
      if (j < 0 || j >= xs.length) return xs;
      const copia = [...xs];
      [copia[i], copia[j]] = [copia[j], copia[i]];
      return copia.map((o, n) => ({ ...o, sort: (n + 1) * 10 }));
    });
  }

  function adicionar() {
    const nome = novoNome.trim();
    const key = chaveDe(nome);
    if (key.length < 2) { toast.error("Type a name with at least 2 letters."); return; }
    if (origens.some((o) => o.key === key)) { toast.error(`"${nome}" already exists.`); return; }
    setOrigens((xs) => [...xs, { key, label: nome, active: true, sort: (xs.length + 1) * 10, aliases: [], nova: true }]);
    setNovoNome("");
  }

  async function salvar() {
    setSalvando(true);
    setErro("");
    const linhas = origens.map((o, n) => ({
      key: o.key,
      label: o.label.trim() || o.key,
      active: o.active,
      sort: (n + 1) * 10,
      aliases: o.aliases.map((a) => a.trim().toLowerCase()).filter(Boolean),
    }));
    const { error } = await getSupabase().from("lead_channels").upsert(linhas, { onConflict: "key" });
    setSalvando(false);
    if (error) { setErro(error.message); return; }
    toast.success("Lead origins saved");
    aplicar(await buscar());
  }

  return (
    <Card>
      <CardHeader>
        <div>
          <CardTitle>Lead origins</CardTitle>
          <p className="mt-1 text-sm text-text-secondary">
            Where a lead came from. Used in Leads (filter, Add lead) and in the CSV import. Inactive origins disappear from the forms but old leads keep them.
          </p>
        </div>
      </CardHeader>

      <div className="space-y-4 px-5 pb-5">
        {carregando ? (
          <div className="flex items-center gap-2 text-sm text-text-tertiary"><Loader2 className="h-4 w-4 animate-spin" /> Loading…</div>
        ) : (
          <>
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[640px] text-sm">
                <thead>
                  <tr className="text-left text-[11px] uppercase tracking-wider text-text-tertiary">
                    <th className="px-3 py-2 font-semibold">Order</th>
                    <th className="px-3 py-2 font-semibold">Name</th>
                    <th className="px-3 py-2 font-semibold">Key (fixed)</th>
                    <th className="px-3 py-2 font-semibold">CSV aliases</th>
                    <th className="px-3 py-2 font-semibold">Active</th>
                  </tr>
                </thead>
                <tbody>
                  {origens.map((o, i) => (
                    <tr key={o.key} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="flex gap-1">
                          <button type="button" aria-label={`Move ${o.label} up`} onClick={() => mover(i, -1)} disabled={i === 0} className="rounded p-1 text-text-tertiary hover:bg-surface-hover disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
                          <button type="button" aria-label={`Move ${o.label} down`} onClick={() => mover(i, 1)} disabled={i === origens.length - 1} className="rounded p-1 text-text-tertiary hover:bg-surface-hover disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
                        </div>
                      </td>
                      <td className="px-3 py-2"><input className={CAMPO} value={o.label} onChange={(e) => muda(o.key, { label: e.target.value })} aria-label={`Name of ${o.key}`} /></td>
                      <td className="px-3 py-2 font-mono text-xs text-text-secondary">{o.key}{o.nova ? <span className="ml-1 text-primary">new</span> : null}</td>
                      <td className="px-3 py-2">
                        <input
                          className={CAMPO}
                          value={o.aliases.join(", ")}
                          onChange={(e) => muda(o.key, { aliases: e.target.value.split(",").map((a) => a.trim()) })}
                          placeholder="wa, zap"
                          aria-label={`CSV aliases of ${o.key}`}
                        />
                      </td>
                      <td className="px-3 py-2">
                        <input type="checkbox" checked={o.active} onChange={(e) => muda(o.key, { active: e.target.checked })} aria-label={`${o.label} active`} className="h-4 w-4 accent-[#ED4B00]" />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <input
                className={`${CAMPO} max-w-xs`}
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); adicionar(); } }}
                placeholder="New origin, e.g. TikTok"
                aria-label="New origin name"
              />
              <Button size="sm" variant="outline" icon={<Plus className="h-3.5 w-3.5" />} onClick={adicionar}>Add origin</Button>
              <div className="flex-1" />
              <Button size="sm" disabled={salvando} onClick={salvar}>{salvando ? "Saving…" : "Save changes"}</Button>
            </div>
          </>
        )}
        {erro ? <p role="alert" className="text-sm text-red-600 dark:text-red-400">{erro}</p> : null}
      </div>
    </Card>
  );
}
