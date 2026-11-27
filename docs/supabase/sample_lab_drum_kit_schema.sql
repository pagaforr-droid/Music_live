-- ============================================================================
-- MIGRACIÓN SQL: Sample Lab — 1400 Samples Drum Kit & Selección Predeterminada
-- Compatible con usuarios autenticados y modo estudio local/banda (anon)
-- ============================================================================

-- 1. Asegurar buckets de almacenamiento ('samples' público para lectura rápida y 'audios')
insert into storage.buckets (id, name, public)
values ('samples', 'samples', true)
on conflict (id) do update set public = true;

insert into storage.buckets (id, name, public)
values ('audios', 'audios', true)
on conflict (id) do nothing;

-- Políticas de Storage para permitir subir y leer muestras del Drum Kit
do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'samples_public_read'
  ) then
    create policy "samples_public_read"
      on storage.objects for select
      using (bucket_id in ('samples', 'audios'));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'samples_studio_insert'
  ) then
    create policy "samples_studio_insert"
      on storage.objects for insert
      with check (bucket_id in ('samples', 'audios'));
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'storage' and tablename = 'objects' and policyname = 'samples_studio_update'
  ) then
    create policy "samples_studio_update"
      on storage.objects for update
      using (bucket_id in ('samples', 'audios'));
  end if;
end $$;

-- 2. Tabla de muestras del Drum Kit sincronizadas en Supabase Cloud
create table if not exists public.drum_kit_cloud_samples (
  id text primary key,
  user_id uuid null references auth.users(id) on delete set null,
  band_id uuid not null default '00000000-0000-0000-0000-000000000000',
  folder text not null,
  file_name text not null,
  display_name text not null,
  category text not null check (category in ('kick', 'snare', 'hat', 'crash', 'tom', 'melodic')),
  storage_bucket text not null default 'audios',
  storage_path text not null,
  public_url text not null,
  duration_sec numeric(8,4) not null default 0,
  peak_offset_sec numeric(8,5) not null default 0,
  detected_root_midi integer not null default 60,
  file_size_bytes bigint not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.drum_kit_cloud_samples enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drum_kit_cloud_samples' and policyname = 'drum_kit_cloud_samples_select'
  ) then
    create policy "drum_kit_cloud_samples_select"
      on public.drum_kit_cloud_samples for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drum_kit_cloud_samples' and policyname = 'drum_kit_cloud_samples_write'
  ) then
    create policy "drum_kit_cloud_samples_write"
      on public.drum_kit_cloud_samples for all
      using (true)
      with check (true);
  end if;
end $$;

-- 3. Tabla de configuración predeterminada / activa de piezas del usuario en Sample Lab
create table if not exists public.drum_kit_selections (
  id text primary key,
  user_id uuid null references auth.users(id) on delete set null,
  band_id uuid not null default '00000000-0000-0000-0000-000000000000',
  name text not null default 'Configuración Activa Sample Lab',
  slots_json jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.drum_kit_selections enable row level security;

do $$
begin
  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drum_kit_selections' and policyname = 'drum_kit_selections_select'
  ) then
    create policy "drum_kit_selections_select"
      on public.drum_kit_selections for select
      using (true);
  end if;

  if not exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'drum_kit_selections' and policyname = 'drum_kit_selections_write'
  ) then
    create policy "drum_kit_selections_write"
      on public.drum_kit_selections for all
      using (true)
      with check (true);
  end if;
end $$;
