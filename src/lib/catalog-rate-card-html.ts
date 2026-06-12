import type { CatalogRateCardPayload } from "@/lib/catalog-rate-card-core";
import type { CatalogRateCardContent } from "@/lib/catalog-rate-card-content-types";
import type { CatalogRateCardServiceRow } from "@/lib/catalog-rate-card-core";
import { FIXFY_WHITE_LOGO_URL } from "@/lib/client-catalog-content";

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderServiceCard(svc: CatalogRateCardServiceRow): string {
  if (svc.missing) {
    return `<div class="card"><h3>${esc(svc.name)}</h3>${svc.description ? `<p class="desc">${esc(svc.description)}</p>` : ""}<p class="por">Priced on request</p></div>`;
  }
  if (svc.pricingStyle === "hourly") {
    const line = svc.lines[0];
    return `<div class="card rate"><div><h3>${esc(svc.name)}</h3>${svc.description ? `<p class="desc">${esc(svc.description)}</p>` : ""}</div>${line ? `<div class="rate-price"><span class="amt">${esc(line.price.replace("/h", ""))}</span><span class="unit">/hour</span></div>` : ""}</div>`;
  }
  const presets = svc.presets.map((l) => `<li><span>${esc(l.label)}</span><strong>${esc(l.price)}</strong></li>`).join("");
  const addons = svc.addons.map((l) => `<li><span>${esc(l.label)}</span><strong>${esc(l.price)}</strong></li>`).join("");
  const single = svc.lines.length === 1 && svc.presets.length === 0 ? `<p class="single-price">${esc(svc.lines[0].price)}</p>` : "";
  return `<div class="card"><h3>${esc(svc.name)}</h3>${svc.description ? `<p class="desc">${esc(svc.description)}</p>` : ""}${single}${presets ? `<ul class="prices">${presets}</ul>` : ""}${addons ? `<p class="block-k muted">Add-ons</p><ul class="prices">${addons}</ul>` : ""}</div>`;
}

