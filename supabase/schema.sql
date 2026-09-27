-- ============================================================================
-- RZGFOLIO CMS — Supabase schema
-- Tables: projects / testimonials / posts  (+ RLS: public reads published,
-- authenticated users manage everything from the dashboard)
-- HOW: Supabase Dashboard → SQL Editor → paste & Run (see docs/CMS-SETUP.md)
-- ============================================================================

-- ---------- helpers ----------
create extension if not exists "pgcrypto";

create or replace function public.cms_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

-- ---------- 1. projects ----------
create table if not exists public.projects (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,          -- page link: ./projects/<slug>
  title        text not null,                 -- H4 (e.g. مِهاد)
  caption      text not null default '',      -- Caption line
  image_url    text not null default '',      -- card cover (imgbb URL)
  sort         integer not null default 0,    -- smaller = first
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
drop trigger if exists trg_projects_touch on public.projects;
create trigger trg_projects_touch
  before update on public.projects
  for each row execute function public.cms_touch_updated_at();

-- ---------- 2. testimonials ----------
create table if not exists public.testimonials (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,                 -- client name (e.g. فهد الدوسري)
  role         text not null default '',      -- role / company
  quote        text not null,                 -- the testimonial text
  avatar_url   text not null default '',      -- client photo (imgbb URL)
  rating       integer not null default 5 check (rating between 1 and 5),
  sort         integer not null default 0,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
drop trigger if exists trg_testimonials_touch on public.testimonials;
create trigger trg_testimonials_touch
  before update on public.testimonials
  for each row execute function public.cms_touch_updated_at();

-- ---------- 3. posts (blog) ----------
create table if not exists public.posts (
  id           uuid primary key default gen_random_uuid(),
  slug         text unique not null,          -- page link: ./blog/<slug>
  title        text not null,                 -- H3
  excerpt      text not null default '',      -- Description paragraph
  body         text not null default '',      -- full article (dashboard textarea)
  cover_url    text not null default '',      -- cover image (imgbb URL)
  date_label   text not null default '',      -- shown date (e.g. مارس 2025)
  published_at date null,                     -- for ordering
  sort         integer not null default 0,
  is_published boolean not null default false,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
drop trigger if exists trg_posts_touch on public.posts;
create trigger trg_posts_touch
  before update on public.posts
  for each row execute function public.cms_touch_updated_at();

-- ---------- 4. RLS ----------
alter table public.projects     enable row level security;
alter table public.testimonials enable row level security;
alter table public.posts        enable row level security;

-- public (visitors): read ONLY published rows
drop policy if exists "public read published projects" on public.projects;
create policy "public read published projects" on public.projects
  for select using (is_published = true);

drop policy if exists "public read published testimonials" on public.testimonials;
create policy "public read published testimonials" on public.testimonials
  for select using (is_published = true);

drop policy if exists "public read published posts" on public.posts;
create policy "public read published posts" on public.posts
  for select using (is_published = true);

-- dashboard (logged-in via Supabase Auth): full management
drop policy if exists "auth manage projects" on public.projects;
create policy "auth manage projects" on public.projects
  for all to authenticated using (true) with check (true);

drop policy if exists "auth manage testimonials" on public.testimonials;
create policy "auth manage testimonials" on public.testimonials
  for all to authenticated using (true) with check (true);

drop policy if exists "auth manage posts" on public.posts;
create policy "auth manage posts" on public.posts
  for all to authenticated using (true) with check (true);

-- ---------- 4. site_settings (single row: footer / contact info) ----------
create table if not exists public.site_settings (
  id             integer primary key default 1 check (id = 1),
  email          text not null default '',
  x_url          text not null default '',
  linkedin_url   text not null default '',
  copyright_text text not null default '',
  contact_title  text not null default '',
  updated_at     timestamptz not null default now()
);
drop trigger if exists trg_site_settings_touch on public.site_settings;
create trigger trg_site_settings_touch
  before update on public.site_settings
  for each row execute function public.cms_touch_updated_at();

insert into public.site_settings (id) values (1)
on conflict (id) do nothing;

alter table public.site_settings enable row level security;

drop policy if exists "public read site_settings" on public.site_settings;
create policy "public read site_settings" on public.site_settings
  for select using (true);

drop policy if exists "auth manage site_settings" on public.site_settings;
create policy "auth manage site_settings" on public.site_settings
  for all to authenticated using (true) with check (true);
