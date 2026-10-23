/**
 * PDF do report V2 (start_report / final_report) que o cliente recebe.
 *
 * 22/10/2026: refeito no visual dos e-mails (logo navy no branco, eyebrow laranja
 * em Inter, card navy com o resumo, "What we did."). Sai tudo que é interno:
 * selos de aprovação, horários de envio, nome do parceiro, "No" de campo vazio,
 * horas cobráveis e custo de material. Fotos: "Before" e "After" separados quando
 * existem as duas fases; senão, todas juntas em "Photos".
 */

import fs from "node:fs";
import path from "node:path";
import React from "react";
import { Document, Page, Text, View, StyleSheet, Image, Font } from "@react-pdf/renderer";
import { type NormalizedReport } from "@/lib/job-report-v2";
import { dataCurta, linhasDoCliente, textoDe, type Linha } from "@/lib/report-cliente";
import { readPublicLogoDataUri } from "@/lib/pdf/resolve-logo-data-uri";

export interface JobReportPDFData {
  reference: string;
  jobTitle: string;
  propertyAddress: string;
  clientName?: string | null;
  /** Não vai para o PDF do cliente; fica no tipo para quem já passa. */
  partnerName?: string | null;
  /** Ignorado: o cabeçalho é branco e usa o logo navy. */
  logoUrl?: string;
  start?: { report: NormalizedReport; signedPhotos: SignedPhoto[]; approvedAt: string | null } | null;
  final?: { report: NormalizedReport; signedPhotos: SignedPhoto[]; approvedAt: string | null } | null;
}

export interface SignedPhoto {
  url: string;
  label?: string;
}

const APP_URL = (process.env.NEXT_PUBLIC_APP_URL || "https://app.getfixfy.com").replace(/\/$/, "");

/** Inter de `public/fonts`; sem o arquivo no bundle, busca o mesmo arquivo publicado. */
function fonteInter(peso: 400 | 600 | 700): string {
  const local = path.join(process.cwd(), "public", "fonts", `Inter-${peso}.ttf`);
  return fs.existsSync(local) ? local : `${APP_URL}/fonts/Inter-${peso}.ttf`;
}

Font.register({
  family: "Inter",
  fonts: [
    { src: fonteInter(400), fontWeight: 400 },
    { src: fonteInter(600), fontWeight: 600 },
    { src: fonteInter(700), fontWeight: 700 },
  ],
});
Font.registerHyphenationCallback((palavra) => [palavra]);

const LOGO = readPublicLogoDataUri("logos/fixfy-primary-navy-trim.png") ?? "https://www.getfixfy.com/brand/fixfy-primary-navy.png";

const C = {
  navy: "#020040",
  orange: "#ED4B00",
  orangeSoft: "#FF7A3D",
  ink: "#303044",
  muted: "#7A7C92",
  faint: "#9A9CA8",
  line: "#EEEEF2",
  canvas: "#F5F5F7",
  white: "#FFFFFF",
  onNavy: "#B9BAD6",
};

const PAD = 44;
const FOOTER_H = 58;

