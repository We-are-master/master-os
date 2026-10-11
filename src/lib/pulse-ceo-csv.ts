import type { PulseCeo } from "@/lib/pulse-ceo";

const cel = (v: string | number) => {
  const t = String(v);
  return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
};

/** Os números do CEO num CSV simples (seção, item, valor, detalhe), para o botão Export do Pulse. */
export function pulseCeoParaCsv(p: PulseCeo): string {
  const fim = p.acumulado[p.acumulado.length - 1];
  const hojeDia = Number(p.hoje.slice(8, 10));
  const linhas: Array<[string, string, string | number, string]> = [
    ["Month", "Date", p.hoje, "London"],
    ["Month", "Goal (GBP)", p.meta, ""],
    ["Month", "Booked for the month (GBP)", fim?.fechado ?? 0, "jobs with a visit this month, not cancelled"],
    ["Month", "Delivered so far (GBP)", p.acumulado[hojeDia - 1]?.entregue ?? 0, "counted on the day each job was finished"],
    ["Month", "To go (GBP)", Math.max(0, p.meta - (fim?.fechado ?? 0)), ""],
    ["Funnel", "Leads", p.funil.leads, p.funil.porCanal.map((c) => `${c.n} ${c.canal}`).join(" / ")],
    ["Funnel", "Quotes", p.funil.quotes, "created this month"],
    ["Funnel", "Jobs booked", p.funil.fechados.n, `GBP ${p.funil.fechados.valor}`],
    ["Funnel", "Delivered", p.funil.entregues.n, `GBP ${p.funil.entregues.valor}`],
    ["Funnel", "Paid (GBP)", p.funil.pagos.valor, `${p.funil.pagos.n} invoices`],
    ["Funnel", "Conversion (%)", p.funil.conversao, `${p.funil.convertidos} of ${p.funil.leads} leads became customers`],
    ["Money", "To receive (GBP)", p.dinheiro.aReceber.valor, `${p.dinheiro.aReceber.n} invoices`],
    ["Money", "Overdue (GBP)", p.dinheiro.vencido.valor, `${p.dinheiro.vencido.n} invoices, accounts and customers`],
    ["Money", "Platforms past date (GBP)", p.dinheiro.plataformas.valor, `${p.dinheiro.plataformas.n} invoices, paid on their own cycle`],
    ...p.origem.map((o): [string, string, string | number, string] => ["Revenue by source", o.nome, o.valor, `${o.jobs} jobs`]),
    ...p.urgentes.map((u): [string, string, string | number, string] => ["Needs attention", u.tipo, "", u.texto]),
    ...p.acumulado.map((d): [string, string, string | number, string] => ["Day by day", `Day ${d.dia}`, d.fechado, `delivered ${d.entregue}`]),
  ];
  return [["Section", "Item", "Value", "Detail"], ...linhas].map((l) => l.map(cel).join(",")).join("\n");
}
