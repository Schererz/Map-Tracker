-- Map Tracker — estrutura do banco no Supabase.
-- Rode este arquivo inteiro no SQL Editor do projeto (Supabase > SQL Editor > New query).

create extension if not exists pgcrypto with schema extensions;

-- ================= Trajetos (públicos) =================

create table if not exists public.routes (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(trim(name)) between 1 and 80),
  distance_m double precision not null check (distance_m > 0 and distance_m < 500000),
  waypoints jsonb not null check (jsonb_typeof(waypoints) = 'array'),
  segments jsonb not null check (jsonb_typeof(segments) = 'array'),
  created_at timestamptz not null default now(),
  -- Evita que alguém encha o banco com um trajeto gigante
  constraint routes_size check (pg_column_size(waypoints) + pg_column_size(segments) < 1000000)
);

alter table public.routes enable row level security;

drop policy if exists "Qualquer um pode ver trajetos" on public.routes;
create policy "Qualquer um pode ver trajetos"
  on public.routes for select
  to anon, authenticated
  using (true);

drop policy if exists "Qualquer um pode salvar trajetos" on public.routes;
create policy "Qualquer um pode salvar trajetos"
  on public.routes for insert
  to anon, authenticated
  with check (true);

-- Não há policy de update/delete: pela API ninguém altera nem exclui direto.
-- A exclusão só acontece pela função delete_route, que confere a senha.

-- ================= Senha do administrador =================

create table if not exists public.admin_config (
  id int primary key check (id = 1),
  password_hash text not null
);

-- RLS ligado e sem nenhuma policy: a tabela fica inacessível pela API
alter table public.admin_config enable row level security;

create or replace function public.delete_route(route_id uuid, password text)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  stored_hash text;
begin
  select password_hash into stored_hash from public.admin_config where id = 1;

  if stored_hash is null or extensions.crypt(password, stored_hash) <> stored_hash then
    perform pg_sleep(1); -- atrasa tentativas de adivinhar a senha
    raise exception 'Senha incorreta' using errcode = '28P01';
  end if;

  delete from public.routes where id = route_id;
  return found; -- false se o trajeto já tinha sido excluído
end;
$$;

revoke all on function public.delete_route(uuid, text) from public;
grant execute on function public.delete_route(uuid, text) to anon, authenticated;

-- ================= Definir / trocar a senha =================
-- Rode SEPARADAMENTE no SQL Editor, trocando TROQUE_AQUI pela sua senha.
-- Não salve a senha real neste arquivo.
--
-- insert into public.admin_config (id, password_hash)
-- values (1, extensions.crypt('TROQUE_AQUI', extensions.gen_salt('bf')))
-- on conflict (id) do update set password_hash = excluded.password_hash;
