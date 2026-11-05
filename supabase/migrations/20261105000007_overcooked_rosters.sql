-- =============================================================================
-- BIRTHDAY CUP · 0007 · Overcooked: los equipos eligen a sus cocineros
-- =============================================================================
-- Cada equipo juega UNA partida oficial con el mismo número de cocineros
-- (config.players_per_team, fijado por el juez). Igual que en Crash:
--   * Juez y jugadores eligen quién juega (sin orden). El jugador edita en
--     local y lo envía al pulsar «Guardar», con concurrencia optimista
--     (versión por equipo; conflicto => código BC409).
--   * El juez solo puede guardar la puntuación oficial de un equipo con su
--     selección completa; después, la selección queda bloqueada.
--   * Al confirmar, los puntos se reparten por posición (sin cambios).
-- Tamaño exigido: players_per_team, o todo el equipo si tiene menos miembros.
-- =============================================================================

create table public.overcooked_rosters (
  team_id    uuid not null references public.teams(id) on delete cascade,
  player_id  uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, player_id)
);

create table public.overcooked_roster_meta (
  team_id           uuid primary key references public.teams(id) on delete cascade,
  version           int  not null default 0,
  updated_at        timestamptz not null default now(),
  updated_by_player uuid references public.players(id) on delete set null,  -- null = juez
  updated_by_admin  boolean not null default false
);

alter table public.overcooked_rosters enable row level security;
alter table public.overcooked_roster_meta enable row level security;
grant select on public.overcooked_rosters, public.overcooked_roster_meta to authenticated;
create policy overcooked_rosters_select on public.overcooked_rosters for select to authenticated
  using (public.is_admin() or team_id = public.current_team_id());
create policy overcooked_roster_meta_select on public.overcooked_roster_meta for select to authenticated
  using (public.is_admin() or team_id = public.current_team_id());

create trigger trg_signal_overcooked_rosters after insert or update or delete on public.overcooked_rosters
  for each statement execute function public.tg_bump_signal('challenges');
create trigger trg_signal_overcooked_roster_meta after insert or update or delete on public.overcooked_roster_meta
  for each statement execute function public.tg_bump_signal('challenges');

-- -----------------------------------------------------------------------------
-- Internas
-- -----------------------------------------------------------------------------
-- Cocineros exigidos al equipo (0 = el juez aún no lo ha fijado)
create or replace function public._overcooked_required_size(p_team_id uuid)
returns int language sql stable security definer set search_path = public as $$
  select least(
    coalesce((select (config ->> 'players_per_team')::int from public.challenges where kind = 'overcooked'), 0),
    (select count(*)::int from public.players where team_id = p_team_id));
$$;

