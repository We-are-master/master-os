/**
 * O calendário do agente de marketing: três meses, de 16/10/2026 a 15/01/2027.
 *
 * Duas coisas moram aqui, e só aqui:
 *
 *   CLUBE        26 edições, terça e sexta às 10h de Londres. As peças vêm da
 *                agenda (`email-sequences/agenda.ts`), mas a DATA de cada uma é
 *                escolhida à mão: o índice automático da agenda adiantava o
 *                Natal para novembro. Só entram peças do que a vitrine vende
 *                (limpeza, reparos, pintura, certificados); forno avulso,
 *                carpete, janela, boiler e limpeza regular ficaram de fora.
 *
 *   RELAMPAGOS   promoção de 36 horas, quarta 11h até quinta 23:59, por e-mail
 *                e WhatsApp, fechando no site com o código já aplicado no link.
 *
 * ── Por que relâmpago é 15% com teto de usos ────────────────────────────────
 *
 * Um relâmpago igual ao cupom que já está valendo não é relâmpago. O clube roda
 * 10% quase sempre, então aqui é 15%, que em limpeza é meia margem. O que
 * segura o custo não é o percentual, é o `maxUsos`: 25 reservas e o código
 * morre. E nenhum relâmpago cai em semana que já tem 15% no clube (AUTUMN15 até
 * 02/11, Fixfy Friday 24/11 a 01/12, JANUARY15 em janeiro), porque aí ele
 * competiria com um cupom igual e sem prazo curto.
 *
 * Mudou data ou oferta, muda aqui. O agente só obedece a este arquivo.
 */

import type { Bloco } from "@/lib/emails/campanha-layout";

export const SITE = "https://www.getfixfy.com";

/* ═══════════════════ Hora de Londres ═══════════════════ */

/**
 * "2026-10-27" às 10h de Londres, em UTC. O horário de verão acaba em
 * 25/10/2026, então a mesma "10h" é 09:00Z antes e 10:00Z depois: por isso a
 * conta pergunta ao calendário em vez de somar um número fixo.
 */
export function horaDeLondres(dia: string, hora: number, minuto = 0): Date {
  const chute = new Date(`${dia}T${String(hora).padStart(2, "0")}:${String(minuto).padStart(2, "0")}:00Z`);
  const emLondres = Number(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", hour12: false }).format(chute),
  );
  const desvio = ((emLondres - hora + 36) % 24) - 12;
  return new Date(chute.getTime() - desvio * 60 * 60 * 1000);
}

/** O dia de hoje em Londres, "2026-10-21". */
export function diaEmLondres(d = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(d);
}

/* ═══════════════════ Clube: terça e sexta ═══════════════════ */

export type EdicaoDoClube = { dia: string; key: string };

export const HORA_DO_CLUBE = 10;

export const CLUBE: EdicaoDoClube[] = [
  { dia: "2026-10-16", key: "welcome_notes" },
  { dia: "2026-10-20", key: "moving_autumn" },
  { dia: "2026-10-23", key: "condensation" },
  { dia: "2026-10-27", key: "autumn_deep_clean" },
  { dia: "2026-10-30", key: "five_minute_jobs" },
  { dia: "2026-11-03", key: "landlord_autumn" },
  { dia: "2026-11-06", key: "radiators_bleed" },
  { dia: "2026-11-10", key: "handyman_list" },
  { dia: "2026-11-13", key: "draughts" },
  { dia: "2026-11-17", key: "deposit_guide" },
  { dia: "2026-11-20", key: "damp_vs_condensation" },
  { dia: "2026-11-24", key: "fixfy_friday" },
  { dia: "2026-11-27", key: "kitchen_deep" },
  { dia: "2026-12-01", key: "paint_before_family" },
  { dia: "2026-12-04", key: "gutters_leaves" },
  { dia: "2026-12-08", key: "guest_ready_day" },
  { dia: "2026-12-11", key: "festive_deep_clean" },
  { dia: "2026-12-15", key: "declutter" },
  { dia: "2026-12-18", key: "christmas_cover" },
  { dia: "2026-12-22", key: "new_year_slots" },
  // 25/12 não sai nada. A semana do Natal tem uma edição só.
  { dia: "2026-12-29", key: "between_reset" },
  // 01/01 é feriado: a edição vai para o sábado.
  { dia: "2027-01-02", key: "fridge_reset" },
  { dia: "2027-01-05", key: "january_reset" },
  { dia: "2027-01-08", key: "mould_after_holidays" },
  { dia: "2027-01-12", key: "landlord_january" },
  { dia: "2027-01-15", key: "frozen_pipes" },
];

export function quandoSaiAEdicao(e: EdicaoDoClube): Date {
  return horaDeLondres(e.dia, HORA_DO_CLUBE);
}

/* ═══════════════════ Relâmpagos ═══════════════════ */

export type Relampago = {
  slug: string;
  /** A quarta em que abre. Fecha na quinta, 23:59 de Londres. */
  dia: string;
  codigo: string;
  /** Nome do cupom na Stripe: aparece no recibo do cliente, por isso em inglês. */
  nome: string;
  percentual: number;
  maxUsos: number;
  /** A oferta em uma linha, que entra no WhatsApp: "15% off any Fixfy clean". */
  linha: string;
  email: { assunto: string; preheader: string; titulo: string; blocos: Bloco[]; cta: string };
};

export const HORA_DO_EMAIL_RELAMPAGO = 11;
export const HORA_DO_WHATSAPP_RELAMPAGO = 15;

const t = (html: string): Bloco => ({ tipo: "texto", html });
const l = (titulo: string, itens: string[]): Bloco => ({ tipo: "lista", titulo, itens });

