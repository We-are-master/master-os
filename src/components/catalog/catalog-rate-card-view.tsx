import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import type { CatalogRateCardContent } from "@/lib/catalog-rate-card-content-types";
import type { CatalogRateCardServiceRow } from "@/lib/catalog-rate-card-core";
import { FIXFY_WHITE_LOGO_URL } from "@/lib/client-catalog-content";
import { cn } from "@/lib/utils";

type CatalogRateCardViewProps = {
  payload: CatalogRateCardPayload;
  content: CatalogRateCardContent;
  className?: string;
};

function ServiceCard({ svc }: { svc: CatalogRateCardServiceRow }) {
  if (svc.missing) {
    return (
      <div className="rounded-2xl border border-[#E7E5E4]/80 bg-white p-5 shadow-[0_2px_24px_rgba(2,0,64,0.04)]">
        <h3 className="text-base font-semibold text-[#020040]">{svc.name}</h3>
        {svc.description ? (
          <p className="mt-1.5 text-sm leading-relaxed text-[#57534E]">{svc.description}</p>
        ) : null}
        <p className="mt-3 text-sm font-medium text-[#57534E]">Priced on request</p>
      </div>
    );
  }

  if (svc.pricingStyle === "hourly") {
    const line = svc.lines[0];
    return (
      <div className="flex flex-col gap-4 rounded-2xl border border-[#E7E5E4]/80 bg-white p-5 shadow-[0_2px_24px_rgba(2,0,64,0.04)] sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 flex-1">
          <h3 className="text-base font-semibold text-[#020040]">{svc.name}</h3>
          {svc.description ? (
            <p className="mt-1.5 text-sm leading-relaxed text-[#57534E]">{svc.description}</p>
          ) : null}
        </div>
        {line ? (
          <div className="shrink-0 sm:text-right">
            <p className="text-2xl font-bold tracking-tight text-[#020040]">
              {line.price.replace("/h", "")}
              <span className="text-sm font-semibold text-[#57534E]">/hour</span>
            </p>
            <p className="mt-0.5 text-xs font-medium text-[#57534E]">1-hour minimum</p>
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className="rounded-2xl border border-[#E7E5E4]/80 bg-white p-5 shadow-[0_2px_24px_rgba(2,0,64,0.04)]">
      <h3 className="text-base font-semibold text-[#020040]">{svc.name}</h3>
      {svc.description ? (
        <p className="mt-1.5 text-sm leading-relaxed text-[#57534E]">{svc.description}</p>
      ) : null}
      {svc.presets.length > 0 ? (
        <div className="mt-4">
          {svc.presets.length > 1 || svc.addons.length > 0 ? (
            <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#ED4B00]">
              {svc.addons.length > 0 ? "Packages" : "Options"}
            </p>
          ) : null}
          <ul className="divide-y divide-[#F5F5F4]">
            {svc.presets.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm text-[#020040]">{line.label}</span>
                <span className="shrink-0 text-sm font-bold text-[#020040]">{line.price}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : svc.lines.length === 1 ? (
        <p className="mt-4 text-xl font-bold text-[#020040]">{svc.lines[0].price}</p>
      ) : null}
      {svc.addons.length > 0 ? (
        <div className="mt-4 border-t border-[#F5F5F4] pt-4">
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[#57534E]">Add-ons</p>
          <ul className="divide-y divide-[#F5F5F4]">
            {svc.addons.map((line) => (
              <li key={line.id} className="flex items-start justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
                <span className="text-sm text-[#57534E]">{line.label}</span>
                <span className="shrink-0 text-sm font-bold text-[#020040]">{line.price}</span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function CatalogRateCardView({ payload, content, className }: CatalogRateCardViewProps) {
  const generated = new Date(payload.generatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const { hero, about, commitments, pricingIntro } = content;

  return (
    <div className={cn("min-h-screen bg-[#F7F7FB] text-[#020040] antialiased", className)}>
      <section className="relative flex min-h-[100dvh] flex-col justify-center overflow-hidden bg-[#020040] text-white">
        <div
          className="pointer-events-none absolute inset-0 opacity-90"
          style={{
            background:
              "linear-gradient(105deg, rgba(2,0,64,0.97) 28%, rgba(2,0,64,0.72) 58%, rgba(237,75,0,0.12) 100%)",
          }}
        />
        <div className="relative z-10 mx-auto w-full max-w-4xl px-6 py-16 sm:px-10">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={FIXFY_WHITE_LOGO_URL}
            alt="Fixfy"
            width={140}
            height={48}
            className="h-10 w-auto sm:h-12"
            fetchPriority="high"
          />
          <p className="mt-10 text-[11px] font-bold uppercase tracking-[0.2em] text-[#ED4B00]">{hero.kicker}</p>
          <h1 className="mt-4 max-w-2xl text-4xl font-bold leading-[1.08] tracking-tight sm:text-5xl lg:text-6xl">
            {hero.titleLine1}
            <br />
            {hero.titleLine2}
            <br />
            <em className="not-italic text-[#ED4B00]">{hero.titleEmphasis}</em>
          </h1>
          <p className="mt-6 max-w-xl text-base leading-relaxed text-white/78 sm:text-lg">{hero.subtitle}</p>
          <div className="mt-10 flex flex-wrap gap-3">
            <a
              href="#prices"
              className="inline-flex items-center rounded-full bg-[#ED4B00] px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-[#ED4B00]/25 transition hover:bg-[#d44300]"
            >
              See rates ↓
            </a>
            <a
              href="#about"
              className="inline-flex items-center rounded-full border border-white/25 bg-white/5 px-6 py-3 text-sm font-semibold text-white backdrop-blur-sm transition hover:bg-white/10"
            >
              {about.kicker}
            </a>
          </div>
        </div>
      </section>

      <section id="about" className="bg-[#F7F7FB] px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ED4B00]">{about.kicker}</p>
          <h2 className="mt-3 max-w-2xl text-3xl font-bold leading-tight tracking-tight text-[#020040] sm:text-4xl">
            {about.title}
          </h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#57534E] sm:text-lg">{about.lede}</p>
          <div className="mt-12 grid gap-5 sm:grid-cols-3">
            {about.pillars.map((pillar) => (
              <div
                key={pillar.num}
                className="rounded-2xl border border-[#E7E5E4]/80 bg-white p-6 shadow-[0_2px_24px_rgba(2,0,64,0.04)]"
              >
                <span className="text-xs font-bold tabular-nums text-[#ED4B00]">{pillar.num}</span>
                <h3 className="mt-3 text-base font-bold text-[#020040]">{pillar.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-[#57534E]">{pillar.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="relative overflow-hidden bg-[#020040] px-6 py-20 text-white sm:px-10">
        <div className="relative mx-auto max-w-4xl">
          <h2 className="max-w-xl text-3xl font-bold leading-tight tracking-tight sm:text-4xl">
            {commitments.title}
          </h2>
          <div className="mt-12 grid gap-8 sm:grid-cols-3">
            {commitments.stats.map((stat) => (
              <div key={stat.value}>
                <p className="text-3xl font-bold tracking-tight text-[#ED4B00] sm:text-4xl">{stat.value}</p>
                <p className="mt-2 text-sm leading-relaxed text-white/72">{stat.label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section id="prices" className="scroll-mt-4 px-6 py-20 sm:px-10">
        <div className="mx-auto max-w-4xl">
          <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-[#ED4B00]">{pricingIntro.kicker}</p>
          <h2 className="mt-3 text-3xl font-bold tracking-tight text-[#020040] sm:text-4xl">{pricingIntro.title}</h2>
          <p className="mt-4 max-w-2xl text-base leading-relaxed text-[#57534E]">{pricingIntro.lede}</p>

          <div className="mt-14 space-y-16">
            {payload.categories.map((cat) => (
              <div key={cat.id}>
                <div className="mb-6 flex items-end justify-between gap-4 border-b border-[#E7E5E4] pb-4">
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-[0.14em] text-[#ED4B00]">{cat.label}</p>
                    <h3 className="mt-1 text-2xl font-bold text-[#020040]">{cat.label}</h3>
                  </div>
                </div>
                {cat.id === "trades" ? (
                  <p className="mb-5 text-sm text-[#57534E]">
                    Skilled trades billed by the hour — one-hour minimum, then in 30-minute increments.
                  </p>
                ) : null}
                <div className="space-y-3">
                  {cat.services.map((svc) => (
                    <ServiceCard key={svc.id} svc={svc} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-[#E7E5E4] bg-white px-6 py-12 text-center sm:px-10">
        <p className="text-lg font-bold tracking-tight text-[#020040]">
          fix<span className="text-[#ED4B00]">fy</span>
        </p>
        <p className="mt-2 text-xs leading-relaxed text-[#57534E]">Updated {generated}.</p>
        <a
          href={content.portalLink}
          className="mt-4 inline-block text-sm font-semibold text-[#ED4B00] hover:underline"
          target="_blank"
          rel="noopener noreferrer"
        >
          {content.portalLabel}
        </a>
      </footer>
    </div>
  );
}
