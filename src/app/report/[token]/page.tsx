import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { jobDoTokenDoRelatorio } from "@/lib/fatura-semanal";
import { carregarReportWeb } from "@/lib/report-web/dados";
import { Galeria } from "./galeria";

/**
 * O report do job para o cliente, na web (dono, 23/10/2026). Link assinado, só leitura,
 * um job: o mesmo token do PDF (/api/public/job-report/[token]), que fica como download.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Work report · Fixfy",
  robots: { index: false, follow: false },
};

export default async function ReportWebPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const jobId = jobDoTokenDoRelatorio(decodeURIComponent(token));
  if (!jobId) notFound();
  const r = await carregarReportWeb(createServiceClient(), jobId);
  if (!r) notFound();

  const pdf = `/api/public/job-report/${encodeURIComponent(token)}`;
  const tom = r.estado === "Complete" ? "bg-[#E3F5EA] text-[#1C7A43]" : "bg-[#FFF1E0] text-[#B25C00]";

  return (
    <main className="min-h-screen bg-[#F7F6FB] font-sans text-[#1A1A1A]">
      <header className="border-b border-[#E8E8EE] bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/fixfy-wordmark-navy-trim.png" alt="Fixfy" className="h-6" />
          <a href={pdf} className="rounded-lg border border-[#D9D6EA] px-3 py-1.5 text-sm font-medium text-[#1E1B4B] hover:bg-[#F2F0FA]">
            Download PDF
          </a>
        </div>
      </header>

      <div className="mx-auto max-w-5xl space-y-6 px-4 py-6 sm:py-10">
        <section className="rounded-2xl bg-[#1E1B4B] p-6 text-white sm:p-8">
          <p className="text-xs font-semibold uppercase tracking-[0.14em] text-[#F97316]">Work report</p>
          <h1 className="mt-2 text-2xl font-semibold sm:text-3xl">{r.titulo}</h1>
          <p className="mt-1 text-white/75">{r.endereco}</p>
          <div className="mt-5 flex flex-wrap items-center gap-2 text-sm">
            <span className={`rounded-full px-3 py-1 font-semibold ${tom}`}>{r.estado}</span>
            <span className="rounded-full bg-white/10 px-3 py-1">Booking {r.referencia}</span>
            {r.visitas.length ? <span className="rounded-full bg-white/10 px-3 py-1">{r.visitas.length > 1 ? `Visits: ${r.visitas.join(", ")}` : `Visit: ${r.visitas[0]}`}</span> : null}
            {r.totalDeFotos ? <span className="rounded-full bg-white/10 px-3 py-1">{r.totalDeFotos} photos</span> : null}
          </div>
        </section>

        {r.resumo || r.detalhes.length ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
            <h2 className="text-lg font-semibold text-[#1E1B4B]">What we did</h2>
            {r.resumo ? <p className="mt-3 whitespace-pre-line leading-relaxed text-[#2E3040]">{r.resumo}</p> : null}
            {r.detalhes.length ? (
              <dl className="mt-5 divide-y divide-[#EEEDF4] border-t border-[#EEEDF4]">
                {r.detalhes.map((l, i) => (
                  <div key={`${l.rotulo}-${i}`} className="grid gap-1 py-3 sm:grid-cols-[200px_1fr] sm:gap-4">
                    <dt className="text-sm font-medium text-[#6B6E7B]">{l.rotulo}</dt>
                    <dd className="whitespace-pre-line text-sm text-[#1A1A1A]">{l.valor}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </section>
        ) : null}

        {r.antes.length ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
            <h2 className="mb-5 text-lg font-semibold text-[#1E1B4B]">Before</h2>
            <Galeria grupos={r.antes} id="antes" />
          </section>
        ) : null}

        {r.depois.length ? (
          <section className="rounded-2xl bg-white p-6 shadow-sm sm:p-8">
            <h2 className="mb-5 text-lg font-semibold text-[#1E1B4B]">{r.antes.length ? "After" : "Photos"}</h2>
            <Galeria grupos={r.depois} id="depois" />
          </section>
        ) : null}

        <footer className="pb-8 pt-2 text-center text-xs text-[#6B6E7B]">
          Getfixfy Ltd, trading as Fixfy · 124 City Road, London EC1V 2NX · hello@getfixfy.com · +44 20 4538 4668
        </footer>
      </div>
    </main>
  );
}
