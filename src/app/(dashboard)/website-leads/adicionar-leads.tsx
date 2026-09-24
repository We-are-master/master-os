"use client";

/**
 * Lançar lead na mão: um (Add lead) ou vários (Import CSV).
 *
 * O CSV é lido no navegador e validado com as MESMAS regras do servidor
 * (validarLinha, em src/lib/site-leads/manual.ts), então a prévia já diz
 * quantas linhas entram e o que está errado em cada uma antes de mandar.
 * O modelo com os cabeçalhos mora em /templates/leads-import-template.csv.
 */

import { useState } from "react";
import { Download } from "lucide-react";
import { Modal } from "@/components/ui/modal";
import { Button } from "@/components/ui/button";
import { CABECALHOS_CSV, CANAIS, ROTULO_CANAL, validarLinha, type LinhaDeLead, type ResultadoImport } from "@/lib/site-leads/manual";

const CAMPO = "h-9 w-full rounded-lg border border-border bg-card px-2.5 text-sm text-text-primary placeholder:text-text-tertiary";
const ROTULO = "mb-1 block text-xs font-medium text-text-secondary";

async function enviar(leads: LinhaDeLead[], origem: "form" | "csv"): Promise<ResultadoImport> {
  const r = await fetch("/api/site-leads/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ origem, leads }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
  return j as ResultadoImport;
}

// ----------------------------------------------------------------- um lead

export function AdicionarLead({ aberto, fechar, pronto }: { aberto: boolean; fechar: () => void; pronto: () => void }) {
  const vazio: LinhaDeLead = { channel: "whatsapp", status: "new" };
  const [f, setF] = useState<LinhaDeLead>(vazio);
  const [erro, setErro] = useState("");
  const [salvando, setSalvando] = useState(false);
  const muda = (k: keyof LinhaDeLead) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    const v = validarLinha(f);
    if (!v.ok) { setErro(v.motivo); return; }
    setSalvando(true);
    setErro("");
    try {
      const r = await enviar([f], "form");
      if (r.erros.length) throw new Error(r.erros[0].motivo);
      setF(vazio);
      pronto();
      fechar();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Not saved. Try again.");
    } finally {
      setSalvando(false);
    }
  }

  return (
    <Modal open={aberto} onClose={fechar} title="Add lead" subtitle="A lead that reached us outside the website booking" size="lg">
      <form onSubmit={salvar} className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="sm:col-span-2"><span className={ROTULO}>Name</span><input className={CAMPO} value={f.name ?? ""} onChange={muda("name")} placeholder="Jane Smith" /></label>
        <label><span className={ROTULO}>Email</span><input className={CAMPO} type="email" value={f.email ?? ""} onChange={muda("email")} placeholder="jane@example.com" /></label>
        <label><span className={ROTULO}>Phone</span><input className={CAMPO} value={f.phone ?? ""} onChange={muda("phone")} placeholder="07700 900123" /></label>
        <label>
          <span className={ROTULO}>Origin</span>
          <select className={CAMPO} value={f.channel ?? "whatsapp"} onChange={muda("channel")}>
            {CANAIS.map((c) => <option key={c} value={c}>{ROTULO_CANAL[c]}</option>)}
          </select>
        </label>
        <label>
          <span className={ROTULO}>Status</span>
          <select className={CAMPO} value={f.status ?? "new"} onChange={muda("status")}>
            <option value="new">New</option>
            <option value="hot">Hot</option>
            <option value="contacted">In contact</option>
          </select>
        </label>
        <label><span className={ROTULO}>Service</span><input className={CAMPO} value={f.service ?? ""} onChange={muda("service")} placeholder="2 bed deep clean" /></label>
        <label><span className={ROTULO}>Price (£)</span><input className={CAMPO} inputMode="decimal" value={f.price ?? ""} onChange={muda("price")} placeholder="237" /></label>
        <label><span className={ROTULO}>Postcode</span><input className={CAMPO} value={f.postcode ?? ""} onChange={muda("postcode")} placeholder="SE15 4AA" /></label>
        <label><span className={ROTULO}>Tags</span><input className={CAMPO} value={f.tags ?? ""} onChange={muda("tags")} placeholder="landlord, void" /></label>
        <label className="sm:col-span-2">
          <span className={ROTULO}>Notes</span>
          <textarea className={`${CAMPO} h-20 py-2`} value={f.notes ?? ""} onChange={muda("notes")} placeholder="What they asked, when to call back…" />
        </label>
        <div className="flex items-center gap-3 sm:col-span-2">
          <Button type="submit" size="sm" disabled={salvando}>Save lead</Button>
          <span className="text-xs text-text-tertiary">Email or phone is enough. If an open lead already has this email or phone, it is updated instead of duplicated.</span>
        </div>
        {erro ? <p role="alert" className="text-sm text-red-600 sm:col-span-2 dark:text-red-400">{erro}</p> : null}
      </form>
    </Modal>
  );
}

