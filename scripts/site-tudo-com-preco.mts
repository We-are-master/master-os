/**
 * Tudo que tem preço em Services vai para o site (dono, 07/10/2026).
 *
 * Lê a versão em vigor da tabela do site (formato 3: layout + mapa), acrescenta
 * os itens novos (textos no layout, ids de Services no mapa) e grava uma versão
 * nova. Sem --gravar só mostra o que mudaria e a tabela gerada.
 *
 *   NODE_OPTIONS=--dns-result-order=ipv4first npx tsx scripts/site-tudo-com-preco.mts [--gravar]
 *
 * Fica de fora, de propósito: Regular Cleaning (por hora e recorrente, precisa
 * de fluxo próprio), Gardener (paga mais do que cobra), Builder (sem preço),
 * Commercial EPC (preço "a partir de"), Electrician (a Fixfy não faz elétrica), Cleaning e Gas Safety Check (repetem
 * serviços que já estão no site), combinações "N bed · 2 bath" (o site cobra
 * banheiro como extra), Fire Risk por casa (sem repasse) e 6+ quartos.
 */
process.loadEnvFile(process.env.HOME + "/master-os/.env.local");

const { createServiceClient } = await import("../src/lib/supabase/service");
const { versaoAtual, salvarVersao, validarTabela } = await import("../src/lib/os-documentos");
const { gerarTabelaDoSite, lerServicos } = await import("../src/lib/servicos-do-site");
import type { TabelaDePrecos } from "../src/lib/os-documentos";
import type { MapaDoSite, Ref } from "../src/lib/servicos-do-site";

const gravar = process.argv.includes("--gravar");
const sb = createServiceClient();
const v = await versaoAtual<{ formato: 3; layout: TabelaDePrecos; mapa: MapaDoSite }>(sb, "tabela_de_precos");
if (!v || v.documento.formato !== 3) throw new Error("Current version is not format 3");
const layout = structuredClone(v.documento.layout);
const mapa = structuredClone(v.documento.mapa);
const servicos = await lerServicos(sb);

const servico = (nome: string) => {
  const s = servicos.find((x) => x.name.trim().toLowerCase() === nome.toLowerCase());
  if (!s) throw new Error(`Service "${nome}" not found`);
  return s;
};
const ref = (nome: string, tipo: "preset" | "addon", re: RegExp): Ref => {
  const s = servico(nome);
  const l = (tipo === "preset" ? s.pricing_presets : s.pricing_addons)?.find((x) => re.test(x.label));
  if (!l) throw new Error(`${nome}: no ${tipo} matching ${re}`);
  return { servico: s.id, tipo, id: l.id };
};
const semRepetir = <T extends { id: string }>(lista: T[], novos: T[]) => [...lista.filter((x) => !novos.some((n) => n.id === x.id)), ...novos];

// ── limpeza: os extras de Services que o site ainda não tinha ───────────────
const EXTRAS: Array<{ id: string; label: string; detail: string; unit?: string; max?: number; re: RegExp }> = [
  { id: "room", label: "Extra room", detail: "Office, dining room or utility room", unit: "room", max: 4, re: /^extra room/i },
  { id: "rug", label: "Rug", detail: "Deep cleaned on site", unit: "rug", max: 4, re: /^rug$/i },
  { id: "curtains", label: "Curtains", detail: "Deep cleaned, per pair", unit: "pair", max: 6, re: /^curtains/i },
  { id: "sofa2", label: "Sofa, 2 seats", detail: "Upholstery deep cleaned", re: /^2 seater sofa/i },
  { id: "sofa3", label: "Sofa, 3 seats", detail: "Upholstery deep cleaned", re: /^3 seater sofa/i },
  { id: "sofa4", label: "Sofa, 4 seats", detail: "Upholstery deep cleaned", re: /^4 seater sofa/i },
  { id: "lsofa3", label: "Corner sofa, 3 seats", detail: "L-shaped, upholstery deep cleaned", re: /^l-shaped sofa 3/i },
  { id: "lsofa4", label: "Corner sofa, 4 seats", detail: "L-shaped, upholstery deep cleaned", re: /^l-shaped sofa 4/i },
  { id: "lsofa5", label: "Corner sofa, 5 seats", detail: "L-shaped, upholstery deep cleaned", re: /^l-shaped sofa 5/i },
  { id: "mattress1", label: "Mattress, single", detail: "Both sides deep cleaned", unit: "mattress", max: 4, re: /^mattress single/i },
  { id: "mattress2", label: "Mattress, double", detail: "Both sides deep cleaned", unit: "mattress", max: 4, re: /^mattress double/i },
  { id: "mattress3", label: "Mattress, king size", detail: "Both sides deep cleaned", unit: "mattress", max: 4, re: /^mattress king/i },
  { id: "roman", label: "Roman blinds", detail: "Dusted and spot cleaned", unit: "blind", max: 8, re: /^blinds roman/i },
  { id: "venetian", label: "Venetian blinds", detail: "Every slat wiped", unit: "blind", max: 8, re: /^blinds venetian/i },
  { id: "parking", label: "No free parking", detail: "Covers your cleaner's parking when there is no free space", re: /^no free parking/i },
  { id: "congestion", label: "Congestion charge", detail: "When the property is inside the London charging zone", re: /^congestion charge/i },
];
layout.clean.extras = semRepetir(
  layout.clean.extras,
  EXTRAS.map(({ re: _re, ...e }) => ({ ...e, price: 1 })),
);
for (const k of layout.clean.kinds) {
  const nome = { eot: "End of Tenancy Clean", deep: "Deep Clean", after: "After Builders Clean" }[k.id] ?? k.osTitle;
  for (const e of EXTRAS) mapa.clean[k.id].extras[e.id] = ref(nome, "addon", e.re);
}

