-- =============================================================================
-- BIRTHDAY CUP · 0008 · Spaghetti & Marshmallow: pistas que se abren con el cronómetro
-- =============================================================================
-- El juez sube pistas en imagen. Se abren según el TIEMPO DE PRUEBA
-- TRANSCURRIDO (las pausas no adelantan pistas):
--   pista n  ->  (hints_first_minutes + hints_interval_minutes · (n − 1)) minutos
--   por defecto 1, 4, 7, 10… minutos.
-- * Cronómetro sin iniciar o cancelado: todas bloqueadas.
-- * Prueba terminada: todas abiertas.
-- * El juez puede abrir una pista antes de tiempo (con la prueba en marcha).
-- * Los jugadores reciben las pistas por RPC: el servidor solo entrega la
--   imagen (y el título) de las pistas abiertas; de las bloqueadas, el número
--   y el segundo de apertura.
-- =============================================================================

-- Script idempotente: se puede volver a ejecutar si un intento anterior falló a medias.

-- Utilidad de 0001 (se recrea por si no existe en el proyecto; misma definición)
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- Reparación: triggers de updated_at de 0001 que faltan si la función no existía
do $$
declare r record;
begin
  for r in select * from (values
      ('trg_settings_updated', 'competition_settings'), ('trg_tv_updated', 'tv_settings'),
      ('trg_teams_updated', 'teams'), ('trg_players_updated', 'players'),
      ('trg_challenges_updated', 'challenges'), ('trg_crash_races_updated', 'crash_races'),
      ('trg_overcooked_updated', 'overcooked_results'), ('trg_spaghetti_updated', 'spaghetti_state'),
      ('trg_duels_updated', 'duels'), ('trg_missions_updated', 'missions')
    ) as t(trg, tbl) loop
    if to_regclass('public.' || r.tbl) is not null
       and not exists (select 1 from pg_trigger where tgname = r.trg and tgrelid = ('public.' || r.tbl)::regclass) then
      execute format('create trigger %I before update on public.%I for each row execute function public.tg_set_updated_at()', r.trg, r.tbl);
    end if;
  end loop;
end $$;

create table if not exists public.spaghetti_hints (
  id               uuid primary key default gen_random_uuid(),
  position         int  not null check (position >= 1),
  title            text not null default '' check (char_length(title) <= 80),
  image_path       text not null check (image_path ~ '^spaghetti/hints/[A-Za-z0-9._-]+$'),
  manual_opened_at timestamptz,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint spaghetti_hints_position_uq unique (position) deferrable initially deferred
);
drop trigger if exists trg_spaghetti_hints_updated on public.spaghetti_hints;
create trigger trg_spaghetti_hints_updated before update on public.spaghetti_hints
  for each row execute function public.tg_set_updated_at();
drop trigger if exists trg_signal_spaghetti_hints on public.spaghetti_hints;
create trigger trg_signal_spaghetti_hints after insert or update or delete on public.spaghetti_hints
  for each statement execute function public.tg_bump_signal('spaghetti');

alter table public.spaghetti_hints enable row level security;
grant select on public.spaghetti_hints to authenticated;
drop policy if exists spaghetti_hints_admin on public.spaghetti_hints;
create policy spaghetti_hints_admin on public.spaghetti_hints for select to authenticated
  using (public.is_admin());

-- Configuración por defecto del calendario
update public.challenges
   set config = jsonb_build_object('hints_first_minutes', 1, 'hints_interval_minutes', 3) || config
 where kind = 'spaghetti';

-- Al reiniciar el cronómetro o empezar una prueba nueva, se olvidan las aperturas manuales
create or replace function public.tg_spaghetti_reset_manual_hints()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  update public.spaghetti_hints set manual_opened_at = null where manual_opened_at is not null;
  return null;
