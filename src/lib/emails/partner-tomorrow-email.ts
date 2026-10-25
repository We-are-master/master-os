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
import { dataLonga, esc, urlSegura, type Metrica } from "./fixfy-shell";
import { emailParceiro, horaDeTexto, janelaCurtaDeTexto, pagaDoParceiro, semTravessao } from "./partner-shell";
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
  // Assunto e copy antigos (dono, 23/10/2026), sem travessão.
  const subject = `Your jobs for ${dayWord} · ${dia} (${jobs})`;
  const primeira = horaDeTexto(data.firstArrivalLabel);

  const naEstrada = data.showRoute && data.totalDriveSec != null && data.totalDriveSec > 0 ? formatDuration(data.totalDriveSec) : null;

  // O e-mail antigo (dono, 23/10/2026: "volta o jeito antigo desse"), na moldura
  // nova: saudação e a frase do dia, a faixa de números, os cartões das paradas
  // por slot com a perna de carro, "Open" em cada uma e um botão. Sem barra (o
  // antigo não tinha), sem emoji, sem negrito pesado, janela 09:00-12:00.
  const metricas: Metrica[] = [
    { rotulo: n === 1 ? "Job" : "Jobs", valor: String(n) },
    { rotulo: "First arrival", valor: primeira },
    ...(naEstrada ? [{ rotulo: "On the road", valor: naEstrada }] : []),
    { rotulo: data.earningsLabel, valor: data.earningsDisplay },
  ];

  const F = "Inter, ui-sans-serif, system-ui, -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";
  const temSlots = data.stops.some((s) => s.slot != null);
  const blocos: string[] = [];
  const textos: string[] = [];
  data.stops.forEach((s, i) => {
    const slot = temSlots && s.slot != null && data.stops[i - 1]?.slot !== s.slot ? (s.slot === "morning" ? "Morning slot" : "Afternoon slot") : null;
    const perna =
      data.showRoute && s.drive && s.drive.durationSec > 0
        ? `${formatDuration(s.drive.durationSec)} drive · ${formatDistanceMiles(s.drive.distanceM)}`
        : null;
    const janela = janelaCurtaDeTexto(s.windowLabel);
    const paga = pagaDoParceiro(s.payDisplay)?.linha ?? semTravessao(s.payDisplay);
    const quemEPaga = [s.clientFirstName, paga].filter((p): p is string => Boolean(p && String(p).trim())).join(" · ");
    const abrir = urlSegura(s.portalUrl);
    if (slot) {
      blocos.push(`<p style="margin:${i === 0 ? 0 : 18}px 0 4px 0;font-family:${F};font-size:12px;line-height:16px;font-weight:600;letter-spacing:0.06em;text-transform:uppercase;color:#7A7C92;">${esc(slot)}</p>`);
    }
    if (perna) {
      blocos.push(`<p style="margin:${slot || i === 0 ? 0 : 12}px 0 6px 0;font-family:${F};font-size:13px;line-height:18px;color:#7A7C92;">${esc(perna)}</p>`);
    } else if (!slot && i > 0) {
      blocos.push(`<div style="height:10px;line-height:10px;font-size:0;">&nbsp;</div>`);
    }
    blocos.push(
      `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#F7F7FA;border:1px solid #EEEEF2;border-radius:12px;"><tr>` +
        `<td width="44" valign="top" style="padding:16px 0 16px 16px;"><div style="width:26px;height:26px;line-height:26px;border-radius:13px;background:#020040;color:#FFFFFF;text-align:center;font-family:${F};font-size:13px;font-weight:600;">${i + 1}</div></td>` +
        `<td valign="top" style="padding:14px 12px 14px 4px;">` +
        `<p style="margin:0;font-family:${F};font-size:13px;line-height:18px;font-weight:600;color:#ED4B00;">${esc(janela)}</p>` +
        `<p style="margin:2px 0 0 0;font-family:${F};font-size:16px;line-height:22px;font-weight:600;color:#020040;">${esc(semTravessao(s.title))}</p>` +
        (s.address ? `<p style="margin:2px 0 0 0;font-family:${F};font-size:14px;line-height:20px;color:#505268;">${esc(semTravessao(s.address))}</p>` : "") +
        (quemEPaga ? `<p style="margin:2px 0 0 0;font-family:${F};font-size:14px;line-height:20px;color:#505268;">${esc(semTravessao(quemEPaga))}</p>` : "") +
        `</td>` +
        (abrir
          ? `<td width="76" valign="middle" align="right" style="padding:14px 16px 14px 0;"><a href="${esc(abrir)}" style="display:inline-block;border:1px solid #DCDCE6;border-radius:8px;background:#FFFFFF;padding:6px 12px;font-family:${F};font-size:13px;line-height:18px;font-weight:600;color:#020040;text-decoration:none;">Open</a></td>`
          : "") +
        `</tr></table>`,
    );
    textos.push(
      [slot ? slot.toUpperCase() : null, perna, `${i + 1}. ${janela} · ${semTravessao(s.title)}`, s.address ? semTravessao(s.address) : null, quemEPaga || null, abrir ? `Open: ${abrir}` : null]
        .filter(Boolean)
        .join("\n"),
    );
  });

  const { html, text } = emailParceiro({
    zendesk: false,
    preheader: `${jobs} ${dayWord} · first arrival ${primeira}`,
    estado: { texto: dayWord === "today" ? "Today" : "Tomorrow", cor: "navy", chip: true },
    // Título com o dia e os números logo embaixo, sem saudação nem frase (dono, 25/10/2026).
    titulo: `Your jobs for ${dia}`,
    saudacao: "",
    paragrafos: [],
    avisos: data.correctionNote?.trim() ? [{ tom: "amber", texto: semTravessao(data.correctionNote.trim()), lugar: "topo" }] : [],
    metricas,
    antesDoBotao: { html: blocos.join(""), text: textos.join("\n\n") },
    cta: { label: "Open my day in Fixfy Trade", url: data.portalUrl },
    letraPequena: [`Anything changed? Reply to this email and we'll sort it before ${dayWord}.`],
  });
  return { subject, html, text };
}