export function renderCatalogRateCardHtml(
  payload: CatalogRateCardPayload,
  content: CatalogRateCardContent,
): string {
  const generated = new Date(payload.generatedAt).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
  const { hero, about, commitments, pricingIntro } = content;

  const pillars = about.pillars
    .map(
      (p) =>
        `<div class="pillar"><span class="pillar-num">${p.num}</span><h3>${esc(p.title)}</h3><p>${esc(p.body)}</p></div>`,
    )
    .join("");

  const stats = commitments.stats
    .map((s) => `<div class="stat"><div class="stat-val">${esc(s.value)}</div><div class="stat-lbl">${esc(s.label)}</div></div>`)
    .join("");

  const priceSections = payload.categories
    .map((cat) => {
      const intro =
        cat.id === "trades"
          ? `<p class="lede">Skilled trades billed by the hour — one-hour minimum, then in 30-minute increments.</p>`
          : "";
      return `<div class="price-cat"><p class="kicker">${esc(cat.label)}</p><h3>${esc(cat.label)}</h3>${intro}<div class="cards">${cat.services.map(renderServiceCard).join("")}</div></div>`;
    })
    .join("");

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Fixfy — ${esc(hero.kicker)}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background: #F7F7FB; color: #020040; line-height: 1.5; }
    .cover { min-height: 100vh; background: linear-gradient(105deg, #020040 28%, #020040 58%, rgba(237,75,0,0.15)); color: #fff; padding: 48px 24px; display: flex; flex-direction: column; justify-content: center; }
    .cover img { height: 48px; width: auto; }
    .kicker { font-size: 11px; font-weight: 700; letter-spacing: 0.2em; text-transform: uppercase; color: #ED4B00; margin-top: 40px; }
    .cover h1 { font-size: clamp(2rem, 6vw, 3.5rem); font-weight: 700; line-height: 1.08; margin-top: 16px; max-width: 18ch; }
    .cover h1 em { font-style: normal; color: #ED4B00; }
    .cover .sub { margin-top: 24px; max-width: 36rem; color: rgba(255,255,255,0.78); font-size: 1.05rem; }
    .section { padding: 64px 24px; max-width: 52rem; margin: 0 auto; }
    .section h2 { font-size: 2rem; font-weight: 700; margin-top: 12px; line-height: 1.15; }
    .lede { color: #57534E; margin-top: 16px; font-size: 1rem; }
    .pillars { display: grid; gap: 16px; margin-top: 40px; }
    @media (min-width: 720px) { .pillars { grid-template-columns: repeat(3, 1fr); } }
    .pillar { background: #fff; border: 1px solid #E7E5E4; border-radius: 16px; padding: 24px; }
    .pillar-num { font-size: 12px; font-weight: 700; color: #ED4B00; }
    .pillar h3 { margin-top: 12px; font-size: 1rem; }
    .pillar p { margin-top: 8px; font-size: 14px; color: #57534E; }
    .band { background: #020040; color: #fff; padding: 64px 24px; }
    .band-inner { max-width: 52rem; margin: 0 auto; }
    .band h2 { font-size: 2rem; font-weight: 700; max-width: 24ch; }
    .stats { display: grid; gap: 24px; margin-top: 40px; }
    @media (min-width: 720px) { .stats { grid-template-columns: repeat(3, 1fr); } }
    .stat-val { font-size: 2rem; font-weight: 700; color: #ED4B00; }
    .stat-lbl { margin-top: 8px; font-size: 14px; color: rgba(255,255,255,0.72); }
    .price-cat { margin-bottom: 48px; }
    .price-cat h3 { font-size: 1.5rem; margin-top: 4px; }
    .cards { margin-top: 20px; display: grid; gap: 12px; }
    .card { background: #fff; border: 1px solid #E7E5E4; border-radius: 16px; padding: 20px; }
    .card h3 { font-size: 16px; }
    .desc { font-size: 14px; color: #57534E; margin-top: 6px; }
    .rate { display: flex; justify-content: space-between; gap: 16px; align-items: flex-start; }
    .amt { font-size: 1.5rem; font-weight: 700; }
    .unit { font-size: 13px; color: #57534E; }
    .single-price { font-size: 1.25rem; font-weight: 700; margin-top: 12px; }
    .prices { list-style: none; margin-top: 12px; }
    .prices li { display: flex; justify-content: space-between; padding: 10px 0; border-bottom: 1px solid #F5F5F4; font-size: 14px; }
    footer { text-align: center; padding: 48px 24px; font-size: 12px; color: #57534E; border-top: 1px solid #E7E5E4; background: #fff; }
    footer a { color: #ED4B00; font-weight: 600; }
  </style>
</head>
<body>
  <section class="cover">
    <img src="${esc(FIXFY_WHITE_LOGO_URL)}" alt="Fixfy" width="140" height="48">
    <p class="kicker">${esc(hero.kicker)}</p>
    <h1>${esc(hero.titleLine1)}<br>${esc(hero.titleLine2)}<br><em>${esc(hero.titleEmphasis)}</em></h1>
    <p class="sub">${esc(hero.subtitle)}</p>
  </section>
  <section class="section" id="about">
    <p class="kicker">${esc(about.kicker)}</p>
    <h2>${esc(about.title)}</h2>
    <p class="lede">${esc(about.lede)}</p>
    <div class="pillars">${pillars}</div>
  </section>
  <section class="band">
    <div class="band-inner">
      <h2>${esc(commitments.title)}</h2>
      <div class="stats">${stats}</div>
    </div>
  </section>
  <section class="section" id="prices">
    <p class="kicker">${esc(pricingIntro.kicker)}</p>
    <h2>${esc(pricingIntro.title)}</h2>
    <p class="lede">${esc(pricingIntro.lede)}</p>
    <div style="margin-top:48px">${priceSections}</div>
  </section>
  <footer>
    <p>Updated ${esc(generated)}.</p>
    <p style="margin-top:12px"><a href="${esc(content.portalLink)}">${esc(content.portalLabel)}</a></p>
  </footer>
</body>
</html>`;
}