// ----------------------------------------------------------------- CSV

/** CSV do Excel ou do Google: vírgula ou ponto e vírgula, aspas, quebra de linha dentro de aspas, BOM. */
export function lerCsv(texto: string): LinhaDeLead[] {
  const t = texto.replace(/^﻿/, "");
  const primeira = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (primeira.match(/;/g)?.length ?? 0) > (primeira.match(/,/g)?.length ?? 0) ? ";" : ",";
  const linhas: string[][] = [];
  let campo = "", linha: string[] = [], aspas = false;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (aspas) {
      if (c === '"') { if (t[i + 1] === '"') { campo += '"'; i++; } else aspas = false; } else campo += c;
    } else if (c === '"') aspas = true;
    else if (c === sep) { linha.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && t[i + 1] === "\n") i++;
      linha.push(campo); linhas.push(linha); linha = []; campo = "";
    } else campo += c;
  }
  if (campo || linha.length) { linha.push(campo); linhas.push(linha); }
  const [cab, ...resto] = linhas.filter((l) => l.some((x) => x.trim()));
  if (!cab) return [];
  const chaves = cab.map((h) => h.trim().toLowerCase().replace(/\s+/g, "_"));
  return resto.map((l) => {
    const o: Record<string, string> = {};
    chaves.forEach((k, i) => { if ((CABECALHOS_CSV as readonly string[]).includes(k)) o[k] = (l[i] ?? "").trim(); });
    return o as LinhaDeLead;
  });
}

