-- Compteur de la vraie IA (fonction « fw-ia ») : plafonds par visiteur et pour toute l'application, par jour (UTC),
-- en nombre de demandes et en dollars dépensés.
-- Seule la fonction, avec la clé secrète du projet, peut l'utiliser : la page publique n'y a pas accès.
-- Le visiteur n'est connu que par une empreinte de son adresse, salée et changée chaque jour (calculée dans la fonction).
-- Ce fichier se rejoue tel quel sur une base qui a déjà la version précédente (ancienne fonction fw_ia_take, sans
-- budget : elle reste dans la base mais la fonction ne l'appelle plus).

create table if not exists public.fw_ia_use (
  day date not null,
  who text not null,
  n integer not null default 0,
  win_start timestamptz not null default now(),
  win_n integer not null default 0,
  cost bigint not null default 0,
  primary key (day, who)
);
-- Dépense du jour en micro-dollars (millionièmes de dollar), réservations des appels en cours comprises.
alter table public.fw_ia_use add column if not exists cost bigint not null default 0;
alter table public.fw_ia_use enable row level security;
revoke all on table public.fw_ia_use from anon, authenticated;

-- Prend une place si les plafonds le permettent et réserve le coût le plus haut possible de l'appel (p_cost, en
-- micro-dollars) : des demandes simultanées ne peuvent pas dépasser le budget. La ligne « * » compte toute l'application.
create or replace function public.fw_ia_reserve(p_who text, p_ip_day integer, p_ip_minute integer, p_all_day integer,
  p_ip_cost bigint, p_all_cost bigint, p_cost bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d date := (now() at time zone 'utc')::date;
  g public.fw_ia_use;
  r public.fw_ia_use;
begin
  if p_who is null or length(p_who) < 8 or length(p_who) > 80 or p_who = '*' then
    return jsonb_build_object('ok', false, 'why', 'visiteur');
  end if;
  if p_cost is null or p_cost < 0 or p_ip_cost is null or p_all_cost is null then
    return jsonb_build_object('ok', false, 'why', 'cout');
  end if;
  insert into public.fw_ia_use (day, who) values (d, '*') on conflict do nothing;
  select * into g from public.fw_ia_use where day = d and who = '*' for update;
  if g.n >= p_all_day then
    return jsonb_build_object('ok', false, 'why', 'jour_global');
  end if;
  if g.cost + p_cost > p_all_cost then
    return jsonb_build_object('ok', false, 'why', 'budget');
  end if;
  insert into public.fw_ia_use (day, who) values (d, p_who) on conflict do nothing;
  select * into r from public.fw_ia_use where day = d and who = p_who for update;
  if r.n >= p_ip_day then
    return jsonb_build_object('ok', false, 'why', 'jour_visiteur');
  end if;
  if r.cost + p_cost > p_ip_cost then
    return jsonb_build_object('ok', false, 'why', 'budget_visiteur');
  end if;
  if now() - r.win_start < interval '1 minute' and r.win_n >= p_ip_minute then
    return jsonb_build_object('ok', false, 'why', 'minute');
  end if;
  update public.fw_ia_use
     set n = n + 1,
         cost = cost + p_cost,
         win_n = case when now() - win_start >= interval '1 minute' then 1 else win_n + 1 end,
         win_start = case when now() - win_start >= interval '1 minute' then now() else win_start end
   where day = d and who = p_who;
  update public.fw_ia_use set n = n + 1, cost = cost + p_cost where day = d and who = '*';
  return jsonb_build_object('ok', true, 'day', d, 'left', p_ip_day - r.n - 1, 'all_left', p_all_day - g.n - 1);
end;
$$;
revoke all on function public.fw_ia_reserve(text, integer, integer, integer, bigint, bigint, bigint) from public, anon, authenticated;
grant execute on function public.fw_ia_reserve(text, integer, integer, integer, bigint, bigint, bigint) to service_role;

-- Coût réel d'un appel, une fois la réponse reçue : p_cost est ajouté (coût réel moins réservation, souvent négatif).
-- Jour réservé (p_day ; aujourd'hui sinon). p_who « * » : toute l'application seulement (vérification de la clé).
create or replace function public.fw_ia_spend(p_day date, p_who text, p_cost bigint)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  d date := coalesce(p_day, (now() at time zone 'utc')::date);
begin
  if p_who is null or length(p_who) > 80 or p_cost is null then
    return jsonb_build_object('ok', false);
  end if;
  -- Même ordre que fw_ia_reserve (« * » d'abord) : deux appels simultanés ne peuvent pas se bloquer l'un l'autre.
  insert into public.fw_ia_use as u (day, who, cost) values (d, '*', greatest(p_cost, 0))
    on conflict (day, who) do update set cost = greatest(u.cost + p_cost, 0);
  if p_who <> '*' then
    insert into public.fw_ia_use as u (day, who, cost) values (d, p_who, greatest(p_cost, 0))
      on conflict (day, who) do update set cost = greatest(u.cost + p_cost, 0);
  end if;
  return jsonb_build_object('ok', true);
end;
$$;
revoke all on function public.fw_ia_spend(date, text, bigint) from public, anon, authenticated;
grant execute on function public.fw_ia_spend(date, text, bigint) to service_role;

-- Nombre de demandes et dépense du jour (micro-dollars), pour l'écran d'administration.
create or replace function public.fw_ia_today()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object(
    'used', coalesce((select n from public.fw_ia_use where day = (now() at time zone 'utc')::date and who = '*'), 0),
    'cost', coalesce((select cost from public.fw_ia_use where day = (now() at time zone 'utc')::date and who = '*'), 0));
$$;
revoke all on function public.fw_ia_today() from public, anon, authenticated;
grant execute on function public.fw_ia_today() to service_role;
