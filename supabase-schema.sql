-- ============================================================
-- Arbeitszeit Tracker – Supabase Schema
-- Einmalig im Supabase-Dashboard unter "SQL Editor" ausführen.
-- Voraussetzung: Supabase Auth ist aktiviert (Standard).
-- ============================================================

-- ---------- Tabellen ----------

create table if not exists public.cost_centers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  color_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.projects (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  cost_center_id uuid references public.cost_centers(id) on delete cascade,
  code text not null,
  name text not null,
  color_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.entries (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  date date not null,
  start text,
  "end" text,
  pause_start text,
  pause_end text,
  activity text,
  total_minutes integer not null default 0,
  allocations jsonb not null default '[]',
  project_allocations jsonb not null default '[]',
  labor_allocations jsonb not null default '[]',
  labor_minutes integer not null default 0,
  source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.labs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  code text not null,
  name text not null,
  color_index integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.contracts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  weekly_hours numeric,
  months jsonb not null default '[]',
  created_at timestamptz not null default now()
);

create table if not exists public.vacations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  start_date date not null,
  end_date date not null,
  created_at timestamptz not null default now()
);

create table if not exists public.settings (
  user_id uuid primary key references auth.users(id) on delete cascade,
  employee_name text,
  timer_state jsonb
);

-- Profildaten (Name, Wochenstunden, Urlaubstage/Jahr) für den Excel-Export.
-- "add column if not exists" ist sicher, auch wenn das Schema schon einmal ausgeführt wurde.
alter table public.entries add column if not exists labor_allocations jsonb not null default '[]';

alter table public.settings add column if not exists first_name text;
alter table public.settings add column if not exists last_name text;
alter table public.settings add column if not exists weekly_hours numeric;
alter table public.settings add column if not exists vacation_days_per_year numeric;

-- ---------- Indizes ----------

create index if not exists entries_user_date_idx on public.entries(user_id, date);
create index if not exists cost_centers_user_idx on public.cost_centers(user_id);
create index if not exists projects_user_idx on public.projects(user_id);
create index if not exists projects_cc_idx on public.projects(cost_center_id);
create index if not exists labs_user_idx on public.labs(user_id);
create index if not exists contracts_user_idx on public.contracts(user_id);
create index if not exists vacations_user_idx on public.vacations(user_id, start_date);

-- ---------- Row Level Security ----------
-- Jede Zeile gehört genau einem Nutzer (user_id = auth.uid()).
-- Damit sehen/ändern Kolleg:innen nur ihre eigenen Daten, egal von welchem Gerät.

alter table public.cost_centers enable row level security;
alter table public.projects     enable row level security;
alter table public.entries      enable row level security;
alter table public.vacations    enable row level security;
alter table public.labs         enable row level security;
alter table public.contracts    enable row level security;
alter table public.settings     enable row level security;

-- "drop policy if exists" davor macht das Skript gefahrlos wiederholbar.
drop policy if exists "own rows" on public.cost_centers;
create policy "own rows" on public.cost_centers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.projects;
create policy "own rows" on public.projects
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.entries;
create policy "own rows" on public.entries
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.labs;
create policy "own rows" on public.labs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.contracts;
create policy "own rows" on public.contracts
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.vacations;
create policy "own rows" on public.vacations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own rows" on public.settings;
create policy "own rows" on public.settings
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------- Realtime ----------
-- Aktiviert Live-Updates, damit ein zweites Gerät mit demselben Konto
-- Änderungen automatisch mitbekommt (ohne Neuladen).
-- Der DO-Block überspringt Tabellen, die bereits registriert sind, damit ein erneutes
-- Ausführen des Skripts nicht mit "already member of publication" abbricht.

do $$
declare t text;
begin
  foreach t in array array['cost_centers', 'projects', 'labs', 'contracts', 'entries', 'vacations', 'settings'] loop
    if not exists (
      select 1 from pg_publication_tables
      where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    ) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;