const REGRAS = "Prices include VAT and are fixed before you book. Every pro is vetted and insured. The code is applied for you when you open the link below, and it stops working on Thursday at midnight or after the first 25 bookings, whichever comes first.";

export const RELAMPAGOS: Relampago[] = [
  {
    slug: "move15",
    dia: "2026-10-21",
    codigo: "MOVE15",
    nome: "Fixfy · 36 hour offer",
    percentual: 15,
    maxUsos: 25,
    linha: "15% off any Fixfy booking, including end of tenancy cleaning from £200",
    email: {
      assunto: "36 hours only: 15% off your move-out clean",
      preheader: "Code MOVE15, until Thursday midnight. First 25 bookings.",
      titulo: "15% off, until Thursday midnight",
      blocos: [
        t("This one is short on purpose. From now until <strong>Thursday at midnight</strong>, code <strong>MOVE15</strong> takes <strong>15% off any Fixfy booking</strong>. You book now and choose any date that suits you."),
        l("Fixed prices before the 15%", [
          "End of tenancy cleaning from £200, oven included",
          "Deep cleaning from £174",
          "After builders cleaning from £204",
        ]),
        t(REGRAS),
      ],
      cta: "Book with MOVE15",
    },
  },
  {
    slug: "deep15",
    dia: "2026-11-04",
    codigo: "DEEP15",
    nome: "Fixfy · 36 hour offer",
    percentual: 15,
    maxUsos: 25,
    linha: "15% off any Fixfy booking, including deep cleaning from £174",
    email: {
      assunto: "36 hours only: 15% off a deep clean",
      preheader: "Code DEEP15, until Thursday midnight. First 25 bookings.",
      titulo: "The deep clean, 15% off for 36 hours",
      blocos: [
        t("Windows are shut and the heating is on, which makes this the right week for the clean that resets the whole flat. Until <strong>Thursday at midnight</strong>, code <strong>DEEP15</strong> takes <strong>15% off any Fixfy booking</strong>."),
        l("What the deep clean reaches", [
          "Behind and under the fridge, washer and cooker",
          "Inside every cupboard and drawer",
          "Limescale on taps, screens and tiles",
          "Skirting, door frames, switches and extractor filters",
        ]),
        t(REGRAS),
      ],
      cta: "Book with DEEP15",
    },
  },
  {
    slug: "fix15",
    dia: "2026-11-18",
    codigo: "FIX15",
    nome: "Fixfy · 36 hour offer",
    percentual: 15,
    maxUsos: 25,
    linha: "15% off any Fixfy booking, including a repairs half day (3.5 hours) at £180",
    email: {
      assunto: "36 hours only: 15% off the whole repairs list",
      preheader: "Code FIX15, until Thursday midnight. First 25 bookings.",
      titulo: "The list, done in one visit",
      blocos: [
        t("The door that sticks, the shelf still in its box, the tap that drips. Half a day clears most lists. Until <strong>Thursday at midnight</strong>, code <strong>FIX15</strong> takes <strong>15% off any Fixfy booking</strong>."),
        l("Fixed prices before the 15%", [
          "Repairs half day, 3.5 hours: £180",
          "Repairs full day, 7 hours: £329",
          "Tools and equipment included. Materials are quoted separately",
        ]),
        t(REGRAS),
      ],
      cta: "Book with FIX15",
    },
  },
  {
    slug: "xmas15",
    dia: "2026-12-09",
    codigo: "XMAS15",
    nome: "Fixfy · 36 hour offer",
    percentual: 15,
    maxUsos: 25,
    linha: "15% off any Fixfy booking for December, including deep cleaning from £174",
    email: {
      assunto: "36 hours only: 15% off before Christmas",
      preheader: "Code XMAS15, until Thursday midnight. First 25 bookings.",
      titulo: "Ready before everyone arrives",
      blocos: [
        t("The last two weeks of December fill first every year. Until <strong>Thursday at midnight</strong>, code <strong>XMAS15</strong> takes <strong>15% off any Fixfy booking</strong>, so you can lock the slot in now."),
        l("What people book before Christmas", [
          "A deep clean, from £174",
          "The repairs list before the family arrives, half day £180",
          "One room repainted, from £450",
        ]),
        t(REGRAS),
      ],
      cta: "Book with XMAS15",
    },
  },
];

export function abreEm(r: Relampago): Date {
  return horaDeLondres(r.dia, HORA_DO_EMAIL_RELAMPAGO);
}

/** Quinta, 23:59:59 de Londres. */
export function fechaEm(r: Relampago): Date {
  const quinta = new Date(`${r.dia}T12:00:00Z`);
  quinta.setUTCDate(quinta.getUTCDate() + 1);
  return new Date(horaDeLondres(quinta.toISOString().slice(0, 10), 23, 59).getTime() + 59_000);
}

/** O relâmpago que abre hoje (dia de Londres), se houver. */
export function relampagoDoDia(agora = new Date()): Relampago | null {
  const hoje = diaEmLondres(agora);
  return RELAMPAGOS.find((r) => r.dia === hoje) ?? null;
}

/** O relâmpago que está no ar agora: já abriu e ainda tem pelo menos 3 horas. */
export function relampagoNoAr(agora = new Date()): Relampago | null {
  const t0 = agora.getTime();
  return RELAMPAGOS.find((r) => t0 >= abreEm(r).getTime() && t0 < fechaEm(r).getTime() - 3 * 60 * 60 * 1000) ?? null;
}

/** O link que fecha a venda: o site lê `promo` e aplica o código sozinho. */
export function linkDoRelampago(r: Relampago, canal: "email" | "whatsapp"): string {
  const q = new URLSearchParams({ promo: r.codigo, utm_source: canal, utm_medium: "flash", utm_campaign: `flash_${r.slug}` });
  return `${SITE}/?${q.toString()}`;
}