// ── pintura: diária ─────────────────────────────────────────────────────────
layout.paint.options = semRepetir(layout.paint.options, [
  { id: "day", label: "Full day", detail: "A painter for the day for walls, ceilings or woodwork, as you need. Up to 7 hours.", time: "Up to 7 hours", price: 1 },
]);
mapa.paint.opcoes.day = ref("Painter", "preset", /^full day/i);

// ── reparos: hora avulsa do handyman e as outras profissões ─────────────────
layout.fix.packages = semRepetir(layout.fix.packages, [{ id: "hour", label: "By the hour", detail: "Minimum 1 hour", minutes: 60, price: 1, perHour: true }]);
mapa.fix.pacotes.hour = ref("General Maintenance", "preset", /^hourly/i);
const POR_HORA = { id: "hour", label: "By the hour", detail: "Minimum 1 hour", minutes: 60, price: 1, perHour: true };
const MEIA = { id: "half", label: "Half day", detail: "Up to 3.5 hours", minutes: 210, price: 1 };
const DIARIA = { id: "day", label: "Full day", detail: "Up to 7 hours", minutes: 420, price: 1 };
// Cópias: structuredClone mantém objeto repetido como o MESMO objeto, e o preço de uma profissão vazava para a outra.
const pacotes = (...l: Array<typeof MEIA>) => l.map((p) => ({ ...p }));
layout.fix.trades = [
  { id: "plumber", label: "Plumber", detail: "Leaks, taps, toilets, showers and radiators", osTitle: "Plumber", packages: pacotes(MEIA, DIARIA, POR_HORA) },
  { id: "carpenter", label: "Carpenter", detail: "Doors, skirting, shelves and fitted furniture", osTitle: "Carpenter", packages: pacotes(MEIA, DIARIA, POR_HORA) },
];
const pacotesDe = (nome: string) => ({ half: ref(nome, "preset", /^half day/i), day: ref(nome, "preset", /^full day/i), hour: ref(nome, "preset", /^hourly/i) });
// Sem eletricista (dono, 08/10/2026: "não estamos fazendo eletricidade").
mapa.fix.profissoes = { plumber: pacotesDe("Plumber"), carpenter: pacotesDe("Carpenter") };

// ── certificados ────────────────────────────────────────────────────────────
const gas = layout.cert.items.find((c) => c.id === "gas")!;
gas.options = [
  { id: "a1", label: "1 appliance", price: 1 },
  { id: "a2", label: "2 appliances", price: 1 },
  { id: "a3", label: "3 appliances", price: 1 },
  { id: "a4", label: "4 appliances", price: 1 },
];
mapa.cert.gas = {
  fixo: mapa.cert.gas.fixo,
  opcoes: {
    a1: ref("Gas Safety Certificate", "preset", /1 appliance/i),
    a2: ref("Gas Safety Certificate", "preset", /2 appliances/i),
    a3: ref("Gas Safety Certificate", "preset", /3 appliances/i),
    a4: ref("Gas Safety Certificate", "preset", /4 appliances/i),
  },
};
// EICR de 5+ quartos tinha preço em Services e ficava "sob consulta".
const eicr = layout.cert.items.find((c) => c.id === "eicr")!;
if (eicr.prices) eicr.prices["5"] = 1;
mapa.cert.eicr.tamanhos!["5"] = ref("Electrical Installation Condition Report", "preset", /5-6 bed/i);

