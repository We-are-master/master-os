"use client";

import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";

/** Brand-styled markdown renderer for blog post bodies (no typography plugin needed). */
const components: Components = {
  h1: (p) => <h1 className="mt-10 mb-4 text-3xl font-bold tracking-tight text-[#0A0A1F]" {...p} />,
  h2: (p) => <h2 className="mt-10 mb-3 text-2xl font-bold tracking-tight text-[#0A0A1F]" {...p} />,
  h3: (p) => <h3 className="mt-8 mb-2 text-xl font-semibold text-[#0A0A1F]" {...p} />,
  p: (p) => <p className="my-4 text-[17px] leading-8 text-[#33334d]" {...p} />,
  ul: (p) => <ul className="my-4 list-disc space-y-2 pl-6 text-[17px] leading-8 text-[#33334d]" {...p} />,
  ol: (p) => <ol className="my-4 list-decimal space-y-2 pl-6 text-[17px] leading-8 text-[#33334d]" {...p} />,
  li: (p) => <li className="leading-8" {...p} />,
  a: (p) => <a className="font-medium text-[#ED4B00] underline underline-offset-2" {...p} />,
  blockquote: (p) => (
    <blockquote className="my-6 border-l-4 border-[#ED4B00] bg-[#F7F7FB] py-2 pl-5 pr-3 text-[17px] italic text-[#33334d]" {...p} />
  ),
  strong: (p) => <strong className="font-semibold text-[#0A0A1F]" {...p} />,
  hr: () => <hr className="my-10 border-[#E4E4EC]" />,
  code: (p) => <code className="rounded bg-[#F0F0F6] px-1.5 py-0.5 text-[15px] text-[#020040]" {...p} />,
};

export function MarkdownBody({ children }: { children: string }) {
  return <ReactMarkdown components={components}>{children}</ReactMarkdown>;
}