end $$;
drop trigger if exists trg_spaghetti_reset_manual_hints on public.spaghetti_state;
create trigger trg_spaghetti_reset_manual_hints after update of timer_status on public.spaghetti_state
  for each row
  when (new.timer_status = 'idle'
        or (new.timer_status = 'running' and old.timer_status in ('idle', 'cancelled', 'finished')))
  execute function public.tg_spaghetti_reset_manual_hints();

-- -----------------------------------------------------------------------------
-- Internas
-- -----------------------------------------------------------------------------
-- Segundos de prueba transcurridos (null = sin iniciar o cancelada)
create or replace function public._spaghetti_elapsed_seconds()
returns numeric language sql stable security definer set search_path = public as $$
  select case s.timer_status
    when 'running'  then greatest(0, least(s.duration_seconds,
                           s.duration_seconds - extract(epoch from (s.ends_at - now()))))
    when 'paused'   then greatest(0, s.duration_seconds - coalesce(s.paused_remaining_ms, 0) / 1000.0)
    when 'finished' then s.duration_seconds
    else null end
  from public.spaghetti_state s where s.id = 1;
$$;

-- Pistas con su número, segundo de apertura y estado. p_admin = true incluye
-- id, imagen y título de todas; si no, solo de las abiertas.
create or replace function public._spaghetti_hints_view(p_admin boolean)
returns jsonb language sql stable security definer set search_path = public as $$
  with cfg as (
    select coalesce((config ->> 'hints_first_minutes')::numeric, 1) as first_min,
           coalesce((config ->> 'hints_interval_minutes')::numeric, 3) as interval_min
    from public.challenges where kind = 'spaghetti'
  ), st as (
    select timer_status, public._spaghetti_elapsed_seconds() as elapsed from public.spaghetti_state where id = 1
  ), h as (
    select hi.*, row_number() over (order by hi.position) as n from public.spaghetti_hints hi
  ), v as (
    select h.*, ((cfg.first_min + cfg.interval_min * (h.n - 1)) * 60)::int as open_at,
           case when st.timer_status = 'finished' then true
                when st.elapsed is null then false
                when h.manual_opened_at is not null then true
                else st.elapsed >= (cfg.first_min + cfg.interval_min * (h.n - 1)) * 60 end as is_open
    from h, cfg, st
  )
  select coalesce(jsonb_agg(
           jsonb_build_object('number', v.n, 'open_at_seconds', v.open_at, 'is_open', v.is_open,
                              'opened_manually', v.manual_opened_at is not null,
                              'title', case when p_admin or v.is_open then nullif(v.title, '') end,
                              'image_path', case when p_admin or v.is_open then v.image_path end)
           || case when p_admin then jsonb_build_object('id', v.id) else '{}'::jsonb end
           order by v.n), '[]'::jsonb)
  from v;
$$;

-- La prueba está activa (en marcha o en pausa)
create or replace function public._spaghetti_active()
returns boolean language sql stable security definer set search_path = public as $$
  select timer_status in ('running', 'paused') from public.spaghetti_state where id = 1;
$$;

-- Indica si una pista concreta está abierta ahora
create or replace function public._spaghetti_hint_is_open(p_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select (h ->> 'is_open')::boolean
                   from jsonb_array_elements(public._spaghetti_hints_view(true)) h
                   where h ->> 'id' = p_id::text), false);
$$;

revoke all on function public._spaghetti_elapsed_seconds(), public._spaghetti_hints_view(boolean),
  public._spaghetti_active(), public._spaghetti_hint_is_open(uuid), public.tg_spaghetti_reset_manual_hints()
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Juez
-- -----------------------------------------------------------------------------
create or replace function public.admin_spaghetti_get_hints()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return jsonb_build_object('hints', public._spaghetti_hints_view(true),
                            'elapsed_seconds', public._spaghetti_elapsed_seconds(),
                            'server_now', now());
end $$;

