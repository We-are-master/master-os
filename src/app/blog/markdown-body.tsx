"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

const ORANGE = "#ED4B00";
const tPrimary = "var(--text-primary)";
const tSecondary = "var(--text-secondary)";

/** Brand-styled, theme-aware markdown renderer for blog post bodies. */
const components: Components = {
  h1: (p) => <h1 style={{ color: tPrimary }} className="mt-10 mb-4 text-3xl font-bold tracking-tight" {...p} />,
  h2: (p) => <h2 style={{ color: tPrimary }} className="mt-10 mb-3 text-2xl font-bold tracking-tight" {...p} />,
  h3: (p) => <h3 style={{ color: tPrimary }} className="mt-8 mb-2 text-xl font-semibold" {...p} />,
  p: (p) => <p style={{ color: tSecondary }} className="my-4 text-[17px] leading-8" {...p} />,
  ul: (p) => <ul style={{ color: tSecondary }} className="my-4 list-disc space-y-2 pl-6 text-[17px] leading-8" {...p} />,
  ol: (p) => <ol style={{ color: tSecondary }} className="my-4 list-decimal space-y-2 pl-6 text-[17px] leading-8" {...p} />,
  li: (p) => <li className="leading-8" {...p} />,
  a: (p) => <a style={{ color: ORANGE }} className="font-medium underline underline-offset-2" {...p} />,
  blockquote: (p) => (
    <blockquote
      style={{ color: tSecondary, background: "var(--surface-tertiary)", borderColor: ORANGE }}
      className="my-6 border-l-4 py-2 pl-5 pr-3 text-[17px] italic"
      {...p}
    />
  ),
  strong: (p) => <strong style={{ color: tPrimary }} className="font-semibold" {...p} />,
  hr: () => <hr style={{ borderColor: "var(--border-color)" }} className="my-10" />,
  code: (p) => (
    <code style={{ background: "var(--surface-tertiary)", color: tPrimary }} className="rounded px-1.5 py-0.5 text-[15px]" {...p} />
  ),
};

export function MarkdownBody({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