-- Selección completa: el número exigido y todos siguen siendo del equipo
create or replace function public._overcooked_roster_complete(p_team_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select public._overcooked_required_size(p_team_id) > 0
     and (select count(*) from public.overcooked_rosters r
          join public.players p on p.id = r.player_id and p.team_id = r.team_id
          where r.team_id = p_team_id) = public._overcooked_required_size(p_team_id)
     and not exists (select 1 from public.overcooked_rosters r
                     left join public.players p on p.id = r.player_id and p.team_id = r.team_id
                     where r.team_id = p_team_id and p.id is null);
$$;

-- Motivo por el que no se puede cambiar la selección (null = editable)
create or replace function public._overcooked_roster_lock_reason(p_team_id uuid)
returns text language plpgsql stable security definer set search_path = public as $$
declare v public.challenges;
begin
  select * into v from public.challenges where kind = 'overcooked';
  if v.status = 'finished' or v.results_confirmed_at is not null then
    return 'Overcooked ha terminado: la selección ya no se puede cambiar.';
  end if;
  if coalesce((v.config ->> 'players_per_team')::int, 0) <= 0 then
    return 'El juez aún no ha fijado cuántos cocineros juegan por equipo.';
  end if;
  if exists (select 1 from public.overcooked_results o where o.team_id = p_team_id and not o.is_training) then
    return 'Este equipo ya ha jugado la partida oficial: la selección queda cerrada.';
  end if;
  return null;
end $$;

-- Valida y guarda la selección de un equipo. Devuelve la nueva versión.
create or replace function public._overcooked_apply_roster(p_team_id uuid, p_player_ids uuid[], p_actor_player uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v_reason text;
  v_required int;
  v_n int := coalesce(array_length(p_player_ids, 1), 0);
  v_version int;
begin
  perform public._lock_challenge('overcooked', false);
  v_reason := public._overcooked_roster_lock_reason(p_team_id);
  if v_reason is not null then perform public._raise(v_reason); end if;
  v_required := public._overcooked_required_size(p_team_id);
  if v_n <> v_required or array_position(p_player_ids, null) is not null then
    perform public._raise(format('Elige exactamente %s cocineros.', v_required));
  end if;
  if (select count(distinct x) from unnest(p_player_ids) x) <> v_n then
    perform public._raise('Hay cocineros repetidos.');
  end if;
  if exists (select 1 from unnest(p_player_ids) x
             where not exists (select 1 from public.players p where p.id = x and p.team_id = p_team_id)) then
    perform public._raise('Todos los cocineros deben pertenecer al equipo.');
  end if;

  delete from public.overcooked_rosters where team_id = p_team_id;
  insert into public.overcooked_rosters (team_id, player_id) select p_team_id, x from unnest(p_player_ids) x;

  insert into public.overcooked_roster_meta (team_id, version, updated_at, updated_by_player, updated_by_admin)
  values (p_team_id, 1, now(), p_actor_player, p_actor_player is null)
  on conflict (team_id) do update
    set version = overcooked_roster_meta.version + 1, updated_at = now(),
        updated_by_player = excluded.updated_by_player, updated_by_admin = excluded.updated_by_admin
  returning version into v_version;

  perform public._bump('challenges');
  return v_version;
end $$;

revoke all on function public._overcooked_required_size(uuid), public._overcooked_roster_complete(uuid),
  public._overcooked_roster_lock_reason(uuid), public._overcooked_apply_roster(uuid, uuid[], uuid)
  from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- Públicas
-- -----------------------------------------------------------------------------
create or replace function public.admin_overcooked_set_roster(p_team_id uuid, p_player_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if not exists (select 1 from public.teams where id = p_team_id) then perform public._raise('Equipo no encontrado.'); end if;
  perform public._overcooked_apply_roster(p_team_id, p_player_ids, null);
end $$;
grant execute on function public.admin_overcooked_set_roster(uuid, uuid[]) to authenticated;

create or replace function public.player_overcooked_set_roster(p_player_ids uuid[], p_expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_player_id();
  v_team uuid;
  v_current int;
begin
  if v_me is null then perform public._raise('Debes unirte a la competición.'); end if;
  select team_id into v_team from public.players where id = v_me;
  if v_team is null then perform public._raise('Aún no tienes equipo asignado.'); end if;

  insert into public.overcooked_roster_meta (team_id) values (v_team) on conflict do nothing;
  select version into v_current from public.overcooked_roster_meta where team_id = v_team for update;
  if v_current is distinct from coalesce(p_expected_version, 0) then
    raise exception 'Un compañero acaba de guardar otra selección. Te mostramos la nueva: revísala y guarda de nuevo si quieres cambiarla.'
      using errcode = 'BC409';
  end if;
  return jsonb_build_object('version', public._overcooked_apply_roster(v_team, p_player_ids, v_me));
end $$;
grant execute on function public.player_overcooked_set_roster(uuid[], int) to authenticated;

-- La puntuación oficial exige la selección completa del equipo
create or replace function public.admin_overcooked_save_score(p_team_id uuid, p_score int, p_is_training boolean default false, p_notes text default '')
returns void language plpgsql security definer set search_path = public as $$
declare v public.challenges;
begin
  perform public.assert_admin();
  v := public._lock_challenge('overcooked', not p_is_training);
  if not p_is_training and v.results_confirmed_at is not null then
    perform public._raise('Los resultados oficiales ya están confirmados.');
  end if;
  if p_score is null or p_score < 0 or p_score > 1000000 then perform public._raise('Puntuación no válida.'); end if;
  if not exists (select 1 from public.teams where id = p_team_id) then perform public._raise('Equipo no encontrado.'); end if;
  if not p_is_training and not public._overcooked_roster_complete(p_team_id) then
    perform public._raise(format('Completa primero los %s cocineros de este equipo.', public._overcooked_required_size(p_team_id)));
  end if;
  insert into public.overcooked_results (team_id, is_training, score, notes)
  values (p_team_id, p_is_training, p_score, coalesce(p_notes, ''))
  on conflict (team_id, is_training) do update set score = excluded.score, notes = excluded.notes;
  perform public._bump('challenges');
end $$;

-- No se cambia el número de cocineros con partidas oficiales ya jugadas
create or replace function public.admin_update_challenge_config(p_challenge_id uuid, p_config jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.challenges; v_new jsonb; k text;
begin
  perform public.assert_admin();
  select * into v from public.challenges where id = p_challenge_id for update;
  if not found then perform public._raise('Modalidad no encontrada.'); end if;
  if jsonb_typeof(p_config) <> 'object' then perform public._raise('Configuración no válida.'); end if;
  if v.results_confirmed_at is not null or (v.kind = 'crash' and exists (select 1 from public.crash_race_results r join public.crash_races cr on cr.id = r.race_id where not cr.is_training)) then
    for k in select jsonb_object_keys(p_config) loop
      if k like 'points%' then perform public._raise('No se pueden cambiar los puntos con resultados ya registrados.'); end if;
    end loop;
  end if;
  if v.kind = 'crash' and p_config ? 'race_count' then
    perform public._raise('Usa la configuración de carreras para cambiar su número.');
  end if;
  if v.kind = 'overcooked' and p_config ? 'players_per_team'
     and (p_config -> 'players_per_team') is distinct from (v.config -> 'players_per_team') then
    if exists (select 1 from public.overcooked_results where not is_training) then
      perform public._raise('Ya hay partidas oficiales jugadas: no se puede cambiar el número de cocineros.');
    end if;
    if jsonb_typeof(p_config -> 'players_per_team') not in ('number', 'null')
       or coalesce((p_config ->> 'players_per_team')::int, 1) not between 1 and 12 then
      perform public._raise('El número de cocineros debe estar entre 1 y 12.');
    end if;
  end if;
  v_new := v.config || p_config;
  for k in select jsonb_object_keys(v_new) loop
    if k like 'points%' and jsonb_typeof(v_new -> k) not in ('array', 'number') then
      perform public._raise('Las tablas de puntos deben ser números.');
    end if;
  end loop;
  update public.challenges set config = v_new where id = v.id;
  perform public._bump('challenges');
end $$;

-- -----------------------------------------------------------------------------
-- get_player_modalities: añade la selección de Overcooked del equipo
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
      'reference_image_path', case when v_sp.reference_visible then v_sp.reference_image_path end),
    'server_now', now()
  );
end $$;

