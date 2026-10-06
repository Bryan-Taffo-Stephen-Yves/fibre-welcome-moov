-- Serveur de démonstration de Fibre Welcome (projet Supabase « fibre-welcome », région Paris). Version 2.
-- Déjà appliqué sur le projet ; à rejouer tel quel sur un nouveau projet, puis reporter son adresse et sa
-- clé publique (publishable) dans src/ui/server-config.js.
--
-- La table n'est jamais lue ni écrite directement : seules cinq fonctions sont ouvertes au public
-- (lire, voir les versions, écrire, prendre le bail, effacer les images d'un espace).
-- Aucune fonction ne liste les espaces : il faut connaître le code de salle (8 caractères) pour en ouvrir un.
-- Garde-fous : taille maximale par document, budget total de 300 Mo de données vivantes, volume d'écriture
-- et nombre de nouveaux documents limités par adresse IP (par /64 en IPv6), images et sauvegardes seulement
-- sous un espace existant, 80 images au plus par espace, un seul code de salle par lecture de versions.
-- Les numéros de version viennent d'une seule séquence : un document effacé puis recréé repart plus haut.
-- Données fictives seulement. Un espace sans activité depuis 14 jours est effacé chaque nuit, avec ses images.

create sequence public.fw_rev_seq start 1000;

create table public.fw_docs (
  path text primary key,
  data jsonb not null,
  rev bigint not null default nextval('public.fw_rev_seq'),
  updated_at timestamptz not null default now(),
  constraint fw_docs_path check (path ~ '^(fw/room/[A-Z0-9]{8}|fwws/ws_[a-z0-9]{4,40}(/(img/[A-Za-z0-9_-]{1,60}|bk/[0-9]|lock/main))?)$'),
  constraint fw_docs_size check (octet_length(data::text) <= 300000)
);
create index fw_docs_path_prefix on public.fw_docs (path text_pattern_ops);
alter table public.fw_docs enable row level security;
revoke all on public.fw_docs from anon, authenticated;
revoke all on sequence public.fw_rev_seq from anon, authenticated;

-- Volume de données vivantes (recalculé chaque nuit) et compteurs par adresse IP et par heure.
create table public.fw_usage (id int primary key, bytes bigint not null default 0);
insert into public.fw_usage (id, bytes) values (1, 0);
create table public.fw_rate (ip text not null, bucket timestamptz not null, n int not null default 0, b bigint not null default 0, primary key (ip, bucket));
alter table public.fw_usage enable row level security;
alter table public.fw_rate enable row level security;
revoke all on public.fw_usage, public.fw_rate from anon, authenticated;

-- Adresse du visiteur d'après les en-têtes transmis par l'API (IPv6 regroupée par /64 ; null si inconnue).
create or replace function public.fw_client_ip()
returns text language plpgsql stable set search_path = public as $$
declare j jsonb; raw text;
begin
  begin j := nullif(current_setting('request.headers', true), '')::jsonb; exception when others then return null; end;
  if j is null then return null; end if;
  raw := nullif(trim(coalesce(j->>'cf-connecting-ip', j->>'x-real-ip', split_part(j->>'x-forwarded-for', ',', 1))), '');
  if raw is null then return null; end if;
  begin
    if position(':' in raw) > 0 then return network(set_masklen(raw::inet, 64))::text; end if;
    return host(raw::inet);
  exception when others then return left(raw, 64);
  end;
end $$;

-- Quotas : budget total, puis par adresse 300 nouveaux documents et 60 Mo par heure, 150 Mo par jour.
create or replace function public.fw_charge(p_new boolean, p_bytes bigint)
returns void language plpgsql security definer set search_path = public as $$
declare v_ip text; r record; day_b bigint;
begin
  if p_bytes > 0 and (select bytes from public.fw_usage where id = 1) + p_bytes > 300 * 1024 * 1024 then raise exception 'serveur plein'; end if;
  if p_new or p_bytes > 0 then
    v_ip := public.fw_client_ip();
    if v_ip is not null then
      insert into public.fw_rate as t (ip, bucket, n, b) values (v_ip, date_trunc('hour', now()), case when p_new then 1 else 0 end, greatest(p_bytes, 0))
      on conflict (ip, bucket) do update set n = t.n + excluded.n, b = t.b + excluded.b returning t.n, t.b into r;
      if r.n > 300 or r.b > 60 * 1024 * 1024 then raise exception 'trop de demandes : réessayez dans une heure'; end if;
      select coalesce(sum(b), 0) into day_b from public.fw_rate where ip = v_ip and bucket > now() - interval '24 hours';
      if day_b > 150 * 1024 * 1024 then raise exception 'trop de demandes : réessayez demain'; end if;
    end if;
  end if;
  if p_bytes <> 0 then update public.fw_usage set bytes = greatest(0, bytes + p_bytes) where id = 1; end if;
end $$;

-- Règles d'une nouvelle ligne : images et sauvegardes sous un espace existant, 80 images au plus.
create or replace function public.fw_guard_new(p_path text, p_data jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare parent text;
begin
  if p_path like 'fwws/%/%' then
    parent := split_part(p_path, '/', 1) || '/' || split_part(p_path, '/', 2);
    if not exists (select 1 from public.fw_docs where path = parent and not coalesce((data->>'deleted')::boolean, false)) then raise exception 'espace inconnu'; end if;
    if p_path like '%/img/%' and (select count(*) from public.fw_docs where path like parent || '/img/%') >= 80 then raise exception 'trop d''images dans cet espace'; end if;
  end if;
end $$;

create or replace function public.fw_get(p_path text)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('rev', rev, 'data', data) from public.fw_docs where path = p_path;
$$;

-- Versions de quelques documents (20 au plus, dont un seul code de salle) : un appareil suit ainsi les changements.
create or replace function public.fw_revs(p_paths text[])
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if coalesce(array_length(p_paths, 1), 0) > 20 then raise exception 'trop de chemins'; end if;
  if (select count(*) from unnest(p_paths) as p(x) where x like 'fw/room/%') > 1 then raise exception 'un seul code de salle à la fois'; end if;
  return (select coalesce(jsonb_object_agg(path, rev), '{}'::jsonb) from public.fw_docs where path = any(p_paths));
end $$;

-- Écriture. p_expected_rev : version attendue (0 = le document ne doit pas exister, null = sans condition).
-- Réponse : la nouvelle version, ou -1 si quelqu'un a écrit entre-temps (l'appareil relit puis rejoue son action).
-- Un code de salle reste petit et ne peut désigner qu'un espace existant.
create or replace function public.fw_set(p_path text, p_data jsonb, p_expected_rev bigint default null)
returns bigint language plpgsql security definer set search_path = public as $$
declare r bigint; cur_rev bigint; cur_size int; new_size int := octet_length(p_data::text);
begin
  if p_path like '%/lock/%' then raise exception 'chemin réservé'; end if;
  if p_path like 'fw/room/%' and new_size > 400 then raise exception 'code de salle invalide'; end if;
  if p_path like 'fw/room/%' and p_data->>'wsId' is not null and not exists (select 1 from public.fw_docs where path = 'fwws/' || (p_data->>'wsId')) then raise exception 'espace inconnu'; end if;
  select rev, octet_length(data::text) into cur_rev, cur_size from public.fw_docs where path = p_path for update;
  if p_expected_rev is not null and coalesce(cur_rev, 0) <> p_expected_rev then return -1; end if;
  if cur_rev is null then
    perform public.fw_guard_new(p_path, p_data);
    insert into public.fw_docs (path, data) values (p_path, p_data) on conflict (path) do nothing returning rev into r;
    if r is null then return -1; end if;
    perform public.fw_charge(true, new_size);
    return r;
  end if;
  perform public.fw_charge(false, new_size - cur_size);
  update public.fw_docs set data = p_data, rev = nextval('public.fw_rev_seq'), updated_at = now() where path = p_path returning rev into r;
  return r;
end $$;

-- Bail court : en général, un seul appareil écrit à la fois dans un espace (seulement pour un espace existant).
create or replace function public.fw_acquire(p_path text, p_holder text, p_ttl_ms int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare cur jsonb; now_ms bigint := floor(extract(epoch from clock_timestamp()) * 1000); ttl int := least(greatest(coalesce(p_ttl_ms, 4000), 200), 10000); exp_ms bigint;
begin
  if p_path !~ '^fwws/ws_[a-z0-9]{4,40}/lock/main$' then raise exception 'chemin'; end if;
  if p_holder is null or length(p_holder) > 40 then raise exception 'porteur'; end if;
  if not exists (select 1 from public.fw_docs where path = regexp_replace(p_path, '/lock/main$', '')) then raise exception 'espace inconnu'; end if;
  insert into public.fw_docs (path, data) values (p_path, jsonb_build_object('holder', '', 'exp', 0)) on conflict (path) do nothing;
  select data into cur from public.fw_docs where path = p_path for update;
  exp_ms := coalesce((cur->>'exp')::bigint, 0);
  if cur->>'holder' = p_holder or exp_ms < now_ms then
    exp_ms := now_ms + ttl;
    update public.fw_docs set data = jsonb_build_object('holder', p_holder, 'exp', exp_ms), rev = rev + 1, updated_at = now() where path = p_path;
    return jsonb_build_object('acquired', true, 'expiresAt', to_jsonb(to_timestamp(exp_ms / 1000.0)));
  end if;
  return jsonb_build_object('acquired', false, 'expiresAt', to_jsonb(to_timestamp(exp_ms / 1000.0)));
end $$;

-- Efface les images et sauvegardes d'un espace : toutes (suppression), ou celles d'une autre génération que p_gen
-- (réinitialisation depuis le Labo). Rejouer cet effacement ne touche jamais aux documents de la génération gardée.
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

-- Nettoyage nocturne : espaces inactifs depuis 14 jours (avec tout ce qui leur appartient), restes orphelins,
-- codes de salle qui ne mènent plus à rien, compteurs anciens ; puis recalcul du volume de données vivantes.
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

revoke all on function public.fw_get(text), public.fw_revs(text[]), public.fw_set(text, jsonb, bigint), public.fw_acquire(text, text, int), public.fw_purge(text, int) from public;
grant execute on function public.fw_get(text), public.fw_revs(text[]), public.fw_set(text, jsonb, bigint), public.fw_acquire(text, text, int), public.fw_purge(text, int) to anon, authenticated;
revoke all on function public.fw_client_ip(), public.fw_charge(boolean, bigint), public.fw_guard_new(text, jsonb), public.fw_cleanup() from public, anon, authenticated;

create extension if not exists pg_cron;
select cron.schedule('fw-nettoyage', '0 3 * * *', 'select public.fw_cleanup()');
select cron.schedule('fw-compte', '30 3 * * *', 'update public.fw_usage set bytes = (select coalesce(sum(octet_length(data::text)), 0) from public.fw_docs) where id = 1');
