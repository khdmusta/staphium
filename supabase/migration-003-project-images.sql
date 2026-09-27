-- ============================================================================
-- MIGRATION 003 — project_images (gallery per project)
-- Run AFTER schema.sql: Supabase → SQL Editor → New query → paste → Run.
-- Safe to run multiple times.
-- ============================================================================

create table if not exists public.project_images (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.projects(id) on delete cascade,
  image_url    text not null,
  sort         integer not null default 0,
  created_at   timestamptz not null default now()
);

create index if not exists idx_project_images_project
  on public.project_images(project_id, sort);

alter table public.project_images enable row level security;

-- visitors: read images of PUBLISHED projects only
drop policy if exists "public read published project_images" on public.project_images;
create policy "public read published project_images" on public.project_images
  for select using (
    exists (
      select 1 from public.projects p
      where p.id = project_images.project_id
        and p.is_published = true
    )
  );

-- dashboard (logged-in): full management
drop policy if exists "auth manage project_images" on public.project_images;
create policy "auth manage project_images" on public.project_images
  for all to authenticated using (true) with check (true);
