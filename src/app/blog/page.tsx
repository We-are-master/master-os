import Link from "next/link";
import type { Metadata } from "next";
import { createServiceClient } from "@/lib/supabase/service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export const metadata: Metadata = {
  title: "Blog — Fixfy",
  description: "Practical maintenance advice, trust and transparency, and stories from the people who keep things running. Maintenance, handled.",
};

const NAVY = "#020040";
const ORANGE = "#ED4B00";
const MUTED = "#6B6B85";

type BlogCard = {
  slug: string;
  title: string;
  excerpt: string | null;
  product: string;
  cover_image_url: string | null;
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

export default async function BlogIndexPage() {
  let posts: BlogCard[] = [];
  try {
    const admin = createServiceClient();
    const { data } = await admin
      .from("blog_posts")
      .select("slug, title, excerpt, product, cover_image_url, published_at")
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(60);
    posts = (data as BlogCard[]) ?? [];
  } catch {
    posts = [];
  }

  return (
    <main className="min-h-screen bg-[#F7F7FB]">
      {/* Header band */}
      <header style={{ background: NAVY }} className="px-6 py-14 sm:py-20">
        <div className="mx-auto max-w-3xl">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logos/fixfy-wordmark-white-trim.png" alt="Fixfy" className="mb-8 h-7 w-auto" />
          <p className="mb-3 text-xs font-bold uppercase tracking-[0.16em]" style={{ color: ORANGE }}>
            The Fixfy blog
          </p>
          <h1 className="text-4xl font-bold leading-tight tracking-tight text-white sm:text-5xl">
            Maintenance, handled.
          </h1>
          <p className="mt-4 max-w-xl text-lg leading-relaxed text-white/70">
            Practical advice, straight talk on trust and transparency, and stories from the people who
            keep things running.
          </p>
        </div>
      </header>

      <section className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        {posts.length === 0 ? (
          <p className="text-center text-[15px]" style={{ color: MUTED }}>
            New articles are on the way. Check back soon.
          </p>
        ) : (
          <div className="flex flex-col gap-5">
            {posts.map((post) => (
              <Link
                key={post.slug}
                href={`/blog/${post.slug}`}
                className="group block overflow-hidden rounded-2xl border border-[#E4E4EC] bg-white shadow-[0_1px_3px_rgba(2,0,64,0.05)] transition hover:shadow-[0_8px_30px_rgba(2,0,64,0.10)]"
              >
                <div className="flex flex-col gap-1 p-6 sm:p-7">
                  <div className="flex items-center gap-3 text-xs font-semibold" style={{ color: ORANGE }}>
                    <span className="uppercase tracking-[0.12em]">{PRODUCT_LABEL[post.product] ?? "Fixfy"}</span>
                    <span style={{ color: MUTED }}>{fmtDate(post.published_at)}</span>
                  </div>
                  <h2 className="mt-1 text-xl font-bold leading-snug tracking-tight text-[#0A0A1F] group-hover:text-[#020040]">
                    {post.title}
                  </h2>
                  {post.excerpt ? (
                    <p className="mt-1 text-[15px] leading-relaxed" style={{ color: MUTED }}>
                      {post.excerpt}
                    </p>
                  ) : null}
                  <span className="mt-3 text-sm font-semibold" style={{ color: ORANGE }}>
                    Read more →
                  </span>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <footer className="px-6 pb-12 text-center text-xs" style={{ color: MUTED }}>
        <span className="inline-flex items-center gap-2">
          <span className="inline-block h-2 w-2 rounded-full" style={{ background: ORANGE }} />
          getfixfy.com
        </span>
      </footer>
    </main>
  );
}
