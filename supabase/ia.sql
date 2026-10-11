-- Compteur de la vraie IA (fonction « fw-ia ») : plafonds par visiteur et pour toute l'application, par jour (UTC).
-- Seule la fonction, avec la clé secrète du projet, peut l'utiliser : la page publique n'y a pas accès.
-- Le visiteur n'est connu que par une empreinte de son adresse, salée et changée chaque jour (calculée dans la fonction).

create table if not exists public.fw_ia_use (
  day date not null,
  who text not null,
  n integer not null default 0,
  win_start timestamptz not null default now(),
  win_n integer not null default 0,
  primary key (day, who)
);
alter table public.fw_ia_use enable row level security;
revoke all on table public.fw_ia_use from anon, authenticated;

-- Prend une place si les plafonds le permettent. La ligne « * » compte toute l'application.
create or replace function public.fw_ia_take(p_who text, p_ip_day integer, p_ip_minute integer, p_all_day integer)
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
  insert into public.fw_ia_use (day, who) values (d, '*') on conflict do nothing;
  select * into g from public.fw_ia_use where day = d and who = '*' for update;
  if g.n >= p_all_day then
    return jsonb_build_object('ok', false, 'why', 'jour_global');
  end if;
  insert into public.fw_ia_use (day, who) values (d, p_who) on conflict do nothing;
  select * into r from public.fw_ia_use where day = d and who = p_who for update;
  if r.n >= p_ip_day then
    return jsonb_build_object('ok', false, 'why', 'jour_visiteur');
  end if;
  if now() - r.win_start < interval '1 minute' and r.win_n >= p_ip_minute then
    return jsonb_build_object('ok', false, 'why', 'minute');
  end if;
  update public.fw_ia_use
     set n = n + 1,
         win_n = case when now() - win_start >= interval '1 minute' then 1 else win_n + 1 end,
         win_start = case when now() - win_start >= interval '1 minute' then now() else win_start end
   where day = d and who = p_who;
  update public.fw_ia_use set n = n + 1 where day = d and who = '*';
  return jsonb_build_object('ok', true, 'left', p_ip_day - r.n - 1, 'all_left', p_all_day - g.n - 1);
end;
$$;
revoke all on function public.fw_ia_take(text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.fw_ia_take(text, integer, integer, integer) to service_role;

-- Nombre de demandes du jour, pour l'écran d'administration.
create or replace function public.fw_ia_today()
returns jsonb
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select jsonb_build_object('used', coalesce((select n from public.fw_ia_use where day = (now() at time zone 'utc')::date and who = '*'), 0));
$$;
revoke all on function public.fw_ia_today() from public, anon, authenticated;
grant execute on function public.fw_ia_today() to service_role;
