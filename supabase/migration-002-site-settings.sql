-- ============================================================================
-- MIGRATION 002 — site_settings (single-row table for footer/contact info)
-- Run AFTER schema.sql: Supabase → SQL Editor → New query → paste → Run.
-- Safe to run multiple times (IF NOT EXISTS / ON CONFLICT DO NOTHING).
-- ============================================================================

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

-- visitors: read the single public row
drop policy if exists "public read site_settings" on public.site_settings;
create policy "public read site_settings" on public.site_settings
  for select using (true);

-- dashboard (logged-in): manage settings
drop policy if exists "auth manage site_settings" on public.site_settings;
create policy "auth manage site_settings" on public.site_settings
  for all to authenticated using (true) with check (true);