const s = StyleSheet.create({
  page: {
    fontFamily: "Inter",
    fontSize: 10.5,
    color: C.ink,
    backgroundColor: C.white,
    paddingTop: 20,
    paddingBottom: FOOTER_H + 8,
    paddingHorizontal: PAD,
  },
  topo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", paddingBottom: 10, borderBottomWidth: 1, borderBottomColor: C.line },
  logo: { width: 82, height: 29, objectFit: "contain" as const, objectPosition: "left center" as const },
  topoRef: { fontSize: 9.5, color: C.muted },
  eyebrow: { marginTop: 12, fontSize: 10.5, fontWeight: 700, color: C.orange, letterSpacing: 0.2 },
  h1: { marginTop: 2, fontSize: 22, fontWeight: 700, color: C.navy, letterSpacing: -0.8, lineHeight: 1.1 },
  intro: { marginTop: 3, fontSize: 10, lineHeight: 1.5, color: C.ink },

  card: { marginTop: 12, backgroundColor: C.navy, borderRadius: 12, paddingVertical: 10, paddingHorizontal: 12 },
  cardTopo: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  cardKey: { fontSize: 8.5, color: C.onNavy, marginTop: 2 },
  cardServico: { fontSize: 15, fontWeight: 700, color: C.white, letterSpacing: -0.3 },
  pilula: { fontSize: 8.5, fontWeight: 700, color: C.white, backgroundColor: C.orange, paddingVertical: 4, paddingHorizontal: 10, borderRadius: 999 },
  painel: { backgroundColor: C.white, borderRadius: 9 },
  painelLinha: { flexDirection: "row" },
  celula: { flex: 1, paddingVertical: 6, paddingHorizontal: 12 },
  celulaDivisa: { borderLeftWidth: 1, borderLeftColor: C.line },
  celulaLarga: { paddingVertical: 6, paddingHorizontal: 12, borderBottomWidth: 1, borderBottomColor: C.line },
  celulaKey: { fontSize: 7.5, color: C.muted, marginBottom: 1 },
  celulaVal: { fontSize: 10.5, fontWeight: 700, color: C.navy, lineHeight: 1.35 },

  descricaoBox: { flexDirection: "row", backgroundColor: C.canvas, borderRadius: 10, overflow: "hidden" },
  descricaoBarra: { width: 3, backgroundColor: C.orange },
  descricaoCorpo: { flex: 1, paddingVertical: 10, paddingHorizontal: 15 },
  rotuloMiudo: { fontSize: 8, fontWeight: 600, color: C.muted, marginBottom: 4, letterSpacing: 0.3 },
  tiles: { flexDirection: "row", flexWrap: "wrap", marginTop: 8, gap: 8 },
  tile: { width: "23.6%", borderWidth: 1, borderColor: C.line, borderRadius: 9, paddingVertical: 7, paddingHorizontal: 12 },
  tileVal: { fontSize: 12.5, fontWeight: 700, color: C.navy },

  h2: { marginTop: 13, marginBottom: 6, fontSize: 14, fontWeight: 700, color: C.navy, letterSpacing: -0.3 },
  paragrafo: { fontSize: 11, lineHeight: 1.6, color: C.ink },

  linha: { flexDirection: "row", paddingVertical: 9, borderTopWidth: 1, borderTopColor: C.line },
  linhaUltima: { borderBottomWidth: 1, borderBottomColor: C.line },
  linhaKey: { width: "38%", fontSize: 10, color: C.muted, paddingRight: 10 },
  linhaVal: { width: "62%", fontSize: 10.5, fontWeight: 600, color: C.navy, lineHeight: 1.45 },

  fotoTag: {
    position: "absolute", top: 6, left: 6, fontSize: 7, fontWeight: 700, color: C.white,
    backgroundColor: C.navy, paddingVertical: 3, paddingHorizontal: 7, borderRadius: 999,
  },
  fotoTagDepois: { backgroundColor: C.orange },
  fotoLegenda: { marginTop: 2, fontSize: 8.5, color: C.muted },

  ajuda: { marginTop: 12, backgroundColor: C.canvas, borderRadius: 10, paddingVertical: 8, paddingHorizontal: 16 },
  ajudaTitulo: { fontSize: 10, fontWeight: 700, color: C.navy },
  ajudaTexto: { fontSize: 10, lineHeight: 1.5, color: "#505268" },

  rodape: {
    position: "absolute", bottom: 0, left: 0, right: 0, height: FOOTER_H,
    paddingHorizontal: PAD, justifyContent: "center", borderTopWidth: 1, borderTopColor: C.line,
  },
  rodapeLinha: { flexDirection: "row", justifyContent: "space-between" },
  rodapeTexto: { fontSize: 8.5, color: C.faint },
  rodapeForte: { fontSize: 8.5, color: C.ink, fontWeight: 600 },
});

function Linhas({ itens }: { itens: Linha[] }) {
  return (
    <View>
      {itens.map((l, i) => (
        <View key={`${l.rotulo}-${i}`} style={i === itens.length - 1 ? [s.linha, s.linhaUltima] : s.linha} wrap={false}>
          <Text style={s.linhaKey}>{l.rotulo}</Text>
          <Text style={s.linhaVal}>{l.valor}</Text>
        </View>
      ))}
    </View>
  );
}

/** @react-pdf só desenha JPEG e PNG: HEIC/WebP virava um quadro vazio no relatório. */
function desenhavel(p: SignedPhoto): boolean {
  return !/\.(heic|heif|webp|gif|avif|tiff?)(\?|$)/i.test(p.url.split("#")[0] ?? "");
}

/** Grade de fotos: `porLinha` por linha, altura fixa, linha incompleta à esquerda. */
/** Largura útil do A4 com as margens da página, em pontos. */
const LARGURA_UTIL = 595.28 - PAD * 2;

