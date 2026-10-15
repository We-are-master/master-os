"use client";

/**
 * Needs Attention de verdade (dono, 11/10/2026): reclamação aberta, cliente sem resposta,
 * job nos próximos 2 dias sem parceiro, job atrasado, cartão recusado, final check parado
 * há 3 dias e quote pronta para mandar. A mesma lista do placar das 8h, mais os dois últimos.
 * Antes mostrava "40 jobs awaiting payment" pelo preço cheio e um job antigo de margem baixa.
 */
import Link from "next/link";
import { AlertTriangle, CheckCircle2, ClipboardCheck, CreditCard, FileText, MessageCircle, UserX, Clock } from "lucide-react";
import { cn } from "@/lib/utils";
import { MicroLabel, SectionCard } from "@/components/fx/primitives";
import { PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS, PULSE_FORECAST_PAIR_CARD_CLASS } from "@/lib/pulse-layout";
import type { UrgenteDoPulse } from "@/lib/pulse-ceo";
import { usePulseCeo } from "./pulse-ceo-data";

type Tom = "red" | "coral" | "blue" | "amber" | "navy";
const TONE_CLASS: Record<Tom, string> = {
  red: "bg-fx-red-50 text-fx-red",
  coral: "bg-fx-coral-50 text-fx-coral-p",
  blue: "bg-fx-blue-50 text-fx-blue",
  amber: "bg-fx-amber-50 text-fx-amber",
  navy: "bg-fx-navy/10 text-fx-navy",
};

const TIPO: Record<UrgenteDoPulse["tipo"], { titulo: string; tom: Tom; icone: React.ReactNode }> = {
  complaint: { titulo: "Complaint", tom: "red", icone: <AlertTriangle className="h-4 w-4" /> },
  no_reply: { titulo: "No reply", tom: "coral", icone: <MessageCircle className="h-4 w-4" /> },
  no_partner: { titulo: "No partner", tom: "red", icone: <UserX className="h-4 w-4" /> },
  late: { titulo: "Late", tom: "amber", icone: <Clock className="h-4 w-4" /> },
  card: { titulo: "Card refused", tom: "red", icone: <CreditCard className="h-4 w-4" /> },
  final_check: { titulo: "Final review waiting", tom: "amber", icone: <ClipboardCheck className="h-4 w-4" /> },
  quote_ready: { titulo: "Quote ready to send", tom: "blue", icone: <FileText className="h-4 w-4" /> },
};

const ZD = process.env.NEXT_PUBLIC_ZENDESK_SUBDOMAIN || "fixfy";

/** Para onde o item leva: o job, a quote ou o ticket do Zendesk. */
function destino(u: UrgenteDoPulse): { href: string; externo: boolean } {
  const job = u.texto.match(/\bJOB-\d+\b/)?.[0];
  if (job) return { href: `/jobs?search=${encodeURIComponent(job)}`, externo: false };
  const quote = u.texto.match(/\bQT-[\d-]+\b/)?.[0];
  if (quote) return { href: `/quotes?search=${encodeURIComponent(quote)}`, externo: false };
  const ticket = u.texto.match(/^#(\d+)/)?.[1];
  if (ticket) return { href: `https://${ZD}.zendesk.com/agent/tickets/${ticket}`, externo: true };
  return { href: "/jobs", externo: false };
}

export function AlertsFeed() {
  const { data, loading, error } = usePulseCeo();
  const itens = data?.urgentes ?? [];
  return (
    <SectionCard
      className={PULSE_FORECAST_PAIR_CARD_CLASS}
      title="Action required"
      subtitle={<span className="block truncate whitespace-nowrap">{loading ? "loading" : `${itens.length} item${itens.length === 1 ? "" : "s"}`}</span>}
      bodyClassName={cn("p-0", PULSE_FORECAST_PAIR_BODY_SCROLL_CLASS)}
    >
      {loading ? (
        <div className="space-y-3 px-5 py-4">
          {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded bg-fx-paper-2/40" />)}
        </div>
      ) : error ? (
        <p className="px-5 py-4 text-[13px] text-fx-red">Could not load ({error}).</p>
      ) : itens.length === 0 ? (
        <div className="flex items-center gap-3 px-5 py-4">
          <span className={cn("inline-grid h-7 w-7 shrink-0 place-items-center rounded-full", TONE_CLASS.blue)}><CheckCircle2 className="h-4 w-4" /></span>
          <div>
            <div className="text-[13px] font-medium leading-tight text-text-primary">All clear</div>
            <MicroLabel className="mt-1 block">No complaint, nobody waiting, every job has a partner</MicroLabel>
          </div>
        </div>
      ) : (
        <div className="flex flex-col">
          {itens.map((u, i) => {
            const t = TIPO[u.tipo];
            const d = destino(u);
            const corpo = (
              <>
                <span className={cn("inline-grid h-7 w-7 shrink-0 place-items-center rounded-full", TONE_CLASS[t.tom])}>{t.icone}</span>
                <div className="min-w-0 flex-1">
                  <div className="text-[13px] font-medium leading-tight text-text-primary">{t.titulo}</div>
                  <MicroLabel className="mt-1 block truncate">{u.texto}</MicroLabel>
                </div>
                <span className="text-[12px] font-medium text-fx-mute">Open →</span>
              </>
            );
            const classe = cn("flex items-center gap-3 px-5 py-3 transition-colors hover:bg-fx-paper", i < itens.length - 1 && "border-b border-fx-line");
            return d.externo ? (
              <a key={`${u.tipo}-${i}`} href={d.href} target="_blank" rel="noreferrer" className={classe}>{corpo}</a>
            ) : (
              <Link key={`${u.tipo}-${i}`} href={d.href} className={classe}>{corpo}</Link>
            );
          })}
        </div>
      )}
    </SectionCard>
  );
}