type Novo = { id: string; label: string; short: string; detail: string; valid: string; osTitle: string; servico: string; opcoes?: Array<[string, string, RegExp]>; fixo?: RegExp; extra?: [string, number, RegExp] };
const NOVOS: Novo[] = [
  {
    id: "fra", label: "Fire risk assessment", short: "Fire risk assessment", servico: "Fire Risk Assessment", osTitle: "Fire Risk Assessment",
    detail: "A qualified assessor checks escape routes, alarms, doors and hazards and writes the assessment the law asks for", valid: "Review every year",
    opcoes: [
      ["studio", "Studio flat", /^studio flat/i],
      ["comm1", "Communal areas, 1 storey", /^single storey communal/i],
      ["comm2", "Communal areas, 2 storeys", /^two storey communal/i],
      ["comm3", "Communal areas, 3 storeys", /^three storey communal/i],
      ["comm4", "Communal areas, 4 storeys", /^four storey communal/i],
      ["hmo12", "HMO or rental home, 1 to 2 beds", /^hmo & rental home 1-2/i],
      ["hmo34", "HMO or rental home, 3 to 4 beds", /^hmo & rental home 3-4/i],
      ["hmo56", "HMO or rental home, 5 to 6 beds", /^hmo & rental home 5-6/i],
      ["biz100ft", "Business, up to 100 sq ft", /^business sector upto 100 sq ft/i],
      ["biz50", "Business, up to 50 sq m", /^business sector upto 50 sq m/i],
      ["biz100", "Business, 1 storey, up to 100 sq m", /^business sector 1 storey upto 100/i],
      ["biz100x", "Business, 2 to 3 storeys, up to 100 sq m", /^business sector 2-3 storey upto 100/i],
      ["biz200", "Business, 1 storey, up to 200 sq m", /^business sector 1 storey upto 200/i],
      ["biz200x", "Business, 2 to 3 storeys, up to 200 sq m", /^business sector 2-3 storey upto 200/i],
    ],
  },
  {
    id: "alarm", label: "Fire alarm service", short: "Fire alarm service", servico: "Fire Alarm Certificate", osTitle: "Fire Alarm Certificate",
    detail: "Every detector and call point tested, with the service certificate", valid: "Service every 6 months",
    opcoes: [
      ["home", "Home, up to 10 devices", /^domestic fire alarm/i],
      ["commercial", "Commercial, up to 15 devices", /^commercial fire alarm/i],
    ],
  },
  {
    id: "emlight", label: "Emergency lighting test", short: "Emergency lighting", servico: "Emergency Lighting Certificate", osTitle: "Emergency Lighting Certificate",
    detail: "Full duration test of every emergency light, with the certificate", valid: "Test every year",
    opcoes: [
      ["up3", "Up to 3 lights", /up to 3 lights/i],
      ["up10", "4 to 10 lights", /4-10 lights/i],
    ],
  },
  {
    id: "extinguisher", label: "Fire extinguisher service", short: "Fire extinguishers", servico: "Fire Extinguisher Service", osTitle: "Fire Extinguisher Service",
    detail: "Each extinguisher inspected, serviced and tagged", valid: "Service every year",
    opcoes: [
      ["up3", "Up to 3 extinguishers", /up to 3\)/i],
      ["up8", "4 to 8 extinguishers", /4-8\)/i],
    ],
  },
  {
    id: "firedoor", label: "Fire door inspection", short: "Fire door inspection", servico: "Fire Door Inspection", osTitle: "Fire Door Inspection",
    detail: "Frame, gaps, seals, hinges and closer checked on each door, with a written report", valid: "Communal doors every 3 months, flat doors every year",
    fixo: /\(1 door\)/i, extra: ["Extra doors", 20, /each extra door/i],
  },
  {
    id: "asbestos", label: "Asbestos management survey", short: "Asbestos survey", servico: "Asbestos Management Survey", osTitle: "Asbestos Management Survey",
    detail: "A surveyor inspects the property and samples suspect materials for the lab, with the asbestos register", valid: "Before any building work",
    fixo: /\(1 sample\)/i, extra: ["Extra samples", 20, /each extra sample/i],
  },
  {
    id: "pat", label: "Portable appliance testing (PAT)", short: "PAT testing", servico: "Appliance Testing", osTitle: "Appliance Testing",
    detail: "Every plug-in appliance tested and labelled, with the test record", valid: "Recommended every year",
    opcoes: [
      ["i10", "1 to 10 items", /^1 – 10/i],
      ["i20", "11 to 20 items", /^11 – 20/i],
      ["i30", "21 to 30 items", /^21 – 30/i],
      ["i40", "31 to 40 items", /^31 – 40/i],
    ],
  },
  {
    id: "legionella", label: "Legionella risk assessment", short: "Legionella assessment", servico: "Legionella Risk Assessment", osTitle: "Legionella Risk Assessment",
    detail: "Water system, tanks and outlets checked for legionella risk, with the written assessment", valid: "Review every 2 years", fixo: /./,
  },
  {
    id: "boiler", label: "Boiler service", short: "Boiler service", servico: "Boiler Service", osTitle: "Boiler Service",
    detail: "A Gas Safe registered engineer services and safety checks the boiler", valid: "Every 12 months", fixo: /./,
  },
];
const novosItens = NOVOS.map((n) => ({
  id: n.id,
  label: n.label,
  short: n.short,
  detail: n.detail,
  valid: n.valid,
  osTitle: n.osTitle,
  ...(n.opcoes ? { options: n.opcoes.map(([id, label]) => ({ id, label, price: 1 })) } : { price: 1 }),
  ...(n.extra ? { extra: { label: n.extra[0], price: 1, max: n.extra[1] } } : {}),
}));
layout.cert.items = semRepetir(layout.cert.items, novosItens);
for (const n of NOVOS) {
  mapa.cert[n.id] = {
    ...(n.opcoes ? { opcoes: Object.fromEntries(n.opcoes.map(([id, , re]) => [id, ref(n.servico, "preset", re)])) } : {}),
    ...(n.fixo ? { fixo: ref(n.servico, "preset", n.fixo) } : {}),
    ...(n.extra ? { extra: ref(n.servico, "preset", n.extra[2]) } : {}),
  };
}

