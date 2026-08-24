"use client";

import { Fragment, createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { formatCurrency } from "@/lib/utils";
import { setPulseMoneyLens } from "@/lib/pulse-money-display";

/**
 * Moeda de exibição do Pulse.
 *
 * O negócio roda em libra: todo número guardado no banco é GBP, e continua
 * sendo. Isto é só a lente da tela, para ler os mesmos números em real sem
 * abrir calculadora. Nada aqui converte dado guardado.
 *
 * A cotação vem de `/api/fx/gbp-brl` (cache de uma hora no servidor) e cai em
 * 7 quando a API não responde, que é a conta que o escritório já fazia de
 * cabeça.
 */

export type PulseCurrency = "GBP" | "BRL";

const STORAGE_KEY = "pulse:currency";
const FALLBACK_RATE = 7;

type Ctx = {
  currency: PulseCurrency;
  setCurrency: (c: PulseCurrency) => void;
  toggle: () => void;
  /** GBP → BRL. Sempre 1 quando a moeda é libra. */
  rate: number;
  rateSource: "live" | "fallback" | "loading";
  /** Formata um valor **em GBP** na moeda escolhida. */
  money: (gbp: number | null | undefined) => string;
};

const PulseCurrencyContext = createContext<Ctx | null>(null);

function formatBrl(value: number): string {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
}

export function PulseCurrencyProvider({ children }: { children: React.ReactNode }) {
  const [currency, setCurrencyState] = useState<PulseCurrency>("GBP");
  const [rate, setRate] = useState(FALLBACK_RATE);
  const [rateSource, setRateSource] = useState<"live" | "fallback" | "loading">("loading");

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(STORAGE_KEY);
      if (saved === "BRL" || saved === "GBP") setCurrencyState(saved);
    } catch {
      /* localStorage bloqueado: fica em libra */
    }
  }, []);

  // Busca a cotação uma vez; o cache de uma hora mora no servidor.
  useEffect(() => {
    let cancelled = false;
    void fetch("/api/fx/gbp-brl")
      .then((r) => r.json())
      .then((b: { rate?: number; source?: string }) => {
        if (cancelled) return;
        const v = Number(b?.rate);
        setRate(Number.isFinite(v) && v > 0 ? v : FALLBACK_RATE);
        setRateSource(b?.source === "fallback" ? "fallback" : "live");
      })
      .catch(() => {
        if (cancelled) return;
        setRate(FALLBACK_RATE);
        setRateSource("fallback");
      });
    return () => { cancelled = true; };
  }, []);

  const setCurrency = useCallback((c: PulseCurrency) => {
    setCurrencyState(c);
    try { window.localStorage.setItem(STORAGE_KEY, c); } catch { /* sem persistência */ }
  }, []);

  // Escrita no render, não em efeito: filho que formata no mesmo passo já
  // enxerga a moeda certa.
  setPulseMoneyLens(currency, rate);

  const value = useMemo<Ctx>(() => {
    const effectiveRate = currency === "BRL" ? rate : 1;
    return {
      currency,
      setCurrency,
      toggle: () => setCurrency(currency === "GBP" ? "BRL" : "GBP"),
      rate: effectiveRate,
      rateSource,
      money: (gbp) => {
        const n = Number(gbp ?? 0);
        const safe = Number.isFinite(n) ? n : 0;
        return currency === "BRL" ? formatBrl(safe * rate) : formatCurrency(safe);
      },
    };
  }, [currency, rate, rateSource, setCurrency]);

  /**
   * A subárvore remonta na troca de moeda.
   *
   * Os componentes do Pulse formatam dinheiro em subcomponentes que não
   * consomem este contexto — sem remontar, o botão virava R$ e os números
   * continuavam em libra. Fragment com key remonta sem inventar um nó no DOM
   * e sem mexer no layout. O custo é recarregar os dados do painel, que é o
   * mesmo custo de trocar o filtro de data.
   */
  return (
    <PulseCurrencyContext.Provider value={value}>
      <Fragment key={currency}>{children}</Fragment>
    </PulseCurrencyContext.Provider>
  );
}

/**
 * Fora do provider devolve libra sem conversão, então componente do Pulse
 * reaproveitado em outra tela não quebra nem mente sobre a moeda.
 */
export function usePulseMoney(): Ctx {
  const ctx = useContext(PulseCurrencyContext);
  if (ctx) return ctx;
  return {
    currency: "GBP",
    setCurrency: () => {},
    toggle: () => {},
    rate: 1,
    rateSource: "fallback",
    money: (gbp) => formatCurrency(Number(gbp ?? 0)),
  };
}
