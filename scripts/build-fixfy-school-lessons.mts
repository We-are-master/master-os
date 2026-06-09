/**
 * Converts HTML guide chapters into Fixfy School cinematic lesson scenes.
 * Run: npm run build:school-lessons
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FIXFY_SCHOOL_PHASES, type SchoolLesson } from "../src/lib/fixfy-school-curriculum.ts";

const OUT = join(process.cwd(), "public/school/fixfy-school/school-lessons.generated.js");

/** Hand-crafted cinematic lessons — do not overwrite from HTML. */
const SKIP_IDS = new Set([
  "zendesk-welcome",
  "zendesk-flow-job",
  "zendesk-flow-quote",
  "zendesk-flow-complaint",
  "zendesk-flow-finance",
  "fixfy-os-jobs",
  "products-services-board",
]);

const ICONS = [
  "rocket",
  "layout-grid",
  "circle-dot",
  "clipboard-list",
  "zap",
  "git-branch",
  "link",
  "wrench",
  "book-open",
  "monitor",
  "users",
  "briefcase",
  "calendar",
  "file-text",
  "hard-hat",
  "smartphone",
  "banknote",
  "shield-check",
];

function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseChapterFromAsset(assetPath: string): { file: string; slug: string } {
  const [file, hash = ""] = assetPath.split("#");
  const slug = hash.replace(/^chapter-/, "");
  if (!slug) throw new Error(`No chapter hash in ${assetPath}`);
  const diskPath = join(process.cwd(), "public", file.replace(/^\//, ""));
  return { file: diskPath, slug };
}

function extractChapter(html: string, slug: string): string {
  const marker = `data-chapter="${slug}"`;
  const startIdx = html.indexOf(marker);
  if (startIdx === -1) throw new Error(`Chapter banner "${slug}" not found`);

  const anchor = `id="chapter-${slug}"`;
  let contentStart = html.indexOf(anchor, startIdx);
  if (contentStart !== -1) {
    contentStart = html.indexOf(">", contentStart) + 1;
  } else {
    const bannerEnd = html.indexOf("</div>", startIdx);
    contentStart = html.indexOf(">", bannerEnd) + 1;
  }

  const nextBanner = html.indexOf("school-chapter-banner", contentStart + 20);
  const mainEnd = html.indexOf("</main>", contentStart);
  let end = html.length;
  if (nextBanner !== -1) end = Math.min(end, nextBanner);
  if (mainEnd !== -1) end = Math.min(end, mainEnd);

  return html.slice(contentStart, end);
}

function cleanChapterHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<div class="school-chapter-banner[\s\S]*?<\/div>\s*/gi, "")
    .replace(/<div id="chapter-[^"]*"><\/div>\s*/gi, "")
    .replace(/<\/?section[^>]*>/gi, "")
    .replace(/<\/?nav[^>]*>/gi, "")
    .replace(/<div style="page-break-after:always;"><\/div>/gi, "")
    .replace(/<div class="section-start"[^>]*><\/div>\s*/gi, "")
    .replace(/<h1[^>]*>[\s\S]*?<\/h1>/i, "")
    .replace(/<div class="section-eyebrow">[\s\S]*?<\/div>\s*/gi, "")
    .replace(/<div class="section-divider"><\/div>\s*/gi, "")
    .trim();
}

type Section = { title: string; html: string };

function splitSections(html: string): Section[] {
  const cleaned = cleanChapterHtml(html);
  if (!cleaned) return [{ title: "Overview", html: "<p>No content.</p>" }];

  const h2Parts = cleaned.split(/(?=<h2[\s>])/i).filter((p) => p.trim());
  const sections: Section[] = [];

  for (const part of h2Parts) {
    const h2 = part.match(/^<h2[^>]*>([\s\S]*?)<\/h2>/i);
    if (!h2) {
      const text = stripTags(part).slice(0, 80);
      sections.push({ title: text ? "Overview" : "Introduction", html: part.trim() });
      continue;
    }

    const h2Title = stripTags(h2[1] ?? "Section");
    const afterH2 = part.slice(h2[0].length).trim();
    const h3Parts = afterH2.split(/(?=<h3[\s>])/i).filter((p) => p.trim());

    if (h3Parts.length <= 1) {
      sections.push({ title: h2Title, html: afterH2 || "<p>—</p>" });
      continue;
    }

    const beforeFirstH3 = h3Parts[0]?.trim() ?? "";
    if (beforeFirstH3 && stripTags(beforeFirstH3).length > 0) {
      sections.push({ title: h2Title, html: beforeFirstH3 });
    }

    for (const h3Part of h3Parts) {
      const h3 = h3Part.match(/^<h3[^>]*>([\s\S]*?)<\/h3>/i);
      if (h3) {
        const title = `${h2Title} — ${stripTags(h3[1] ?? "Section")}`;
        const body = h3Part.slice(h3[0].length).trim();
        sections.push({ title, html: body || "<p>—</p>" });
      }
    }
  }

  if (sections.length === 0) {
    sections.push({ title: "Overview", html: cleaned });
  }

  return sections;
}

function sanitizeOperators(text: string): string {
  return text
    .replace(/Carlos Perez/gi, "Triage operator")
    .replace(/Isabela Gil/gi, "Operations operator")
    .replace(/Victor Braz/gi, "Finance operator")
    .replace(/\bCarlos\b/gi, "Triage operator")
    .replace(/\bIsabela\b/gi, "Operations operator")
    .replace(/\bVictor\b/gi, "Finance operator")
    .replace(/hands to the Operations operator\./gi, "hands to the Operations operator.")
    .replace(/assigns the assignee automatically/gi, "assigns the operator automatically")
    .replace(/assigns the assignee/gi, "assigns the operator")
    .replace(/the right person/gi, "the right operator")
    .replace(/Three agents share/gi, "Three operator tracks share")
    .replace(/Meet your team/gi, "Three operator tracks")
    .replace(/Your squad — 3 agent tracks/gi, "Three operator tracks")
    .replace(/Nice work, Victor\./gi, "Nice work.");
}

function transformContentHtml(html: string): string {
  return sanitizeOperators(
    html
    .replace(/\bclass="callout"/g, 'class="sc-callout sc-legacy-callout"')
    .replace(/\bclass="callout-title"/g, 'class="sc-callout__k"')
    .replace(/<div class="sc-callout sc-legacy-callout">\s*<div class="sc-callout__k">([^<]*)<\/div>\s*<p>/g, (_, t) =>
      `<div class="sc-callout sc-legacy-callout"><div class="sc-callout__k">${t}</div><div class="sc-callout__t"><p>`,
    )
    .replace(/\bclass="diagram"/g, 'class="sc-diagram sc-legacy-diagram"')
    .replace(/\bclass="role-card\b[^"]*"/g, 'class="sc-legacy-role"')
    .replace(/\bclass="data"/g, 'class="sc-table sc-legacy-table"')
    .replace(/\btable class="/g, 'table class="sc-table sc-legacy-table ')
    .replace(/<table(?![^>]*class)/gi, '<table class="sc-table sc-legacy-table"'),
  );
}

function coverScene(lesson: SchoolLesson, phaseLabel: string, sceneCount: number, icon: string): string {
  return (
    '<div class="sc-scene__inner">' +
    `<div class="sc-cover__badge sc-anim"><i data-lucide="${icon}"></i></div>` +
    `<div class="sc-scene__eyebrow sc-anim d1">${esc(phaseLabel)} · Lesson ${lesson.order}</div>` +
    `<h2 class="sc-anim d1">${esc(lesson.title)}</h2>` +
    `<p class="sc-lead sc-anim d2" style="margin-left:auto;margin-right:auto;text-align:center">${esc(lesson.description)}</p>` +
    '<div class="sc-cover__meta sc-anim d3">' +
    `<span class="fx-pill fx-pill--coral"><i data-lucide="clock" style="width:12px;height:12px"></i>${lesson.durationMin} min</span>` +
    `<span class="fx-pill"><i data-lucide="zap" style="width:12px;height:12px"></i>+${lesson.xp} XP</span>` +
    `<span class="fx-pill">${sceneCount} scenes</span>` +
    "</div></div>" +
    '<div class="sc-scrollhint"><span>Scroll to begin</span><i data-lucide="chevrons-down"></i></div>'
  );
}

function readScene(section: Section, index: number, lessonTitle: string, xp: number, dark: boolean): string {
  const num = String(index).padStart(2, "0");
  const body = transformContentHtml(section.html);
  return (
    '<div class="sc-scene__inner">' +
    `<div class="sc-scene__num sc-anim">${num}</div>` +
    `<div class="sc-scene__eyebrow sc-anim">${esc(lessonTitle)}</div>` +
    `<h2 class="sc-anim d1">${esc(section.title)}</h2>` +
    `<div class="sc-content sc-anim d2">${body}</div>` +
    "</div>"
  );
}

function buildLessonScenes(
  lesson: SchoolLesson,
  phaseLabel: string,
  chapterHtml: string,
  icon: string,
) {
  const sections = splitSections(chapterHtml);
  const readCount = sections.length;
  const totalScenes = 1 + readCount;
  const baseXp = Math.max(5, Math.floor(lesson.xp / readCount));
  let xpAssigned = 0;

  const scenes: { type: string; xp: number; dark?: boolean; html: string; correct?: number }[] = [
    { type: "cover", xp: 0, html: coverScene(lesson, phaseLabel, totalScenes, icon) },
  ];

  sections.forEach((section, i) => {
    const isLast = i === readCount - 1;
    const xp = isLast ? Math.max(5, lesson.xp - xpAssigned) : baseXp;
    xpAssigned += xp;
    scenes.push({
      type: "read",
      xp,
      dark: i % 3 === 2,
      html: readScene(section, i + 1, lesson.title, xp, i % 3 === 2),
    });
  });

  return scenes;
}

function jsString(s: string): string {
  return JSON.stringify(s);
}

const lessons: Record<string, unknown> = {};
let built = 0;
let skipped = 0;

for (const phase of FIXFY_SCHOOL_PHASES) {
  const phaseLabel = `${phase.subtitle} · ${phase.title}`;
  const sorted = [...phase.lessons].sort((a, b) => a.order - b.order);

  for (const lesson of sorted) {
    if (SKIP_IDS.has(lesson.id)) {
      skipped++;
      continue;
    }
    if (lesson.format !== "html" || !lesson.assetPath) continue;

    try {
      const { file, slug } = parseChapterFromAsset(lesson.assetPath);
      const html = readFileSync(file, "utf8");
      let chapterHtml = sanitizeOperators(extractChapter(html, slug));
      const icon = ICONS[(lesson.order - 1) % ICONS.length] ?? "book-open";
      const scenes = buildLessonScenes(lesson, phaseLabel, chapterHtml, icon);

      lessons[lesson.id] = {
        id: lesson.id,
        title: lesson.title,
        phaseId: lesson.phaseId,
        phase: phaseLabel,
        xp: lesson.xp,
        scenes,
      };
      built++;
    } catch (err) {
      console.error(`[build:school-lessons] ${lesson.id}:`, err instanceof Error ? err.message : err);
    }
  }
}

const lines = [
  "/* AUTO-GENERATED — npm run build:school-lessons */",
  "window.FX_SCHOOL_LESSONS = {",
  ...Object.entries(lessons).map(([id, lesson]) => {
    return `  ${jsString(id)}: ${JSON.stringify(lesson)},`;
  }),
  "};",
  "",
];

writeFileSync(OUT, lines.join("\n"), "utf8");
console.log(`Wrote ${OUT} — ${built} lessons (${skipped} skipped)`);