// ── gerar, conferir e (com --gravar) gravar ─────────────────────────────────
const tabela = gerarTabelaDoSite(layout, mapa, servicos);
const erros = validarTabela(tabela);
if (erros.length) throw new Error(`Invalid table:\n${erros.join("\n")}`);
const resumo = {
  extras: tabela.clean.extras.map((e) => `${e.id} £${e.price}${e.unit ? `/${e.unit}` : ""} (partner £${tabela.partnerPay.clean.extras.eot[e.id]})`),
  paint: tabela.paint.options.map((o) => `${o.id} £${o.price} (partner £${tabela.partnerPay.paint[o.id]})`),
  fix: tabela.fix.packages.map((p) => `handyman ${p.id} £${p.price}`),
  trades: (tabela.fix.trades ?? []).map((t) => `${t.id}: ${t.packages.map((p) => `${p.id} £${p.price} (partner £${tabela.partnerPay.fix.trades?.[t.id]?.[p.id]})`).join(", ")}`),
  cert: tabela.cert.items.map((c) => `${c.id}: ${c.options ? c.options.map((o) => `${o.id} £${o.price}`).join(", ") : c.prices ? JSON.stringify(c.prices) : `£${c.price}`}${c.extra ? ` + ${c.extra.label} £${c.extra.price}` : ""} · partner ${JSON.stringify(tabela.partnerPay.cert[c.id])}`),
};
console.log(JSON.stringify(resumo, null, 2));
const saida = process.argv.find((a) => a.startsWith("--saida="))?.slice(8);
if (saida) (await import("node:fs")).writeFileSync(saida, JSON.stringify(tabela));
if (gravar) {
  const id = await salvarVersao(sb, "tabela_de_precos", { formato: 3, layout, mapa }, "claude (dono: tudo com preço no site)", "Everything priced in Services goes on the website");
  console.log(`saved version ${id} (previous ${v.id})`);
} else {
  console.log(`dry run, current version ${v.id}. Use --gravar to save.`);
}
