-- =============================================================================
-- BIRTHDAY CUP · 0006 · Los jugadores ordenan los pilotos de su equipo (Crash)
-- =============================================================================
-- Flujo:
--   1. El juez fija el número de carreras (admin_crash_setup).
--   2. Cualquier integrante del equipo reordena en su móvil (sin llamadas al
--      servidor) y pulsa «Guardar»: se envía la alineación completa.
--   3. Concurrencia optimista: el cliente envía la versión sobre la que editó.
--      Si un compañero guardó antes, se rechaza (código BC409) y el cliente
--      recibe el orden nuevo, en lugar de pisarlo sin saberlo.
--   El juez puede seguir fijando la alineación desde su panel (sin versión:
--   su decisión prevalece).
-- Reglas comunes (juez y jugadores):
--   * Exactamente un piloto por carrera, todos del equipo.
--   * Pilotos distintos, salvo que el equipo tenga menos integrantes que carreras.
--   * No se cambia el piloto de una carrera en pista o ya disputada.
--   * No se modifica con el torneo finalizado.
-- =============================================================================

create table public.crash_lineup_meta (
  team_id           uuid primary key references public.teams(id) on delete cascade,
  version           int  not null default 0,
  updated_at        timestamptz not null default now(),
  updated_by_player uuid references public.players(id) on delete set null,  -- null = juez
  updated_by_admin  boolean not null default false
);
alter table public.crash_lineup_meta enable row level security;
grant select on public.crash_lineup_meta to authenticated;
create policy crash_lineup_meta_select on public.crash_lineup_meta for select to authenticated
  using (public.is_admin() or team_id = public.current_team_id());

create trigger trg_signal_crash_lineup_meta after insert or update or delete on public.crash_lineup_meta
  for each statement execute function public.tg_bump_signal('challenges');

-- Versión inicial para las alineaciones ya existentes
insert into public.crash_lineup_meta (team_id, version, updated_by_admin)
select distinct team_id, 1, true from public.crash_lineups
on conflict do nothing;

-- -----------------------------------------------------------------------------
-- Interna: valida y guarda la alineación de un equipo. Devuelve la nueva versión.
-- -----------------------------------------------------------------------------
create or replace function public._crash_apply_lineup(p_team_id uuid, p_player_ids uuid[], p_actor_player uuid)
returns int language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_n int;
  v_team_size int;
  v_version int;
  i int;
begin
  v := public._lock_challenge('crash', false);
  if v.status = 'finished' then perform public._raise('El torneo ha finalizado.'); end if;
  v_n := coalesce((v.config ->> 'race_count')::int, 0);
  if v_n = 0 then perform public._raise('El juez aún no ha configurado las carreras.'); end if;
  if coalesce(array_length(p_player_ids, 1), 0) <> v_n or array_position(p_player_ids, null) is not null then
    perform public._raise(format('La alineación debe tener exactamente %s pilotos (uno por carrera).', v_n));
  end if;
  if exists (select 1 from unnest(p_player_ids) x
             where not exists (select 1 from public.players p where p.id = x and p.team_id = p_team_id)) then
    perform public._raise('Todos los pilotos deben pertenecer al equipo.');
  end if;
  select count(*) into v_team_size from public.players where team_id = p_team_id;
  if v_team_size >= v_n and (select count(distinct x) from unnest(p_player_ids) x) <> v_n then
    perform public._raise('Cada carrera debe tener un piloto distinto.');
  end if;
  if exists (select 1 from public.crash_lineups l join public.crash_races r on r.race_number = l.slot and not r.is_training
             where l.team_id = p_team_id and r.status in ('finished', 'in_progress')
               and l.player_id <> p_player_ids[l.slot]) then
    perform public._raise('No se puede cambiar el piloto de una carrera en pista o ya disputada.');
  end if;

  delete from public.crash_lineups where team_id = p_team_id;
  for i in 1..v_n loop
    insert into public.crash_lineups (team_id, slot, player_id) values (p_team_id, i, p_player_ids[i]);
  end loop;

  insert into public.crash_lineup_meta (team_id, version, updated_at, updated_by_player, updated_by_admin)
  values (p_team_id, 1, now(), p_actor_player, p_actor_player is null)
  on conflict (team_id) do update
    set version = crash_lineup_meta.version + 1, updated_at = now(),
        updated_by_player = excluded.updated_by_player, updated_by_admin = excluded.updated_by_admin
  returning version into v_version;

  perform public._bump('challenges');
  return v_version;
end $$;
revoke all on function public._crash_apply_lineup(uuid, uuid[], uuid) from public, anon, authenticated;

-- Juez: misma firma que antes (void), ahora usando la lógica común
create or replace function public.admin_crash_set_lineup(p_team_id uuid, p_player_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  perform public._crash_apply_lineup(p_team_id, p_player_ids, null);
end $$;

-- Jugador: guarda la alineación de SU equipo si nadie la cambió desde p_expected_version
create or replace function public.player_crash_set_lineup(p_player_ids uuid[], p_expected_version int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_player_id();
  v_team uuid;
  v_current int;
  v_version int;
begin
  if v_me is null then perform public._raise('Debes unirte a la competición.'); end if;
  select team_id into v_team from public.players where id = v_me;
  if v_team is null then perform public._raise('Aún no tienes equipo asignado.'); end if;

  -- Bloqueo de la fila de control del equipo: serializa guardados simultáneos
  insert into public.crash_lineup_meta (team_id) values (v_team) on conflict do nothing;
  select version into v_current from public.crash_lineup_meta where team_id = v_team for update;
  if v_current is distinct from coalesce(p_expected_version, 0) then
    raise exception 'Un compañero acaba de guardar otro orden. Te mostramos el nuevo: revísalo y guarda de nuevo si quieres cambiarlo.'
      using errcode = 'BC409';
  end if;

  v_version := public._crash_apply_lineup(v_team, p_player_ids, v_me);
  return jsonb_build_object('version', v_version);
end $$;
grant execute on function public.player_crash_set_lineup(uuid[], int) to authenticated;

-- -----------------------------------------------------------------------------
-- get_player_modalities: añade la alineación del equipo del jugador
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
begin
  if v_pid is null and not public.is_admin() then perform public._raise('Debes unirte a la competición.'); end if;
  select * into v_sp from public.spaghetti_state where id = 1;
  select config into v_duel_cfg from public.challenges where kind = 'duels';
  select * into v_crash from public.challenges where kind = 'crash';
  select * into v_meta from public.crash_lineup_meta where team_id = v_team;

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