export function ImportarLeads({ aberto, fechar, pronto }: { aberto: boolean; fechar: () => void; pronto: () => void }) {
  const [linhas, setLinhas] = useState<LinhaDeLead[]>([]);
  const [arquivo, setArquivo] = useState("");
  const [resultado, setResultado] = useState<ResultadoImport | null>(null);
  const [erro, setErro] = useState("");
  const [enviando, setEnviando] = useState(false);

  const checagem = linhas.map((l, i) => ({ linha: i + 2, v: validarLinha(l) }));
  const validas = checagem.filter((c) => c.v.ok).length;
  const invalidas = checagem.filter((c) => !c.v.ok) as Array<{ linha: number; v: { ok: false; motivo: string } }>;

  function limpar() {
    setLinhas([]); setArquivo(""); setResultado(null); setErro("");
  }

  async function escolher(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    setResultado(null); setErro("");
    if (!file) return;
    if (file.size > 5_000_000) { setErro("File is over 5 MB. Split it in parts."); return; }
    const texto = await file.text();
    const lidas = lerCsv(texto);
    if (!lidas.length) { setErro("No rows found. Check the first line has the headers from the template."); return; }
    setArquivo(file.name);
    setLinhas(lidas);
  }

  async function importar() {
    setEnviando(true); setErro("");
    try {
      const r = await enviar(linhas, "csv");
      setResultado(r);
      pronto();
    } catch (err) {
      setErro(err instanceof Error ? err.message : "Import failed. Try again.");
    } finally {
      setEnviando(false);
    }
  }

  return (
    <Modal open={aberto} onClose={() => { limpar(); fechar(); }} title="Import leads from CSV" subtitle="Up to 2,000 rows per file" size="lg">
      <div className="space-y-4 text-sm">
        <div className="rounded-lg border border-border bg-surface-secondary p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="m-0 font-medium text-text-primary">1. Start from the template</p>
            <a
              href="/templates/leads-import-template.csv"
              download
              className="inline-flex items-center gap-1.5 rounded-[6px] border-[0.5px] border-[#D8D8DD] bg-white px-3 py-1.5 text-xs font-medium text-[#020040] shadow-sm dark:border-border dark:bg-card dark:text-text-primary"
            >
              <Download className="h-3.5 w-3.5" /> Download template
            </a>
          </div>
          <p className="mb-0 mt-2 text-xs text-text-secondary">
            Columns: <span className="font-mono">{CABECALHOS_CSV.join(", ")}</span>. Only email <b>or</b> phone is required.
          </p>
          <p className="mb-0 mt-1 text-xs text-text-secondary">
            <b>channel</b>: {CANAIS.join(", ")} (wa, facebook, indicação… also work). <b>status</b>: new, hot, contacted, lost.
            <b> tags</b>: separate with ; or ,. <b>created_at</b>: 2026-09-24 14:30 or 24/09/2026.
          </p>
        </div>

        <div>
          <p className="mb-2 font-medium text-text-primary">2. Choose the file</p>
          <input type="file" accept=".csv,text/csv" onChange={escolher} className="block w-full text-sm text-text-secondary file:mr-3 file:rounded-md file:border-0 file:bg-primary file:px-3 file:py-1.5 file:text-xs file:font-medium file:text-white" />
        </div>

        {linhas.length > 0 && !resultado ? (
          <div className="space-y-2">
            <p className="m-0 font-medium text-text-primary">
              3. {arquivo}: <span className="text-emerald-600 dark:text-emerald-400">{validas} ready</span>
              {invalidas.length ? <span className="text-red-600 dark:text-red-400"> · {invalidas.length} with problems (skipped)</span> : null}
            </p>
            {invalidas.length ? (
              <ul className="m-0 max-h-32 list-none space-y-1 overflow-auto rounded-lg border border-border p-2 text-xs text-text-secondary">
                {invalidas.slice(0, 50).map((c) => <li key={c.linha}>Row {c.linha}: {c.v.motivo}</li>)}
              </ul>
            ) : null}
            <Button size="sm" disabled={enviando || validas === 0} onClick={importar}>
              {enviando ? "Importing…" : `Import ${validas} lead${validas === 1 ? "" : "s"}`}
            </Button>
          </div>
        ) : null}

        {resultado ? (
          <div className="rounded-lg border border-emerald-300/60 bg-emerald-50 p-3 text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-950/30 dark:text-emerald-200">
            <p className="m-0 font-medium">{resultado.criados} new · {resultado.atualizados} merged into open leads{resultado.erros.length ? ` · ${resultado.erros.length} skipped` : ""}</p>
            {resultado.erros.length ? (
              <ul className="mb-0 mt-2 max-h-28 list-none space-y-1 overflow-auto p-0 text-xs">
                {resultado.erros.slice(0, 50).map((e) => <li key={`${e.linha}-${e.motivo}`}>Row {e.linha}: {e.motivo}</li>)}
              </ul>
            ) : null}
            <div className="mt-2 flex gap-2">
              <Button size="sm" variant="outline" onClick={limpar}>Import another file</Button>
              <Button size="sm" onClick={() => { limpar(); fechar(); }}>Done</Button>
            </div>
          </div>
        ) : null}

        {erro ? <p role="alert" className="m-0 text-sm text-red-600 dark:text-red-400">{erro}</p> : null}
      </div>
    </Modal>
  );
}