function Grade({ fotos, porLinha, altura, tag, depois, chave, larguraTotal = LARGURA_UTIL }: { fotos: SignedPhoto[]; porLinha: number; altura: number; tag?: string; depois?: boolean; chave: string; larguraTotal?: number }) {
  const gap = 6;
  // Em pontos, não em %: o @react-pdf não desconta o gap da porcentagem e a linha quebrava.
  const largura = Math.floor((larguraTotal - (porLinha - 1) * gap) / porLinha);
  const linhas: SignedPhoto[][] = [];
  for (let i = 0; i < fotos.length; i += porLinha) linhas.push(fotos.slice(i, i + porLinha));
  // Uma linha por bloco que não quebra: a linha inteira desce de página, nunca passa por cima do rodapé.
  return (
    <View>
      {linhas.map((linha, li) => (
        <View key={`${chave}-l${li}`} style={{ flexDirection: "row", gap, marginTop: li ? gap : 0 }} wrap={false}>
          {linha.map((p, i) => (
            <View key={`${chave}-${li}-${i}`} style={{ width: largura, position: "relative" }}>
              <Image src={p.url} style={{ width: "100%", height: altura, objectFit: "cover", borderRadius: 8, backgroundColor: C.canvas }} />
              {tag ? <Text style={depois ? [s.fotoTag, s.fotoTagDepois] : s.fotoTag}>{tag}</Text> : null}
              {p.label ? <Text style={s.fotoLegenda}>{p.label}</Text> : null}
            </View>
          ))}
        </View>
      ))}
    </View>
  );
}

/**
 * Fotos compactas (dono, 22/10/2026: "cabe quase em uma página"). Antes e depois com até
 * 4 fotos cada: lado a lado, duas colunas. Mais que isso: uma seção por fase, 4 por linha.
 */
function Fotos({ antes, depois }: { antes: SignedPhoto[]; depois: SignedPhoto[] }) {
  if (antes.length === 0 && depois.length === 0) return null;
  if (antes.length > 0 && depois.length > 0 && antes.length <= 4 && depois.length <= 4) {
    const porLinha = Math.max(antes.length, depois.length) === 1 ? 1 : 2;
    const altura = porLinha === 1 ? 150 : 100;
    const metade = (LARGURA_UTIL - 14) / 2;
    return (
      <View style={{ flexDirection: "row", gap: 14 }} wrap={false}>
        <View style={{ flex: 1 }}>
          <Text style={s.h2}>Before.</Text>
          <Grade fotos={antes} porLinha={porLinha} altura={altura} tag="Before" chave="a" larguraTotal={metade} />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={s.h2}>After.</Text>
          <Grade fotos={depois} porLinha={porLinha} altura={altura} tag="After" depois chave="d" larguraTotal={metade} />
        </View>
      </View>
    );
  }
  // 10 de cada (ou mais): 5 por linha, para antes e depois caberem juntos.
  const muitas = antes.length + depois.length > 12;
  const porLinha = muitas ? 6 : 4;
  const altura = muitas ? 62 : 92;
  const secao = (titulo: string, fotos: SignedPhoto[], tag?: string, ehDepois?: boolean) =>
    fotos.length === 0 ? null : (
      <View>
        {/* Título preso à primeira linha de fotos: nunca fica sozinho no pé da página. */}
        <View wrap={false}>
          <Text style={s.h2}>{titulo}</Text>
          <Grade fotos={fotos.slice(0, porLinha)} porLinha={porLinha} altura={altura} tag={tag} depois={ehDepois} chave={`${titulo}-1`} />
        </View>
        {fotos.length > porLinha ? (
          <View style={{ marginTop: 6 }}>
            <Grade fotos={fotos.slice(porLinha)} porLinha={porLinha} altura={altura} tag={tag} depois={ehDepois} chave={`${titulo}-2`} />
          </View>
        ) : null}
      </View>
    );
  if (antes.length > 0 && depois.length > 0) {
    return (
      <>
        {secao("Before.", antes, "Before")}
        {secao("After.", depois, "After", true)}
      </>
    );
  }
  return secao("Photos.", [...antes, ...depois]);
}

