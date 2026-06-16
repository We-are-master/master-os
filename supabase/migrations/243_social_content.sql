-- Social Media Designer agent: content queue for blog posts + social posts.
-- Filled by the n8n "Social Media Designer" workflow; approved 1-tap via signed
-- links; the public site reads published blog rows; n8n polls approved social
-- rows to publish to the native platform nodes (LinkedIn/Instagram/Facebook/X).
--
-- RLS is enabled with NO policies: the service role (API routes / cron) bypasses
-- it, while anon/auth keys are blocked — same pattern as 241_email_sequences.

-- ─── Blog posts ──────────────────────────────────────────────────────────────
create table if not exists public.blog_posts (
  id              uuid primary key default gen_random_uuid(),
  slug            text not null unique,
  title           text not null,
  excerpt         text,
  body_md         text not null default '',
  cover_image_url text,
  product         text not null default 'general'
                    check (product in ('fixfy','trades','general')),
  tags            text[] not null default '{}',
  seo_title       text,
  seo_description text,
  author          text not null default 'Fixfy',
  status          text not null default 'draft'
                    check (status in ('draft','approved','published','rejected','archived')),
  approval_token  text not null default encode(gen_random_bytes(24),'hex'),
  source          text not null default 'n8n',
  published_at    timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists blog_posts_status_published_idx
  on public.blog_posts (status, published_at desc);

-- ─── Social posts (the creative + its target channels) ───────────────────────
create table if not exists public.social_posts (
  id              uuid primary key default gen_random_uuid(),
  product         text not null default 'general'
                    check (product in ('fixfy','trades','general')),
  format          text not null default 'square'
                    check (format in ('square','story','landscape')),
  caption         text not null default '',
  hashtags        text[] not null default '{}',
  image_url       text,                       -- usually the /api/og/social render URL
  platforms       text[] not null default '{}', -- e.g. {linkedin,instagram,facebook,x}
  status          text not null default 'draft'
                    check (status in ('draft','approved','published','rejected','archived')),
  approval_token  text not null default encode(gen_random_bytes(24),'hex'),
  source          text not null default 'n8n',
  scheduled_for   timestamptz,
  published_at    timestamptz,
  external_refs   jsonb not null default '{}'::jsonb, -- {linkedin:{id,url},...} after publish
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists social_posts_status_idx
  on public.social_posts (status, created_at desc);

alter table public.blog_posts   enable row level security;
alter table public.social_posts enable row level security;