create or replace function public.admin_spaghetti_add_hint(p_path text, p_title text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_admin();
  if p_path is null or p_path !~ '^spaghetti/hints/[A-Za-z0-9._-]+$' then perform public._raise('Ruta de imagen no válida.'); end if;
  if (select count(*) from public.spaghetti_hints) >= 30 then perform public._raise('Máximo 30 pistas.'); end if;
  insert into public.spaghetti_hints (position, title, image_path)
  values (coalesce((select max(position) from public.spaghetti_hints), 0) + 1, left(btrim(coalesce(p_title, '')), 80), p_path)
  returning id into v_id;
  return v_id;
end $$;

-- Cambia título y/o imagen (p_path null = conserva la imagen)
create or replace function public.admin_spaghetti_update_hint(p_id uuid, p_title text, p_path text default null)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.spaghetti_hints where id = p_id) then perform public._raise('Pista no encontrada.'); end if;
  if p_path is not null and p_path !~ '^spaghetti/hints/[A-Za-z0-9._-]+$' then perform public._raise('Ruta de imagen no válida.'); end if;
  if p_path is not null and public._spaghetti_active() and public._spaghetti_hint_is_open(p_id) then
    perform public._raise('Esta pista ya la han visto los equipos: no se puede cambiar su imagen durante la prueba.');
  end if;
  update public.spaghetti_hints
     set title = left(btrim(coalesce(p_title, '')), 80), image_path = coalesce(p_path, image_path)
   where id = p_id;
end $$;

