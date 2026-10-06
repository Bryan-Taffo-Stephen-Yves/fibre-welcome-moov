-- Fibre Welcome : dernière mise à jour du serveur (à coller une seule fois dans l'éditeur SQL de Supabase, puis « Run »).
-- Elle ajoute l'effacement des images et sauvegardes d'un espace (suppression, réinitialisation) et un nettoyage
-- nocturne plus précis, puis retire une ancienne fonction d'écriture qui ne sert plus.
-- Le reste du serveur (version 2.1) est déjà en place sur le projet « fibre-welcome » : ce bloc le complète seulement.

drop function if exists public.fw_set(text, jsonb);
drop function if exists public.fw_purge(text);

create or replace function public.fw_purge(p_ws text, p_gen int default null)
returns int language plpgsql security definer set search_path = public as $$
declare n int; s bigint;
begin
  if p_ws !~ '^ws_[a-z0-9]{4,40}$' then raise exception 'espace'; end if;
  -- Ménage d'après une réinitialisation : seulement si l'espace est toujours à cette génération. Une demande arrivée en
  -- retard n'efface jamais les images et sauvegardes d'une réinitialisation plus récente.
  if p_gen is not null then
    perform 1 from public.fw_docs where path = 'fwws/' || p_ws and data->>'gen' = p_gen::text for update;
    if not found then return 0; end if;
  end if;
  with d as (delete from public.fw_docs where path like 'fwws/' || p_ws || '/%' and path not like '%/lock/main'
               and (p_gen is null or (data->>'gen') is distinct from p_gen::text) returning octet_length(data::text) as sz)
  select count(*), coalesce(sum(sz), 0) into n, s from d;
  update public.fw_usage set bytes = greatest(0, bytes - s) where id = 1;
  return n;
end $$;
revoke all on function public.fw_purge(text, int) from public;
grant execute on function public.fw_purge(text, int) to anon, authenticated;

create or replace function public.fw_cleanup()
returns void language plpgsql security definer set search_path = public as $$
begin
  with dead as (select path from public.fw_docs where path ~ '^fwws/ws_[a-z0-9]+$' and updated_at < now() - interval '14 days')
  delete from public.fw_docs d using dead where d.path = dead.path or d.path like dead.path || '/%';
  delete from public.fw_docs c where c.path ~ '^fwws/ws_[a-z0-9]+/' and c.updated_at < now() - interval '1 day'
    and not exists (select 1 from public.fw_docs p where p.path = split_part(c.path, '/', 1) || '/' || split_part(c.path, '/', 2));
  delete from public.fw_docs r where r.path like 'fw/room/%' and r.updated_at < now() - interval '1 hour'
    and not exists (select 1 from public.fw_docs w where w.path = 'fwws/' || (r.data->>'wsId'));
  delete from public.fw_rate where bucket < now() - interval '2 days';
  update public.fw_usage set bytes = (select coalesce(sum(octet_length(data::text)), 0) from public.fw_docs) where id = 1;
end $$;
revoke all on function public.fw_cleanup() from public, anon, authenticated;

select cron.unschedule('fw-nettoyage');
select cron.schedule('fw-nettoyage', '0 3 * * *', 'select public.fw_cleanup()');
