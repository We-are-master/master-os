"use client";

/**
 * A tela de controle do Harvey no WhatsApp. Texto em inglês como o resto do
 * OS, sem travessão. Uma linha por conversa dos últimos 7 dias: quem é, com
 * quem está, e o botão de assumir (ou devolver).
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { PageHeader } from "@/components/layout/page-header";
import { PageTransition } from "@/components/layout/page-transition";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

export type ConversaDaTela = {
  conversation_id: string;
  name: string | null;
  phone: string | null;
  estado: "harvey" | "equipe" | "parado" | null;
  tipo: "parceiro" | "cliente" | "novo" | null;
  atualizado_em: string;
  cliente_em: string | null;
  checkout_ref: string | null;
  checkout_total: number | null;
  motivo_passagem: string | null;
  chases: number | null;
};

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { timeZone: "Europe/London", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "·");

async function mandar(corpo: Record<string, string>) {
  const res = await fetch("/api/harvey-wa/controle", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const j = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new Error(j.error ?? `failed (${res.status})`);
}

export function ControleHarvey({ conversas, pausado, pausaInfo }: { conversas: ConversaDaTela[]; pausado: boolean; pausaInfo: string | null }) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState<string | null>(null);

  async function acao(chave: string, corpo: Record<string, string>, ok: string) {
    setOcupado(chave);
    try {
      await mandar(corpo);
      toast.success(ok);
      router.refresh();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setOcupado(null);
    }
  }

  const comHarvey = conversas.filter((c) => c.estado === "harvey");
  const comEquipe = conversas.filter((c) => c.estado !== "harvey");

  return (
    <PageTransition>
      <div className="space-y-6 p-6">
        <PageHeader title="Harvey · WhatsApp" subtitle="Take over any conversation here: the Zendesk ticket unlocks and Harvey stops replying.">
          <Button
            variant={pausado ? "primary" : "outline"}
            loading={ocupado === "pausa"}
            onClick={() => acao("pausa", { acao: pausado ? "ligar" : "pausar" }, pausado ? "Harvey is back on" : "Harvey paused: new messages go to the team")}
          >
            {pausado ? "Turn Harvey back on" : "Pause Harvey"}
          </Button>
        </PageHeader>

        {pausado ? (
          <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900 dark:bg-amber-950/30 dark:text-amber-200">
            Harvey is paused{pausaInfo ? ` (${pausaInfo})` : ""}. Every new WhatsApp message goes straight to the team in Zendesk.
          </p>
        ) : null}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-secondary">With Harvey now ({comHarvey.length})</h2>
          {comHarvey.length === 0 ? <p className="text-sm text-text-tertiary">Nobody right now.</p> : null}
          {comHarvey.map((c) => (
            <Linha key={c.conversation_id} c={c}>
              <Button
                size="sm"
                loading={ocupado === c.conversation_id}
                onClick={() => acao(c.conversation_id, { acao: "assumir", conversationId: c.conversation_id }, `You have ${c.name ?? "this conversation"}: reply in Zendesk`)}
              >
                Take over
              </Button>
            </Linha>
          ))}
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-text-secondary">With the team ({comEquipe.length})</h2>
          {comEquipe.map((c) => (
            <Linha key={c.conversation_id} c={c}>
              <Button
                size="sm"
                variant="outline"
                loading={ocupado === c.conversation_id}
                onClick={() => acao(c.conversation_id, { acao: "devolver", conversationId: c.conversation_id }, "Back with Harvey")}
              >
                Give back to Harvey
              </Button>
            </Linha>
          ))}
        </section>
      </div>
    </PageTransition>
  );
}

function Linha({ c, children }: { c: ConversaDaTela; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-border-light px-4 py-3">
      <div className="min-w-0 space-y-0.5">
        <div className="flex items-center gap-2">
          <span className="truncate font-medium text-text-primary">{c.name ?? c.phone ?? "Unknown"}</span>
          {c.tipo === "parceiro" ? <Badge variant="violet">Partner</Badge> : c.tipo === "cliente" ? <Badge variant="info">Customer</Badge> : <Badge>New</Badge>}
          {c.checkout_ref ? <Badge variant="success">{`Link sent ${c.checkout_ref}${c.checkout_total ? ` · £${c.checkout_total}` : ""}`}</Badge> : null}
        </div>
        <p className="truncate text-xs text-text-tertiary">
          {c.phone ?? "·"} · last message {quando(c.cliente_em ?? c.atualizado_em)}
          {c.motivo_passagem ? ` · ${c.motivo_passagem}` : ""}
        </p>
      </div>
      {children}
    </div>
  );
}