-- Elimina una pista y compacta la numeración. Devuelve la ruta para borrar el archivo.
create or replace function public.admin_spaghetti_delete_hint(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_path text;
begin
  perform public.assert_admin();
  if public._spaghetti_active() and public._spaghetti_hint_is_open(p_id) then
    perform public._raise('Esta pista ya está abierta: no se puede eliminar durante la prueba.');
  end if;
  delete from public.spaghetti_hints where id = p_id returning image_path into v_path;
  if v_path is null then perform public._raise('Pista no encontrada.'); end if;
  update public.spaghetti_hints h set position = x.n
    from (select id, row_number() over (order by position) as n from public.spaghetti_hints) x
   where x.id = h.id and h.position <> x.n;
  return v_path;
end $$;

-- Nuevo orden completo. Con la prueba en marcha, las pistas ya abiertas no se mueven.
create or replace function public.admin_spaghetti_reorder_hints(p_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare v_view jsonb;
begin
  perform public.assert_admin();
  if (select count(*) from public.spaghetti_hints) <> coalesce(array_length(p_ids, 1), 0)
     or (select count(distinct x) from unnest(p_ids) x) <> coalesce(array_length(p_ids, 1), 0)
     or exists (select 1 from public.spaghetti_hints h where not (h.id = any(p_ids))) then
    perform public._raise('El nuevo orden debe incluir todas las pistas una sola vez.');
  end if;
  if public._spaghetti_active() then
    v_view := public._spaghetti_hints_view(true);
    if exists (select 1 from jsonb_array_elements(v_view) h
               where (h ->> 'is_open')::boolean
                 and array_position(p_ids, (h ->> 'id')::uuid) <> (h ->> 'number')::int) then
      perform public._raise('Las pistas ya abiertas no se pueden mover durante la prueba.');
    end if;
  end if;
  update public.spaghetti_hints h set position = array_position(p_ids, h.id);
end $$;

-- Abre una pista antes de tiempo (solo con la prueba en marcha o en pausa)
create or replace function public.admin_spaghetti_open_hint(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not public._spaghetti_active() then perform public._raise('Inicia el cronómetro para poder abrir pistas.'); end if;
  update public.spaghetti_hints set manual_opened_at = coalesce(manual_opened_at, now()) where id = p_id;
  if not found then perform public._raise('Pista no encontrada.'); end if;
end $$;

grant execute on function
  public.admin_spaghetti_get_hints(),
  public.admin_spaghetti_add_hint(text, text),
  public.admin_spaghetti_update_hint(uuid, text, text),
  public.admin_spaghetti_delete_hint(uuid),
  public.admin_spaghetti_reorder_hints(uuid[]),
  public.admin_spaghetti_open_hint(uuid)
to authenticated;

-- -----------------------------------------------------------------------------
-- get_player_modalities: añade las pistas (solo imagen/título de las abiertas)
-- -----------------------------------------------------------------------------
create or replace function public.get_player_modalities()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pid uuid := public.current_player_id();
  v_team uuid := public.current_team_id();
  v_sp public.spaghetti_state;
  v_duel_cfg jsonb;
  v_crash public.challenges;
  v_meta public.crash_lineup_meta;
  v_oc public.challenges;
  v_oc_meta public.overcooked_roster_meta;
begin
  if v_pid is null and not public.is_admin() then perform public._raise('Debes unirte a la competición.'); end if;
  select * into v_sp from public.spaghetti_state where id = 1;
  select config into v_duel_cfg from public.challenges where kind = 'duels';
  select * into v_crash from public.challenges where kind = 'crash';
  select * into v_meta from public.crash_lineup_meta where team_id = v_team;
  select * into v_oc from public.challenges where kind = 'overcooked';
  select * into v_oc_meta from public.overcooked_roster_meta where team_id = v_team;

  return jsonb_build_object(
    'challenges', (select jsonb_agg(jsonb_build_object(
        'id', c.id, 'kind', c.kind, 'name', c.name, 'tagline', c.tagline,
        'description', c.description, 'rules', c.rules, 'status', c.status,
        'config', c.config) order by c.sort_order) from public.challenges c),
    'crash', jsonb_build_object(
      'races', (select coalesce(jsonb_agg(jsonb_build_object('race_number', r.race_number, 'track', r.track,
                  'is_training', r.is_training, 'status', r.status) order by r.race_number), '[]'::jsonb)
                from public.crash_races r),
      'my_slots', (select coalesce(jsonb_agg(l.slot order by l.slot), '[]'::jsonb)
                   from public.crash_lineups l where l.player_id = v_pid),
      'race_count', coalesce((v_crash.config ->> 'race_count')::int, 0),
      'can_edit_lineup', v_team is not null and v_crash.status <> 'finished'
                         and coalesce((v_crash.config ->> 'race_count')::int, 0) > 0,
      'lineup', (select coalesce(jsonb_agg(jsonb_build_object('slot', l.slot, 'player_id', l.player_id) order by l.slot), '[]'::jsonb)
                 from public.crash_lineups l where l.team_id = v_team),
      'lineup_version', coalesce(v_meta.version, 0),
      'lineup_updated_at', v_meta.updated_at,
      'lineup_updated_by_id', v_meta.updated_by_player,
      'lineup_updated_by', case when v_meta.team_id is null then null
                                when v_meta.updated_by_admin then 'el juez'
                                else (select name from public.players where id = v_meta.updated_by_player) end),
    'overcooked', jsonb_build_object(
      'players_per_team', coalesce((v_oc.config ->> 'players_per_team')::int, 0),
      'required', case when v_team is null then 0 else public._overcooked_required_size(v_team) end,
      'can_edit_roster', v_team is not null and public._overcooked_roster_lock_reason(v_team) is null,
      'lock_reason', case when v_team is null then null else public._overcooked_roster_lock_reason(v_team) end,
      'roster', (select coalesce(jsonb_agg(r.player_id), '[]'::jsonb) from public.overcooked_rosters r where r.team_id = v_team),
      'i_play', exists (select 1 from public.overcooked_rosters r where r.team_id = v_team and r.player_id = v_pid),
      'roster_version', coalesce(v_oc_meta.version, 0),
      'roster_updated_at', v_oc_meta.updated_at,
      'roster_updated_by_id', v_oc_meta.updated_by_player,
      'roster_updated_by', case when v_oc_meta.team_id is null or v_oc_meta.version = 0 then null
                                when v_oc_meta.updated_by_admin then 'el juez'
                                else (select name from public.players where id = v_oc_meta.updated_by_player) end),
    'duels', jsonb_build_object(
      'games', (select coalesce(jsonb_agg(g.name order by g.sort_order, g.name), '[]'::jsonb)
                from public.duel_games g where g.active),
      'my_count', (select count(*) from public.duel_players dp join public.duels d on d.id = dp.duel_id
                   where dp.player_id = v_pid and d.status in ('in_progress', 'finished')),
      'limit', coalesce((v_duel_cfg ->> 'limit_per_player')::int, 3)),
    'spaghetti', jsonb_build_object(
      'timer_status', v_sp.timer_status,
      'duration_seconds', v_sp.duration_seconds,
      'ends_at', v_sp.ends_at,
      'paused_remaining_ms', v_sp.paused_remaining_ms,
      'reference_image_path', case when v_sp.reference_visible then v_sp.reference_image_path end,
      'hints', public._spaghetti_hints_view(false)),
    'server_now', now()
  );
end $$;


-- -----------------------------------------------------------------------------
-- get_tv_state: añade el calendario de pistas al cronómetro (sin imágenes)
-- -----------------------------------------------------------------------------
create or replace function public.get_tv_state(p_key text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  tv public.tv_settings;
  cs public.competition_settings;
  sp public.spaghetti_state;
  v_teams jsonb;
  v_show_scores boolean;
  v_show_order boolean;
begin
  select * into tv from public.tv_settings where id = 1;
  if p_key is null or p_key <> tv.access_key then
    raise exception 'Clave de pantalla no válida.' using errcode = '42501';
  end if;
  select * into cs from public.competition_settings where id = 1;
  select * into sp from public.spaghetti_state where id = 1;

  v_show_scores := tv.mode in ('leaderboard', 'final_results', 'champion');
  v_show_order  := tv.mode in ('leaderboard', 'leaderboard_no_scores', 'final_results', 'champion');

  if tv.mode = 'waiting' then
    select jsonb_agg(jsonb_build_object('team_id', t.id, 'name', t.name, 'color', t.color,
             'players_count', (select count(*) from public.players p where p.team_id = t.id)) order by t.sort_order, t.name)
      into v_teams from public.teams t;
  else
    select jsonb_agg(jsonb_build_object('team_id', s.team_id, 'name', s.name, 'color', s.color,
             'players_count', s.players_count,
             'rank', case when v_show_order then s.rank end,
             'points', case when v_show_scores then s.points end) order by s.rank, s.sort_order)
      into v_teams from public._standings() s;
  end if;

  return jsonb_build_object(
    'mode', tv.mode,
    'message', tv.message,
    'competition', jsonb_build_object('name', cs.name, 'subtitle', cs.subtitle, 'status', cs.status),
    'winner_revealed_at', cs.winner_revealed_at,
    'teams', coalesce(v_teams, '[]'::jsonb),
    'last_update', case when v_show_scores then public._last_score_at() end,
    'timer', case when tv.show_timer and sp.timer_status in ('running', 'paused') then
      jsonb_build_object('status', sp.timer_status, 'ends_at', sp.ends_at,
                         'paused_remaining_ms', sp.paused_remaining_ms, 'duration_seconds', sp.duration_seconds,
                         -- Solo el calendario de las pistas (sin imágenes ni títulos)
                         'hints', (select coalesce(jsonb_agg(jsonb_build_object('number', h -> 'number',
                                     'open_at_seconds', h -> 'open_at_seconds', 'is_open', h -> 'is_open')), '[]'::jsonb)
                                   from jsonb_array_elements(public._spaghetti_hints_view(false)) h)) end,
    'server_now', now()
  );
end $$;