export function JobReportPDF({ data }: { data: JobReportPDFData }): React.ReactElement {
  const final = data.final?.report;
  const start = data.start?.report;
  const status = typeof final?.fields?.completion_status === "string" ? String(final.fields.completion_status) : null;
  const parcial = status === "partially_complete" || status === "not_complete" || status === "incomplete";
  const concluido = dataCurta(final?.submittedAt ?? null);
  const descricao =
    textoDe(final, "description") ??
    textoDe(final, "inspection_summary") ??
    (final ? `${data.jobTitle || "The work"} completed${data.propertyAddress ? ` at ${data.propertyAddress}` : ""}.` : null);
  const detalhes = linhasDoCliente(final).filter((l) => l.valor !== descricao);
  const naChegada = linhasDoCliente(start).filter((l) => l.rotulo !== "Time on site");
  const descricaoInicio = textoDe(start, "description");

  const antes = (data.start?.signedPhotos ?? []).filter(desenhavel);
  const depois = (data.final?.signedPhotos ?? []).filter(desenhavel);

  const estado = !final ? "In progress" : parcial ? "Partly complete" : "Complete";
  // Uma linha só (dono, 22/10/2026: box mais baixo): endereço largo, data e booking.
  const celulas = [
    ...(data.propertyAddress ? [{ k: "Property", v: data.propertyAddress, largo: true }] : []),
    ...(concluido ? [{ k: final ? "Completed" : "Visit", v: concluido }] : []),
    { k: "Booking", v: data.reference },
  ] as { k: string; v: string; largo?: boolean }[];
  // Valor curto vira bloco (Time on site · 1h); texto comprido fica em linha.
  const curtos = detalhes.filter((l) => l.valor.length <= 18).slice(0, 4);
  const longos = detalhes.filter((l) => !curtos.includes(l));

  return (
    <Document title={`${data.reference} · Job report`} author="Fixfy">
      <Page size="A4" style={s.page}>
        <View style={s.topo}>
          <Image src={LOGO} style={s.logo} />
          <Text style={s.topoRef}>Booking {data.reference}</Text>
        </View>

        <Text style={s.eyebrow}>Job report</Text>
        <Text style={s.h1}>{!final ? "Work in progress." : parcial ? "Work update." : "Work complete."}</Text>
        <Text style={s.intro}>
          Here is a summary of the work and photos from the visit.
        </Text>

        <View style={s.card} wrap={false}>
          <View style={s.cardTopo}>
            <View style={{ flex: 1, paddingRight: 12 }}>
              <Text style={s.cardServico}>{data.jobTitle || "Fixfy service"}</Text>
            </View>
            <Text style={s.pilula}>{estado}</Text>
          </View>
          <View style={s.painel}>
            <View style={s.painelLinha}>
              {celulas.map((c, i) => (
                <View key={c.k} style={[s.celula, i > 0 ? s.celulaDivisa : {}, c.largo ? { flex: 2.2 } : {}]}>
                  <Text style={s.celulaKey}>{c.k}</Text>
                  <Text style={s.celulaVal}>{c.v}</Text>
                </View>
              ))}
            </View>
            {/* O que foi feito dentro do mesmo card (dono, 22/10/2026): sobra a página para as fotos. */}
            {descricao ? (
              <View style={[s.celulaLarga, { borderTopWidth: 1, borderTopColor: C.line, borderBottomWidth: curtos.length || longos.length ? 1 : 0 }]}>
                <Text style={s.celulaKey}>What we did</Text>
                <Text style={[s.paragrafo, { color: C.navy }]}>{descricao}</Text>
              </View>
            ) : null}
            {curtos.length > 0 ? (
              <View style={[s.painelLinha, longos.length ? { borderBottomWidth: 1, borderBottomColor: C.line } : {}]}>
                {curtos.map((l, i) => (
                  <View key={l.rotulo} style={i > 0 ? [s.celula, s.celulaDivisa] : s.celula}>
                    <Text style={s.celulaKey}>{l.rotulo}</Text>
                    <Text style={s.celulaVal}>{l.valor}</Text>
                  </View>
                ))}
              </View>
            ) : null}
            {longos.map((l, i) => (
              <View key={l.rotulo} style={[s.celulaLarga, i === longos.length - 1 ? { borderBottomWidth: 0 } : {}]}>
                <Text style={s.celulaKey}>{l.rotulo}</Text>
                <Text style={s.celulaVal}>{l.valor}</Text>
              </View>
            ))}
          </View>
        </View>

        {descricaoInicio || naChegada.length > 0 ? (
          <View>
            <View wrap={false}>
              <Text style={s.h2}>On arrival.</Text>
              {descricaoInicio ? <Text style={[s.paragrafo, { marginBottom: naChegada.length ? 12 : 0 }]}>{descricaoInicio}</Text> : null}
            </View>
            {naChegada.length > 0 ? <Linhas itens={naChegada} /> : null}
          </View>
        ) : null}

        <Fotos antes={antes} depois={depois} />

        <View style={s.rodape} fixed>
          <View style={s.rodapeLinha}>
            {/* A ajuda mora no rodapé: em toda página e nunca empurra o relatório para uma folha a mais. */}
            <Text style={s.rodapeForte}>Anything not quite right? Reply to the email or WhatsApp us on +44 20 4538 4668.</Text>
            <Text style={s.rodapeTexto} render={({ pageNumber, totalPages }) => `${pageNumber} / ${totalPages}`} />
          </View>
          <Text style={[s.rodapeTexto, { marginTop: 4 }]}>getfixfy.com · hello@getfixfy.com · Getfixfy Ltd, trading as Fixfy · 124 City Road, London EC1V 2NX · Company number 15406523</Text>
        </View>
      </Page>
    </Document>
  );
}
