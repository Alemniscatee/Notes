-- ============================================================
-- AURA Life Dashboard — Esquema Supabase
-- Pega esto en Supabase → SQL Editor → Run.
-- Realtime se habilita con las sentencias de publication al final.
-- ============================================================

-- ---------- NOTAS ----------
create table if not exists public.notas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  titulo        text not null default 'Sin título',
  materia       text not null default '',
  contenido     text not null default '',
  imagenes      jsonb not null default '[]',          -- [{name, dataURL}]
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- TAREAS ----------
create table if not exists public.tareas (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  titulo        text not null default '',
  materia       text not null default '',
  vence         timestamptz,                          -- null = sin fecha
  contenido     text not null default '',
  hecho         boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- MATERIAS ----------
create table if not exists public.materias (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid not null default auth.uid(),
  nombre                  text not null,
  codigo                  text not null default '',
  color                   text not null default '#8b5cf6',
  profesor                text not null default '',
  "profesorNombre"        text not null default '',
  "profesorDescripcion"   text not null default '',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

-- ---------- CLASES (Horario fijo) ----------
create table if not exists public.clases (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid(),
  "materiaId"   uuid references public.materias(id) on delete set null,
  materia       text not null default '',             -- snapshot del nombre
  aula          text not null default '',
  inicio        text not null default '08:00',        -- 'HH:MM'
  fin           text not null default '09:00',
  dias          smallint[] not null default '{}',     -- [1..6] L–S
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- ---------- updated_at automático ----------
create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists notas_touch on public.notas;
create trigger notas_touch before update on public.notas
  for each row execute function public.touch_updated_at();
drop trigger if exists tareas_touch on public.tareas;
create trigger tareas_touch before update on public.tareas
  for each row execute function public.touch_updated_at();
drop trigger if exists materias_touch on public.materias;
create trigger materias_touch before update on public.materias
  for each row execute function public.touch_updated_at();
drop trigger if exists clases_touch on public.clases;
create trigger clases_touch before update on public.clases
  for each row execute function public.touch_updated_at();

-- ---------- Row Level Security (1 usuario = sus datos) ----------
alter table public.notas    enable row level security;
alter table public.tareas   enable row level security;
alter table public.materias enable row level security;
alter table public.clases   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['notas','tareas','materias','clases'] loop
    execute format('drop policy if exists "own_all" on public.%I', t);
    execute format('create policy "own_all" on public.%I for all
      using (auth.uid() = user_id) with check (auth.uid() = user_id)', t);
  end loop;
end $$;

-- ---------- Índices de consulta ----------
create index if not exists notas_user_updated   on public.notas   (user_id, updated_at desc);
create index if not exists notas_user_materia   on public.notas   (user_id, materia);
create index if not exists tareas_user_pend     on public.tareas  (user_id, hecho, vence);
create index if not exists materias_user_nombre on public.materias(user_id, nombre);
create index if not exists clases_user_inicio   on public.clases  (user_id, inicio);

-- ---------- Realtime: emitir INSERT/UPDATE/DELETE ----------
drop publication if exists supabase_realtime;
create publication supabase_realtime for table
  public.notas, public.tareas, public.materias, public.clases;
