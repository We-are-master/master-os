import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/service";
import { MarkdownBody } from "../markdown-body";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const NAVY = "#020040";
const ORANGE = "#ED4B00";

type BlogPost = {
  slug: string;
  title: string;
  excerpt: string | null;
  body_md: string;
  product: string;
  cover_image_url: string | null;
  seo_title: string | null;
  seo_description: string | null;
  author: string;
  tags: string[];
  published_at: string | null;
};

const PRODUCT_LABEL: Record<string, string> = {
  fixfy: "For your property",
  trades: "For trades",
  general: "Fixfy",
};

function fmtDate(iso: string | null): string {
  if (!iso) return "";
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
}

async function getPost(slug: string): Promise<BlogPost | null> {
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("blog_posts")
      .select("slug, title, excerpt, body_md, product, cover_image_url, seo_title, seo_description, author, tags, published_at")
      .eq("slug", slug)
      .eq("status", "published")
      .maybeSingle();
    return (data as BlogPost) ?? null;
  } catch {
    return null;
  }
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) return { title: "Article not found — Fixfy" };
  const title = post.seo_title || `${post.title} — Fixfy`;
  const description = post.seo_description || post.excerpt || undefined;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: "article",
      ...(post.cover_image_url ? { images: [{ url: post.cover_image_url }] } : {}),
    },
  };
}

export default async function BlogPostPage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const post = await getPost(slug);
  if (!post) notFound();

  return (
    <main className="min-h-screen" style={{ background: "var(--surface)" }}>
      {/* Navy header band — stays navy in both themes */}
      <header style={{ background: NAVY }} className="px-6 py-10 sm:py-14">
        <div className="mx-auto max-w-2xl">
          <Link href="/blog" className="mb-8 inline-flex items-center text-sm font-semibold text-white/70 hover:text-white">
            ← The Fixfy blog
          </Link>
          <div className="mt-6 flex items-center gap-3 text-xs font-semibold">
            <span className="uppercase tracking-[0.12em]" style={{ color: ORANGE }}>
              {PRODUCT_LABEL[post.product] ?? "Fixfy"}
            </span>
            <span className="text-white/60">{fmtDate(post.published_at)}</span>
          </div>
          <h1 className="mt-3 text-3xl font-bold leading-tight tracking-tight text-white sm:text-4xl">
            {post.title}
          </h1>
          {post.excerpt ? (
            <p className="mt-4 text-lg leading-relaxed text-white/70">{post.excerpt}</p>
          ) : null}
        </div>
      </header>

      {post.cover_image_url ? (
        <div className="mx-auto max-w-2xl px-6">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={post.cover_image_url}
            alt={post.title}
            className="-mt-6 w-full rounded-2xl border shadow-[0_8px_30px_rgba(2,0,64,0.10)]"
            style={{ borderColor: "var(--border-color)" }}
          />
        </div>
      ) : null}

      <article className="mx-auto max-w-2xl px-6 py-10 sm:py-14">
        <MarkdownBody>{post.body_md}</MarkdownBody>

        {post.tags && post.tags.length > 0 ? (
          <div className="mt-10 flex flex-wrap gap-2">
            {post.tags.map((t) => (
              <span
                key={t}
                className="rounded-full px-3 py-1 text-xs font-medium"
                style={{ background: "var(--surface-secondary)", color: "var(--text-tertiary)" }}
              >
                #{t}
              </span>
            ))}
          </div>
        ) : null}

        {/* CTA — navy in both themes */}
        <div className="mt-12 rounded-2xl px-7 py-8 text-center" style={{ background: NAVY }}>
          <p className="text-xl font-bold text-white">Something need fixing?</p>
          <p className="mt-2 text-white/70">Forward it to Fixfy — we’ll take it from here.</p>
          <a
            href="https://getfixfy.com"
            className="mt-5 inline-block rounded-full bg-white px-6 py-3 text-sm font-bold"
            style={{ color: NAVY }}
          >
            Get a quote →
          </a>
        </div>

        <p className="mt-8 text-xs" style={{ color: "var(--text-tertiary)" }}>
          By {post.author} · Fixfy
        </p>
      </article>
    </main>
  );
}
