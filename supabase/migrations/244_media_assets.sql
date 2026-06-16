-- Image bank for the Social Media Designer. Lets the content agent pick a REAL
-- photo for some posts/blog covers (news/story/seasonal) instead of always the
-- static brand template. Owned photos are preferred; Pexels stock is cached here
-- as a fallback. RLS enabled, no policies — service role only (same as 243).

create table if not exists public.media_assets (
  id           uuid primary key default gen_random_uuid(),
  url          text not null,
  source       text not null default 'own'
                 check (source in ('own','pexels','ai')),
  tags         text[] not null default '{}',
  theme        text,
  alt          text,
  credit       text,                       -- e.g. "Photo by X on Pexels"
  width        int,
  height       int,
  orientation  text not null default 'landscape'
                 check (orientation in ('landscape','portrait','square')),
  external_id  text,                       -- e.g. Pexels photo id, for dedupe
  created_at   timestamptz not null default now()
);

-- Fast lookup by orientation + tag overlap (own bank first).
create index if not exists media_assets_orientation_idx
  on public.media_assets (orientation, source, created_at desc);
create index if not exists media_assets_tags_idx
  on public.media_assets using gin (tags);
create unique index if not exists media_assets_pexels_unique
  on public.media_assets (source, external_id)
  where external_id is not null;

alter table public.media_assets enable row level security;
