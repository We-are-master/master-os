"use client";

import { useState } from "react";
import { Copy, ExternalLink, Loader2, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Pill } from "@/components/fx/primitives";
import type { QuoteMontada } from "@/lib/orcamentista/quote-engine";
import { formatCurrency } from "@/lib/utils";

/**
 * O playground do price-check: o mesmo endpoint que Mike e o agente do
 * Zendesk vão consumir, com olhos. Digita o pedido do cliente, vê a quote
 * que o orçamentista montou — labour aprovado, kit comprado do mais barato
 * com link, opcionais oferecidos e gaps declarados — e copia o texto pronto.
 */

const SUPPLIER_LABELS: Record<string, string> = {
  screwfix: "Screwfix",
  toolstation: "Toolstation",
  wickes: "Wickes",
  bandq: "B&Q",
  travisperkins: "Travis Perkins",
};

type Resposta = {
  quote: QuoteMontada;
  presentable: string;
  electrical_work_requested: boolean;
};

export function QuotePlaygroundView() {
  const [pedido, setPedido] = useState("");
  const [carregando, setCarregando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [resposta, setResposta] = useState<Resposta | null>(null);
  const [copiado, setCopiado] = useState(false);

  const cotar = async () => {
    setCarregando(true);
    setErro(null);
    setResposta(null);
    try {
      const res = await fetch("/api/ai/price-check", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ request: pedido }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? `HTTP ${res.status}`);
      setResposta(json as Resposta);
    } catch (err) {
      setErro(err instanceof Error ? err.message : String(err));
    } finally {
      setCarregando(false);
    }
  };

  const copiar = async () => {
    if (!resposta) return;
    await navigator.clipboard.writeText(resposta.presentable);
    setCopiado(true);
    setTimeout(() => setCopiado(false), 1500);
  };

  const quote = resposta?.quote;

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-fx-line bg-card p-4">
        <label htmlFor="quote-request" className="mb-2 block text-sm font-medium">
          What does the customer want?
        </label>
        <textarea
          id="quote-request"
          rows={3}
          className="w-full resize-y rounded-lg border border-fx-line bg-bg-secondary/40 p-3 text-sm"
          placeholder='e.g. "change the kitchen tap and paint the main bedroom" — free text, same as the customer says it'
          value={pedido}
          onChange={(e) => setPedido(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && pedido.trim().length >= 3) void cotar();
          }}
        />
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs text-text-tertiary">
            Approved labour + material kits (buy cheapest, sell at market average). Every price carries its
            product link.
          </p>
          <Button
            size="sm"
            icon={carregando ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Sparkles className="h-3.5 w-3.5" />}
            disabled={carregando || pedido.trim().length < 3}
            onClick={() => void cotar()}
          >
            {carregando ? "Quoting…" : "Price it"}
          </Button>
        </div>
      </div>

      {erro && (
        <div className="rounded-xl border border-fx-coral/40 bg-fx-coral/5 p-4 text-sm text-text-secondary">
          {erro}
        </div>
      )}

      {quote && (
        <div className="space-y-4">
          {resposta!.electrical_work_requested && (
            <div className="rounded-xl border border-fx-coral/40 bg-fx-coral/5 p-3 text-sm">
              The request includes electrical installation — not offered (certificates only, owner rule 17/08).
            </div>
          )}

          <div className="overflow-hidden rounded-xl border border-fx-line bg-card">
            {quote.services.map((s) => (
              <div key={`${s.trade}-${s.service}`} className="border-b border-fx-line p-4 last:border-b-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div>
                    <span className="font-semibold">{s.service}</span>
                    {s.qty !== 1 && <span className="ml-1 text-text-secondary">× {s.qty}</span>}
                    {s.minChargeApplied && (
                      <span className="ml-2">
                        <Pill tone="info" dot={false}>minimum job charge</Pill>
                      </span>
                    )}
                  </div>
                  <span className="whitespace-nowrap font-semibold">{formatCurrency(s.lineTotal)}</span>
                </div>
                {s.assumption && <p className="mt-0.5 text-xs text-text-tertiary">assuming: {s.assumption}</p>}
                {[...s.materials, ...s.optionalMaterials.map((m) => ({ ...m, ehOpcional: true }))].map((m) => (
                  <div
                    key={`${m.family}-${m.variant}`}
                    className="mt-1.5 flex items-baseline justify-between gap-3 pl-4 text-sm"
                  >
                    <span className="min-w-0">
                      <span className={"ehOpcional" in m ? "text-text-tertiary" : "text-text-secondary"}>
                        {"ehOpcional" in m ? "if needed: " : "+ "}
                        {m.variant}
                        {m.qty !== 1 && ` × ${m.qty}`}
                      </span>
                      {m.sourceUrl && (
                        <a
                          href={m.sourceUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="ml-2 inline-flex items-center gap-0.5 text-xs text-fx-green hover:underline"
                          title={m.sampleProduct ?? undefined}
                        >
                          {SUPPLIER_LABELS[m.supplier] ?? m.supplier}
                          <ExternalLink className="h-3 w-3" aria-hidden />
                        </a>
                      )}
                      {m.note && <span className="ml-2 text-xs text-text-tertiary">({m.note})</span>}
                    </span>
                    <span className={"ehOpcional" in m ? "whitespace-nowrap text-text-tertiary" : "whitespace-nowrap"}>
                      {formatCurrency("ehOpcional" in m ? m.unitPrice : m.lineTotal)}
                    </span>
                  </div>
                ))}
              </div>
            ))}

            <div className="flex flex-wrap items-baseline justify-between gap-3 bg-bg-secondary/40 p-4">
              <div className="text-sm text-text-secondary">
                Labour {formatCurrency(quote.labourTotal)} · Materials {formatCurrency(quote.materialsTotal)}
                {quote.materialsMarginPct != null && (
                  <span className="ml-2">
                    <Pill tone="ok" dot={false}>
                      materials margin {formatCurrency(quote.materialsMarginGbp)} ({Math.round(quote.materialsMarginPct)}%)
                    </Pill>
                  </span>
                )}
              </div>
              <div className="text-lg font-bold">{formatCurrency(quote.total)}</div>
            </div>
          </div>

          {quote.gaps.length > 0 && (
            <div className="rounded-xl border border-fx-line bg-card p-4">
              <p className="mb-1.5 text-sm font-semibold">Needs a human:</p>
              <ul className="list-disc space-y-0.5 pl-5 text-sm text-text-secondary">
                {quote.gaps.map((g) => (
                  <li key={g}>{g}</li>
                ))}
              </ul>
            </div>
          )}

          <div className="flex justify-end">
            <Button size="sm" variant="secondary" icon={<Copy className="h-3.5 w-3.5" />} onClick={() => void copiar()}>
              {copiado ? "Copied!" : "Copy for WhatsApp/Zendesk"}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
