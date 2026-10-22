/**
 * O email diário das 17h (UK): "seus jobs de amanhã", na ordem do dia.
 *
 * Duas caras, um builder: parceiro com endereço de casa cadastrado vê a ROTA
 * (saída de casa, pernas de deslocamento entre paradas, tempo total no
 * volante); empresa multi-equipe (sem endereço de casa) vê a lista limpa em
 * ordem de chegada, sem rota — ela distribui entre a equipe dela.
 *
 * Earnings vs Potential earnings (dono, 25/08): dia só de preço combinado
 * (fixed/day rate/half day) promete o número exato; dia com hourly no meio
 * vira "Potential earnings £X+" — nunca prometer número que depende do
 * relógio. O rótulo do acordo vem NA FRENTE do valor em cada card.
 */
import { emailFixfy, dataLonga, type Metrica } from "./fixfy-shell";
import { PASSO_NO_DIA, horaDeTexto, janelaCurtaDeTexto, passosDoJob, saudacaoDoParceiro, semTravessao } from "./partner-shell";
import { formatDuration, formatDistanceMiles } from "@/lib/mapbox-directions";

export type PartnerTomorrowStop = {
  /** "8:00 AM – 12:00 PM" ou "Time to be confirmed". */
  windowLabel: string;
  title: string;
  address: string;
  clientFirstName: string | null;
  /** Já formatado com o rótulo na frente: "Half day · £75.00". */
  payDisplay: string;
  /** Link simples que leva ao portal. */
  portalUrl: string;
  /** Perna ATÉ esta parada (null na primeira ou no modo sem rota). */
  drive: { durationSec: number; distanceM: number } | null;
  /** Divide o dia em Morning/Afternoon (dono, 26/08). null = sem horário. */
  slot?: "morning" | "afternoon" | null;
};

export type PartnerTomorrowEmailData = {
  partnerFirstName: string;
  /** "Tuesday 26 August" (só usado sem `dateYmd`). */
  dateLabel: string;
  /** YYYY-MM-DD do dia: vira "Wed 21 Oct 26" no assunto e no texto. */
  dateYmd?: string | null;
  stops: PartnerTomorrowStop[];
  /** true = variante com rota (casa cadastrada e pernas calculadas). */
  showRoute: boolean;
  totalDriveSec: number | null;
  firstArrivalLabel: string;
  /** "Earnings" ou "Potential earnings". */
  earningsLabel: string;
  /** "£166.90" ou "£166.90+". */
  earningsDisplay: string;
  portalUrl: string;
  /** "today" quando o disparo sai depois da meia-noite de Londres (correção). */
  dayWord?: "today" | "tomorrow";
  /** Aviso sob a abertura, usado no reenvio de correção. */
  correctionNote?: string | null;
  supportEmail?: string;
  supportPhone?: string;
};

export function buildPartnerTomorrowEmail(data: PartnerTomorrowEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const n = data.stops.length;
  const dayWord = data.dayWord ?? "tomorrow";
  const dia = dataLonga(data.dateYmd ?? null) ?? semTravessao(data.dateLabel);
  const jobs = `${n} job${n === 1 ? "" : "s"}`;
  const subject = `Your jobs for ${dayWord} · ${dia} (${jobs})`;
  const primeira = horaDeTexto(data.firstArrivalLabel);

  const metricas: Metrica[] = [
    { rotulo: n === 1 ? "Job" : "Jobs", valor: String(n) },
    { rotulo: "First arrival", valor: primeira },
    ...(data.showRoute && data.totalDriveSec != null && data.totalDriveSec > 0
      ? [{ rotulo: "On the road", valor: formatDuration(data.totalDriveSec) }]
      : []),
    { rotulo: data.earningsLabel, valor: data.earningsDisplay },
  ];

  // Cabeçalho de slot entra quando o slot MUDA de uma parada pra outra; a
  // numeração segue contínua (a ordem do dia é uma só, o slot é só leitura).
  const temSlots = data.stops.some((s) => s.slot != null);
  const paradas: string[] = [];
  data.stops.forEach((s, i) => {
    if (temSlots && s.slot != null && data.stops[i - 1]?.slot !== s.slot) {
      paradas.push(s.slot === "morning" ? "Morning slot" : "Afternoon slot");
    }
    const perna =
      data.showRoute && s.drive && s.drive.durationSec > 0
        ? ` · ${formatDuration(s.drive.durationSec)} drive (${formatDistanceMiles(s.drive.distanceM)}) to get here`
        : "";
    const partes = [
      `${i + 1}. ${janelaCurtaDeTexto(s.windowLabel)}`,
      s.title,
      s.address,
      s.clientFirstName,
      s.payDisplay,
    ].filter((p): p is string => Boolean(p && String(p).trim()));
    paradas.push(semTravessao(`${partes.join(" · ")}${perna}`));
  });

  // Cada parada leva ao portal; link próprio só quando difere do botão.
  const linksDasParadas = data.stops
    .map((s, i) => ({ label: `Open job ${i + 1}`, url: s.portalUrl }))
    .filter((l) => l.url && l.url !== data.portalUrl);

  const { html, text } = emailFixfy({
    preheader: `${jobs} ${dayWord} · first arrival ${primeira}`,
    estado: { texto: dayWord === "today" ? "Today" : "Tomorrow", cor: "navy" },
    titulo: `Your jobs for ${dayWord}`,
    passos: passosDoJob(PASSO_NO_DIA),
    metricas,
    saudacao: saudacaoDoParceiro(data.partnerFirstName),
    paragrafos: [
      `Here's your day for ${dayWord}, ${dia}: ${jobs} lined up, ${data.showRoute ? "in driving order from home" : "in arrival order"}.`,
      ...(temSlots ? [] : [data.showRoute ? "Leaving from home · route in order" : `${dayWord === "today" ? "Today's" : "Tomorrow's"} jobs · in arrival order`]),
      ...paradas,
    ],
    nota: data.correctionNote?.trim() ? semTravessao(data.correctionNote.trim()) : null,
    cta: { label: "Open my day in Fixfy Trade", url: data.portalUrl },
    linksSecundarios: linksDasParadas,
    letraPequena: ["Anything changed? Reply to this email and we'll sort it before tomorrow."],
  });
  return { subject, html, text };
}
