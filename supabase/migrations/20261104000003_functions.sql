-- =============================================================================
-- BIRTHDAY CUP · 0003 · Lógica de servidor (RPC)
-- =============================================================================
-- Convenciones:
--   * Funciones públicas (expuestas vía PostgREST /rpc) => SECURITY DEFINER,
--     search_path fijo, comprueban el rol al inicio.
--   * Funciones internas (prefijo _) => sin EXECUTE para clientes.
--   * Los puntos SIEMPRE se calculan en servidor a partir de la configuración
--     almacenada; el cliente solo envía posiciones / puntuaciones de juego.
--   * Las operaciones que asignan puntos bloquean la fila afectada
--     (SELECT ... FOR UPDATE), comprueban su estado y escriben movimientos con
--     source_key único => imposible duplicar puntos por doble confirmación.
--   * p_dry_run = true devuelve el reparto calculado sin escribir nada
--     (resumen previo a la confirmación del juez).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Internas
-- -----------------------------------------------------------------------------
create or replace function public._raise(p_msg text)
returns void language plpgsql as $$
begin
  raise exception '%', p_msg using errcode = 'P0001';
end $$;

create or replace function public._bump(p_topic text)
returns void language sql security definer set search_path = public as $$
  insert into public.live_signals (topic, version, updated_at) values (p_topic, 1, now())
  on conflict (topic) do update set version = live_signals.version + 1, updated_at = now();
$$;

create or replace function public._assert_competition_open()
returns void language plpgsql security definer set search_path = public as $$
begin
  if (select status from public.competition_settings where id = 1) = 'finished' then
    perform public._raise('La competición ha finalizado. Reábrela para registrar más puntos.');
  end if;
end $$;

-- Bloquea y devuelve la modalidad; exige que esté en curso.
create or replace function public._lock_challenge(p_kind text, p_require_in_progress boolean default true)
returns public.challenges language plpgsql security definer set search_path = public as $$
declare v public.challenges;
begin
  select * into v from public.challenges where kind = p_kind for update;
  if not found then perform public._raise('Modalidad no encontrada.'); end if;
  if p_require_in_progress and v.status <> 'in_progress' then
    perform public._raise(format('La modalidad «%s» no está en curso. Iníciala primero.', v.name));
  end if;
  return v;
end $$;

create or replace function public._points_at(p_table jsonb, p_position int)
returns int language sql immutable as $$
  select coalesce((p_table ->> (p_position - 1))::int, 0);
$$;

-- Valida un ranking con empates estilo competición (1,1,3,4...).
create or replace function public._valid_ranking(p_positions int[])
returns boolean language sql immutable as $$
  select coalesce(bool_and(p = 1 + (select count(*) from unnest(p_positions) q where q < p)), false)
  from unnest(p_positions) p;
$$;

-- Inserta un movimiento oficial (omite los de 0 puntos).
create or replace function public._award(
  p_team uuid, p_points int, p_reason text, p_challenge uuid, p_player uuid,
  p_source_type text, p_source_key text, p_corrects uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  if p_points = 0 then return null; end if;
  insert into public.score_events (team_id, points, reason, challenge_id, player_id,
                                   source_type, source_key, corrects_event_id, created_by)
  values (p_team, p_points, p_reason, p_challenge, p_player,
          p_source_type, p_source_key, p_corrects, auth.uid())
  returning id into v_id;
  return v_id;
exception when unique_violation then
  perform public._raise('Estos puntos ya se habían registrado (operación duplicada).');
end $$;

-- Clasificación real con empates (rank competición)
create or replace function public._standings()
returns table (team_id uuid, name text, color text, sort_order int, points bigint,
               rank bigint, players_count bigint)
language sql stable security definer set search_path = public as $$
  with totals as (
    select t.id, t.name, t.color, t.sort_order,
           coalesce((select sum(e.points) from public.score_events e where e.team_id = t.id), 0) as pts,
           (select count(*) from public.players p where p.team_id = t.id) as pc
    from public.teams t
  )
  select id, name, color, sort_order, pts, rank() over (order by pts desc), pc
  from totals
  order by pts desc, sort_order, name;
$$;

create or replace function public._last_score_at()
returns timestamptz language sql stable security definer set search_path = public as $$
  select max(created_at) from public.score_events;
$$;

create or replace function public._gen_code(p_len int)
returns text language sql volatile as $$
  -- Alfabeto sin caracteres ambiguos (0/O, 1/I)
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + (get_byte(gen_random_bytes(1), 0) % 32), 1), '')
  from generate_series(1, p_len);
$$;

-- =============================================================================
-- SESIONES DE JUGADORES
-- =============================================================================

-- Acceso abierto mediante el código de invitación (QR general)
create or replace function public.join_competition(p_invite_code text, p_name text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_settings public.competition_settings;
  v_player uuid;
  v_name text := btrim(coalesce(p_name, ''));
begin
  if v_uid is null then perform public._raise('Sesión no válida. Recarga la página.'); end if;
  if public.is_admin() then perform public._raise('El juez no puede unirse como jugador con esta cuenta.'); end if;

  -- Ya vinculado: devolvemos su jugador (idempotente)
  v_player := public.current_player_id();
  if v_player is not null then
    return jsonb_build_object('player_id', v_player, 'existing', true);
  end if;

  select * into v_settings from public.competition_settings where id = 1;
  if upper(btrim(coalesce(p_invite_code, ''))) <> v_settings.invite_code then
    perform public._raise('El código de invitación no es válido. Escanea de nuevo el QR.');
  end if;
  if not v_settings.registration_open then
    perform public._raise('El registro está cerrado. Pide al juez tu código personal.');
  end if;
  if char_length(v_name) < 2 or char_length(v_name) > 40 then
    perform public._raise('Escribe un nombre de entre 2 y 40 caracteres.');
  end if;
  if exists (select 1 from public.players where lower(btrim(name)) = lower(v_name)) then
    perform public._raise('Ya existe un participante con ese nombre. Si eres tú, pide al juez tu QR personal; si no, añade tu apellido o un apodo.');
  end if;

  insert into public.players (name) values (v_name) returning id into v_player;
  insert into public.player_access_codes (player_id, code) values (v_player, public._gen_code(8));
  insert into public.player_sessions (player_id, user_id, method, user_agent)
  values (v_player, v_uid, 'invite', left(p_user_agent, 300));
  perform public._bump('players');
  return jsonb_build_object('player_id', v_player, 'existing', false);
end $$;

-- Acceso con código personal (QR individual generado por el juez)
create or replace function public.claim_player(p_code text, p_user_agent text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_player uuid;
  v_current uuid;
begin
  if v_uid is null then perform public._raise('Sesión no válida. Recarga la página.'); end if;
  if public.is_admin() then perform public._raise('El juez no puede unirse como jugador con esta cuenta.'); end if;

  select player_id into v_player from public.player_access_codes
  where code = upper(btrim(coalesce(p_code, '')));
  if v_player is null then perform public._raise('Código personal no válido.'); end if;

  v_current := public.current_player_id();
  if v_current = v_player then
    return jsonb_build_object('player_id', v_player, 'existing', true);
  end if;
  if v_current is not null then
    perform public._raise('Este dispositivo ya está vinculado a otro participante. Pide ayuda al juez.');
  end if;

  -- El código personal es de un solo uso: se revoca cualquier sesión anterior
  -- del jugador y se rota el código para que no pueda reutilizarse.
  perform 1 from public.players where id = v_player for update;
  update public.player_sessions set revoked_at = now(), revoked_reason = 'Nuevo acceso con código personal'
  where player_id = v_player and revoked_at is null;
  insert into public.player_sessions (player_id, user_id, method, user_agent)
  values (v_player, v_uid, 'personal_code', left(p_user_agent, 300));
  update public.player_access_codes set code = public._gen_code(8), created_at = now()
  where player_id = v_player;
  perform public._bump('players');
  return jsonb_build_object('player_id', v_player, 'existing', false);
end $$;

create or replace function public.touch_session()
returns void language sql security definer set search_path = public as $$
  update public.player_sessions set last_seen_at = now()
  where user_id = auth.uid() and revoked_at is null
    and last_seen_at < now() - interval '1 minute';
$$;

-- Estado completo para la vista de jugador
create or replace function public.get_my_state()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_player public.players;
  v_team public.teams;
  v_settings public.competition_settings;
  v_board jsonb := null;
begin
  select * into v_player from public.players where id = public.current_player_id();
  if not found then return jsonb_build_object('linked', false); end if;
  select * into v_team from public.teams where id = v_player.team_id;
  select * into v_settings from public.competition_settings where id = 1;

  if v_settings.scores_visible then
    select jsonb_agg(jsonb_build_object('team_id', s.team_id, 'name', s.name, 'color', s.color,
                                        'points', s.points, 'rank', s.rank) order by s.rank, s.sort_order)
      into v_board from public._standings() s;
  end if;

  return jsonb_build_object(
    'linked', true,
    'player', jsonb_build_object('id', v_player.id, 'name', v_player.name),
    'team', case when v_team.id is null then null else
      jsonb_build_object('id', v_team.id, 'name', v_team.name, 'color', v_team.color,
        'members', (select coalesce(jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name) order by p.name), '[]'::jsonb)
                    from public.players p where p.team_id = v_team.id)) end,
    'competition', jsonb_build_object('name', v_settings.name, 'subtitle', v_settings.subtitle,
                                      'status', v_settings.status,
                                      'winner_revealed', v_settings.winner_revealed_at is not null),
    'scores_visible', v_settings.scores_visible,
    'missions_revealed', v_settings.missions_revealed,
    'leaderboard', v_board,
    'last_update', case when v_settings.scores_visible then public._last_score_at() end
  );
end $$;

-- Información de modalidades para jugadores (sin resultados privados)
create or replace function public.get_player_modalities()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  v_pid uuid := public.current_player_id();
  v_sp public.spaghetti_state;
  v_duel_cfg jsonb;
begin
  if v_pid is null and not public.is_admin() then perform public._raise('Debes unirte a la competición.'); end if;
  select * into v_sp from public.spaghetti_state where id = 1;
  select config into v_duel_cfg from public.challenges where kind = 'duels';

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
                   from public.crash_lineups l where l.player_id = v_pid)),
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

-- =============================================================================
-- MISIONES (jugador)
-- =============================================================================
create or replace function public.claim_mission(p_mission_id uuid, p_note text)
returns void language plpgsql security definer set search_path = public as $$
declare v public.missions;
begin
  select * into v from public.missions where id = p_mission_id for update;
  if not found or v.player_id is distinct from public.current_player_id() then
    perform public._raise('Misión no encontrada.');
  end if;
  if v.status not in ('assigned', 'rejected') then
    perform public._raise('Esta misión ya no se puede marcar como completada.');
  end if;
  if char_length(btrim(coalesce(p_note, ''))) < 3 then
    perform public._raise('Cuenta brevemente cómo la has conseguido.');
  end if;
  update public.missions set status = 'claimed', claim_note = left(btrim(p_note), 500),
         claimed_at = now(), judge_note = null
  where id = v.id;
  perform public._bump('missions');
end $$;

create or replace function public.accuse_player(p_accused_id uuid, p_guess text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_me uuid := public.current_player_id();
  v_my_team uuid;
  v_their_team uuid;
begin
  if v_me is null then perform public._raise('Debes unirte a la competición.'); end if;
  perform public._assert_competition_open();
  if (select status from public.challenges where kind = 'missions') <> 'in_progress' then
    perform public._raise('Las misiones secretas no están en curso.');
  end if;
  if p_accused_id = v_me then perform public._raise('No puedes acusarte a ti mismo.'); end if;
  select team_id into v_my_team from public.players where id = v_me;
  select team_id into v_their_team from public.players where id = p_accused_id;
  if not found then perform public._raise('Participante no encontrado.'); end if;
  if v_my_team is null then perform public._raise('Aún no tienes equipo asignado.'); end if;
  if v_their_team = v_my_team then
    perform public._raise('Solo puedes desenmascarar a jugadores de otros equipos.');
  end if;
  if char_length(btrim(coalesce(p_guess, ''))) < 3 then
    perform public._raise('Explica qué misión crees que está haciendo.');
  end if;
  if exists (select 1 from public.mission_discoveries
             where accuser_player_id = v_me and accused_player_id = p_accused_id and status = 'pending') then
    perform public._raise('Ya tienes una acusación pendiente contra este jugador.');
  end if;
  insert into public.mission_discoveries (accuser_player_id, accused_player_id, guess)
  values (v_me, p_accused_id, left(btrim(p_guess), 500));
  perform public._bump('missions');
end $$;

-- Misiones de todos, solo cuando el juez las revela
create or replace function public.get_revealed_missions()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_participant() then perform public._raise('Debes unirte a la competición.'); end if;
  if not public.is_admin() and not (select missions_revealed from public.competition_settings where id = 1) then
    return null;
  end if;
  return (select coalesce(jsonb_agg(jsonb_build_object(
      'player', p.name, 'team', t.name, 'color', t.color, 'description', m.description,
      'status', m.status) order by t.sort_order, p.name), '[]'::jsonb)
    from public.missions m join public.players p on p.id = m.player_id
    left join public.teams t on t.id = p.team_id);
end $$;

-- =============================================================================
-- JUEZ · PARTICIPANTES
-- =============================================================================
create or replace function public.admin_create_player(p_name text, p_team_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_name text := btrim(coalesce(p_name, ''));
begin
  perform public.assert_admin();
  if char_length(v_name) < 1 then perform public._raise('El nombre es obligatorio.'); end if;
  if exists (select 1 from public.players where lower(btrim(name)) = lower(v_name)) then
    perform public._raise('Ya existe un participante con ese nombre.');
  end if;
  insert into public.players (name, team_id) values (v_name, p_team_id) returning id into v_id;
  insert into public.player_access_codes (player_id, code) values (v_id, public._gen_code(8));
  perform public._bump('players');
  return v_id;
end $$;

-- Incidencia de sesión: cierra la sesión del jugador y genera un nuevo código
create or replace function public.admin_reset_player_access(p_player_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := public._gen_code(8);
begin
  perform public.assert_admin();
  update public.player_sessions set revoked_at = now(), revoked_reason = 'Revocada por el juez'
  where player_id = p_player_id and revoked_at is null;
  insert into public.player_access_codes (player_id, code) values (p_player_id, v_code)
  on conflict (player_id) do update set code = excluded.code, created_at = now();
  perform public._bump('players');
  return v_code;
end $$;

-- =============================================================================
-- JUEZ · COMPETICIÓN Y MODALIDADES
-- =============================================================================
create or replace function public.admin_set_challenge_status(p_challenge_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_teams int;
  v_races int;
begin
  perform public.assert_admin();
  if p_status not in ('pending', 'preparing', 'in_progress', 'finished') then
    perform public._raise('Estado no válido.');
  end if;
  select * into v from public.challenges where id = p_challenge_id for update;
  if not found then perform public._raise('Modalidad no encontrada.'); end if;
  if v.status = 'finished' and p_status <> 'finished' and v.results_confirmed_at is not null then
    -- Reabrir está permitido (p. ej. por error), los puntos confirmados no se repiten.
    null;
  end if;

  if p_status = 'in_progress' then
    perform public._assert_competition_open();
    select count(*) into v_teams from public.teams t where exists (select 1 from public.players p where p.team_id = t.id);
    if v_teams < 2 then perform public._raise('Se necesitan al menos 2 equipos con participantes.'); end if;
    if v.kind = 'crash' then
      v_races := coalesce((v.config ->> 'race_count')::int, 0);
      if (select count(*) from public.crash_races where not is_training) <> v_races or v_races = 0 then
        perform public._raise('Configura las carreras del torneo antes de iniciarlo.');
      end if;
      if exists (select 1 from public.teams t
                 where exists (select 1 from public.players p where p.team_id = t.id)
                   and (select count(*) from public.crash_lineups l where l.team_id = t.id) <> v_races) then
        perform public._raise(format('Cada equipo debe tener exactamente %s pilotos en su alineación.', v_races));
      end if;
    end if;
  end if;

  if p_status = 'finished' then
    if v.kind = 'crash' and exists (select 1 from public.crash_races where not is_training and status <> 'finished') then
      perform public._raise('Quedan carreras oficiales sin resultado.');
    elsif v.kind in ('overcooked', 'spaghetti') and v.results_confirmed_at is null then
      perform public._raise('Confirma los resultados antes de finalizar la modalidad.');
    elsif v.kind = 'duels' and exists (select 1 from public.duels where status = 'in_progress') then
      perform public._raise('Hay duelos en curso. Finalízalos o cancélalos primero.');
    elsif v.kind = 'missions' and (exists (select 1 from public.missions where status = 'claimed')
                                   or exists (select 1 from public.mission_discoveries where status = 'pending')) then
      perform public._raise('Hay misiones o acusaciones pendientes de validar.');
    end if;
  end if;

  update public.challenges set status = p_status,
    started_at  = case when p_status = 'in_progress' then coalesce(started_at, now()) else started_at end,
    finished_at = case when p_status = 'finished' then now() else null end
  where id = v.id;

  if (select status from public.competition_settings where id = 1) = 'setup' and p_status = 'in_progress' then
    update public.competition_settings set status = 'running' where id = 1;
    perform public._bump('settings');
  end if;
  perform public._bump('challenges');
end $$;

-- Configuración numérica de una modalidad (validada por tipo)
create or replace function public.admin_update_challenge_config(p_challenge_id uuid, p_config jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare v public.challenges; v_new jsonb; k text;
begin
  perform public.assert_admin();
  select * into v from public.challenges where id = p_challenge_id for update;
  if not found then perform public._raise('Modalidad no encontrada.'); end if;
  if jsonb_typeof(p_config) <> 'object' then perform public._raise('Configuración no válida.'); end if;
  -- Las tablas de puntos no se cambian con resultados ya registrados
  if v.results_confirmed_at is not null or (v.kind = 'crash' and exists (select 1 from public.crash_race_results r join public.crash_races cr on cr.id = r.race_id where not cr.is_training)) then
    for k in select jsonb_object_keys(p_config) loop
      if k like 'points%' then perform public._raise('No se pueden cambiar los puntos con resultados ya registrados.'); end if;
    end loop;
  end if;
  if v.kind = 'crash' and p_config ? 'race_count' then
    perform public._raise('Usa la configuración de carreras para cambiar su número.');
  end if;
  v_new := v.config || p_config;
  -- Validaciones mínimas de tipos
  for k in select jsonb_object_keys(v_new) loop
    if k like 'points%' and jsonb_typeof(v_new -> k) not in ('array', 'number') then
      perform public._raise('Las tablas de puntos deben ser números.');
    end if;
  end loop;
  update public.challenges set config = v_new where id = v.id;
  perform public._bump('challenges');
end $$;

create or replace function public.admin_set_competition_status(p_status text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_status not in ('setup', 'running', 'finished') then perform public._raise('Estado no válido.'); end if;
  update public.competition_settings
     set status = p_status,
         finished_at = case when p_status = 'finished' then now() else null end,
         winner_revealed_at = case when p_status = 'finished' then winner_revealed_at else null end
   where id = 1;
  if p_status <> 'finished' then
    update public.tv_settings set mode = 'leaderboard' where id = 1 and mode in ('final_results', 'champion');
    perform public._bump('tv');
  end if;
  perform public._bump('settings');
end $$;

create or replace function public.admin_regenerate_invite_code()
returns text language plpgsql security definer set search_path = public as $$
declare v_code text := public._gen_code(6);
begin
  perform public.assert_admin();
  update public.competition_settings set invite_code = v_code where id = 1;
  return v_code;
end $$;

-- =============================================================================
-- JUEZ · AJUSTES DE PUNTUACIÓN (movimientos compensatorios)
-- =============================================================================
create or replace function public.admin_adjust_score(
  p_team_id uuid, p_points int, p_reason text, p_player_id uuid default null,
  p_corrects_event_id uuid default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare v_id uuid;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  if p_points is null or p_points = 0 or abs(p_points) > 500 then
    perform public._raise('Indica una cantidad de puntos distinta de 0 (máx. ±500).');
  end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then
    perform public._raise('Indica el motivo del ajuste.');
  end if;
  if not exists (select 1 from public.teams where id = p_team_id) then perform public._raise('Equipo no encontrado.'); end if;
  if p_corrects_event_id is not null then
    if not exists (select 1 from public.score_events where id = p_corrects_event_id and team_id = p_team_id) then
      perform public._raise('El movimiento a corregir no pertenece a ese equipo.');
    end if;
  end if;
  v_id := public._award(p_team_id, p_points, 'Ajuste: ' || btrim(p_reason), null, p_player_id,
                        'adjustment', null, p_corrects_event_id);
  perform public._bump('scores');
  return v_id;
end $$;

-- Anula un movimiento concreto generando su contrario
create or replace function public.admin_revert_score_event(p_event_id uuid, p_reason text)
returns uuid language plpgsql security definer set search_path = public as $$
declare v public.score_events; v_id uuid;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  select * into v from public.score_events where id = p_event_id for update;
  if not found then perform public._raise('Movimiento no encontrado.'); end if;
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then perform public._raise('Indica el motivo.'); end if;
  v_id := public._award(v.team_id, -v.points, 'Corrección: ' || btrim(p_reason) || ' (anula «' || v.reason || '»)',
                        v.challenge_id, v.player_id, 'adjustment', 'revert:' || v.id::text, v.id);
  perform public._bump('scores');
  return v_id;
end $$;

-- =============================================================================
-- JUEZ · CRASH TEAM RACING
-- =============================================================================
create or replace function public.admin_crash_setup(p_tracks text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_n int := coalesce(array_length(p_tracks, 1), 0);
  i int;
begin
  perform public.assert_admin();
  v := public._lock_challenge('crash', false);
  if v.status in ('in_progress', 'finished') then
    perform public._raise('No se pueden cambiar las carreras con el torneo en curso o finalizado.');
  end if;
  if v_n < 1 or v_n > 12 then perform public._raise('El torneo debe tener entre 1 y 12 carreras.'); end if;
  if exists (select 1 from public.crash_race_results r join public.crash_races cr on cr.id = r.race_id where not cr.is_training) then
    perform public._raise('Ya hay resultados oficiales registrados.');
  end if;

  delete from public.crash_races where not is_training and race_number > v_n;
  for i in 1..v_n loop
    insert into public.crash_races (race_number, is_training, track)
    values (i, false, coalesce(nullif(btrim(p_tracks[i]), ''), 'Pista ' || i))
    on conflict (race_number) do update set track = excluded.track;
  end loop;
  insert into public.crash_races (race_number, is_training, track) values (0, true, 'Entrenamiento')
  on conflict (race_number) do nothing;
  delete from public.crash_lineups where slot > v_n;
  update public.challenges set config = config || jsonb_build_object('race_count', v_n) where id = v.id;
  perform public._bump('challenges');
end $$;

create or replace function public.admin_crash_set_lineup(p_team_id uuid, p_player_ids uuid[])
returns void language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_n int;
  v_team_size int;
  i int;
begin
  perform public.assert_admin();
  v := public._lock_challenge('crash', false);
  if v.status = 'finished' then perform public._raise('El torneo ha finalizado.'); end if;
  v_n := coalesce((v.config ->> 'race_count')::int, 0);
  if v_n = 0 then perform public._raise('Configura primero las carreras.'); end if;
  if coalesce(array_length(p_player_ids, 1), 0) <> v_n then
    perform public._raise(format('La alineación debe tener exactamente %s pilotos (uno por carrera).', v_n));
  end if;
  if exists (select 1 from unnest(p_player_ids) x
             where not exists (select 1 from public.players p where p.id = x and p.team_id = p_team_id)) then
    perform public._raise('Todos los pilotos deben pertenecer al equipo.');
  end if;
  select count(*) into v_team_size from public.players where team_id = p_team_id;
  -- Pilotos distintos, salvo que el equipo tenga menos integrantes que carreras
  if v_team_size >= v_n and (select count(distinct x) from unnest(p_player_ids) x) <> v_n then
    perform public._raise('Cada carrera debe tener un piloto distinto.');
  end if;
  -- Las carreras ya disputadas conservan su piloto
  if exists (select 1 from public.crash_lineups l join public.crash_races r on r.race_number = l.slot
             where l.team_id = p_team_id and r.status = 'finished' and l.player_id <> p_player_ids[l.slot]) then
    perform public._raise('No se puede cambiar el piloto de una carrera ya disputada.');
  end if;
  delete from public.crash_lineups where team_id = p_team_id;
  for i in 1..v_n loop
    insert into public.crash_lineups (team_id, slot, player_id) values (p_team_id, i, p_player_ids[i]);
  end loop;
  perform public._bump('challenges');
end $$;

create or replace function public.admin_crash_set_race_status(p_race_id uuid, p_status text)
returns void language plpgsql security definer set search_path = public as $$
declare r public.crash_races;
begin
  perform public.assert_admin();
  perform public._lock_challenge('crash', true);
  select * into r from public.crash_races where id = p_race_id for update;
  if not found then perform public._raise('Carrera no encontrada.'); end if;
  if r.status = 'finished' then perform public._raise('La carrera ya tiene resultado.'); end if;
  if p_status not in ('pending', 'in_progress') then perform public._raise('Estado no válido.'); end if;
  update public.crash_races set status = p_status where id = r.id;
  perform public._bump('challenges');
end $$;

-- p_results: [{ "player_id": uuid, "raw_position": int }]  (posición en carrera con bots)
create or replace function public.admin_crash_record_race(p_race_id uuid, p_results jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  r public.crash_races;
  v_points jsonb;
  v_rows jsonb;
  v_count int;
  rec record;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  v := public._lock_challenge('crash', true);
  select * into r from public.crash_races where id = p_race_id for update;
  if not found then perform public._raise('Carrera no encontrada.'); end if;
  if r.status = 'finished' then perform public._raise('Esta carrera ya tiene resultado registrado.'); end if;
  if jsonb_typeof(p_results) <> 'array' then perform public._raise('Formato de resultados no válido.'); end if;
  v_points := coalesce(v.config -> 'points', '[20,15,10,5]'::jsonb);

  create temp table if not exists _crash_in (player_id uuid, raw_position int, team_id uuid, player_name text) on commit drop;
  truncate _crash_in;
  insert into _crash_in (player_id, raw_position)
  select (e ->> 'player_id')::uuid, (e ->> 'raw_position')::int from jsonb_array_elements(p_results) e;
  update _crash_in i set team_id = p.team_id, player_name = p.name from public.players p where p.id = i.player_id;

  select count(*) into v_count from _crash_in;
  if v_count < 2 then perform public._raise('Introduce al menos dos pilotos.'); end if;
  if exists (select 1 from _crash_in where team_id is null) then
    perform public._raise('Todos los pilotos deben pertenecer a un equipo.');
  end if;
  if exists (select 1 from _crash_in where raw_position is null or raw_position < 1 or raw_position > 16) then
    perform public._raise('Las posiciones deben estar entre 1 y 16.');
  end if;
  if (select count(distinct player_id) from _crash_in) <> v_count
     or (select count(distinct team_id) from _crash_in) <> v_count
     or (select count(distinct raw_position) from _crash_in) <> v_count then
    perform public._raise('Cada equipo debe tener un único piloto y las posiciones no pueden repetirse.');
  end if;
  if not r.is_training then
    -- En carreras oficiales deben correr todos los equipos con alineación
    if exists (select 1 from public.crash_lineups l where l.slot = r.race_number
               and not exists (select 1 from _crash_in i where i.team_id = l.team_id)) then
      perform public._raise('Falta el resultado de algún equipo en esta carrera.');
    end if;
  end if;

  -- Los bots no cuentan: la posición humana es el orden relativo entre humanos
  select jsonb_agg(jsonb_build_object(
           'player_id', x.player_id, 'player_name', x.player_name, 'team_id', x.team_id,
           'team_name', t.name, 'team_color', t.color,
           'raw_position', x.raw_position, 'human_position', x.hp,
           'points', case when r.is_training then 0 else public._points_at(v_points, x.hp::int) end)
         order by x.hp)
    into v_rows
  from (select i.*, row_number() over (order by i.raw_position) as hp from _crash_in i) x
  join public.teams t on t.id = x.team_id;

  if p_dry_run then
    return jsonb_build_object('race', r.race_number, 'is_training', r.is_training, 'results', v_rows);
  end if;

  for rec in select * from jsonb_to_recordset(v_rows)
      as x(player_id uuid, player_name text, team_id uuid, raw_position int, human_position int, points int) loop
    insert into public.crash_race_results (race_id, player_id, team_id, raw_position, human_position, points)
    values (r.id, rec.player_id, rec.team_id, rec.raw_position, rec.human_position, rec.points);
    if not r.is_training then
      perform public._award(rec.team_id, rec.points,
        format('Crash · Carrera %s (%s) · %sº humano: %s', r.race_number, r.track, rec.human_position, rec.player_name),
        v.id, rec.player_id, 'crash', format('crash:%s:%s', r.id, rec.player_id));
    end if;
  end loop;
  update public.crash_races set status = 'finished', finished_at = now() where id = r.id;
  perform public._bump('challenges');
  perform public._bump('scores');
  return jsonb_build_object('race', r.race_number, 'is_training', r.is_training, 'results', v_rows);
end $$;

-- Reinicia SOLO la carrera de entrenamiento (para poder practicar de nuevo)
create or replace function public.admin_crash_reset_training()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  delete from public.crash_race_results where race_id in (select id from public.crash_races where is_training);
  update public.crash_races set status = 'pending', finished_at = null where is_training;
  perform public._bump('challenges');
end $$;

-- =============================================================================
-- JUEZ · OVERCOOKED
-- =============================================================================
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
  insert into public.overcooked_results (team_id, is_training, score, notes)
  values (p_team_id, p_is_training, p_score, coalesce(p_notes, ''))
  on conflict (team_id, is_training) do update set score = excluded.score, notes = excluded.notes;
  perform public._bump('challenges');
end $$;

create or replace function public.admin_overcooked_delete_score(p_team_id uuid, p_is_training boolean)
returns void language plpgsql security definer set search_path = public as $$
declare v public.challenges;
begin
  perform public.assert_admin();
  v := public._lock_challenge('overcooked', false);
  if not p_is_training and v.results_confirmed_at is not null then
    perform public._raise('Los resultados oficiales ya están confirmados.');
  end if;
  delete from public.overcooked_results where team_id = p_team_id and is_training = p_is_training;
  perform public._bump('challenges');
end $$;

create or replace function public.admin_overcooked_confirm(p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_points jsonb;
  v_rows jsonb;
  rec record;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  v := public._lock_challenge('overcooked', true);
  if v.results_confirmed_at is not null then perform public._raise('Los resultados ya estaban confirmados.'); end if;
  if exists (select 1 from public.teams t where exists (select 1 from public.players p where p.team_id = t.id)
             and not exists (select 1 from public.overcooked_results o where o.team_id = t.id and not o.is_training)) then
    perform public._raise('Falta la puntuación oficial de algún equipo.');
  end if;
  v_points := coalesce(v.config -> 'points', '[40,30,20,10]'::jsonb);

  select jsonb_agg(jsonb_build_object('team_id', x.team_id, 'team_name', t.name, 'team_color', t.color,
           'score', x.score, 'position', x.pos,
           'points', public._points_at(v_points, x.pos::int)) order by x.pos, t.sort_order)
    into v_rows
  from (select o.team_id, o.score, rank() over (order by o.score desc) as pos
        from public.overcooked_results o where not o.is_training) x
  join public.teams t on t.id = x.team_id;

  if p_dry_run then return jsonb_build_object('results', v_rows); end if;

  for rec in select * from jsonb_to_recordset(v_rows) as x(team_id uuid, score int, position int, points int) loop
    update public.overcooked_results set position = rec.position, points = rec.points
    where team_id = rec.team_id and not is_training;
    perform public._award(rec.team_id, rec.points,
      format('Overcooked · %sº puesto (%s pts de juego)', rec.position, rec.score),
      v.id, null, 'overcooked', format('overcooked:%s', rec.team_id));
  end loop;
  update public.challenges set results_confirmed_at = now() where id = v.id;
  perform public._bump('challenges');
  perform public._bump('scores');
  return jsonb_build_object('results', v_rows);
end $$;

-- =============================================================================
-- JUEZ · SPAGHETTI & MARSHMALLOW
-- =============================================================================
create or replace function public.admin_spaghetti_set_reference(p_path text, p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_path is not null and p_path !~ '^spaghetti/[A-Za-z0-9._-]+$' then
    perform public._raise('Ruta de imagen no válida.');
  end if;
  update public.spaghetti_state
     set reference_image_path = p_path,
         reference_visible = coalesce(p_visible, false) and p_path is not null
   where id = 1;
  perform public._bump('spaghetti');
end $$;

create or replace function public.admin_spaghetti_set_visible(p_visible boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_visible and (select reference_image_path from public.spaghetti_state where id = 1) is null then
    perform public._raise('Sube primero la imagen de referencia.');
  end if;
  update public.spaghetti_state set reference_visible = p_visible where id = 1;
  perform public._bump('spaghetti');
end $$;

-- Acciones: start | pause | resume | cancel | finish | reset ; p_minutes solo para start/reset
create or replace function public.admin_spaghetti_timer(p_action text, p_minutes int default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  s public.spaghetti_state;
  v public.challenges;
  v_dur int;
begin
  perform public.assert_admin();
  select * into s from public.spaghetti_state where id = 1 for update;
  v := public._lock_challenge('spaghetti', false);

  if p_action = 'start' then
    perform public._assert_competition_open();
    if s.timer_status in ('running', 'paused') then perform public._raise('El cronómetro ya está activo.'); end if;
    if s.timer_status = 'finished' then perform public._raise('La prueba ya ha terminado. Reinicia el cronómetro si es necesario.'); end if;
    if v.status = 'finished' then perform public._raise('La modalidad ha finalizado.'); end if;
    v_dur := coalesce(p_minutes * 60, s.duration_seconds);
    if v_dur < 60 or v_dur > 14400 then perform public._raise('Duración no válida.'); end if;
    if v.status <> 'in_progress' then
      perform public.admin_set_challenge_status(v.id, 'in_progress');
    end if;
    update public.spaghetti_state set timer_status = 'running', duration_seconds = v_dur,
      started_at = now(), ends_at = now() + make_interval(secs => v_dur), paused_remaining_ms = null
    where id = 1;
  elsif p_action = 'pause' then
    if s.timer_status <> 'running' then perform public._raise('El cronómetro no está en marcha.'); end if;
    update public.spaghetti_state set timer_status = 'paused',
      paused_remaining_ms = greatest(0, (extract(epoch from (s.ends_at - now())) * 1000)::bigint), ends_at = null
    where id = 1;
  elsif p_action = 'resume' then
    if s.timer_status <> 'paused' then perform public._raise('El cronómetro no está en pausa.'); end if;
    update public.spaghetti_state set timer_status = 'running',
      ends_at = now() + make_interval(secs => s.paused_remaining_ms / 1000.0), paused_remaining_ms = null
    where id = 1;
  elsif p_action = 'finish' then
    if s.timer_status not in ('running', 'paused') then perform public._raise('El cronómetro no está activo.'); end if;
    update public.spaghetti_state set timer_status = 'finished',
      ends_at = least(coalesce(s.ends_at, now()), now()), paused_remaining_ms = null where id = 1;
  elsif p_action = 'cancel' then
    update public.spaghetti_state set timer_status = 'cancelled', ends_at = null, paused_remaining_ms = null where id = 1;
  elsif p_action = 'reset' then
    if s.timer_status = 'running' then perform public._raise('Detén el cronómetro antes de reiniciarlo.'); end if;
    update public.spaghetti_state set timer_status = 'idle', started_at = null, ends_at = null,
      paused_remaining_ms = null,
      duration_seconds = coalesce(p_minutes * 60, duration_seconds) where id = 1;
  else
    perform public._raise('Acción no válida.');
  end if;
  perform public._bump('spaghetti');
  select * into s from public.spaghetti_state where id = 1;
  return to_jsonb(s) || jsonb_build_object('server_now', now());
end $$;

-- p_ranking: [{ "team_id": uuid, "position": int }]
create or replace function public.admin_spaghetti_confirm(p_ranking jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_points jsonb;
  v_rows jsonb;
  v_positions int[];
  rec record;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  v := public._lock_challenge('spaghetti', true);
  if v.results_confirmed_at is not null then perform public._raise('La clasificación ya estaba confirmada.'); end if;
  if (select timer_status from public.spaghetti_state where id = 1) in ('running', 'paused') then
    perform public._raise('Finaliza el cronómetro antes de registrar la clasificación.');
  end if;
  v_points := coalesce(v.config -> 'points', '[50,35,20,10]'::jsonb);

  create temp table if not exists _sp_in (team_id uuid, position int) on commit drop;
  truncate _sp_in;
  insert into _sp_in select (e ->> 'team_id')::uuid, (e ->> 'position')::int from jsonb_array_elements(p_ranking) e;

  if exists (select 1 from _sp_in i where not exists (select 1 from public.teams t where t.id = i.team_id)) then
    perform public._raise('Equipo no válido.');
  end if;
  if (select count(distinct team_id) from _sp_in) <> (select count(*) from _sp_in) then
    perform public._raise('Un equipo aparece repetido.');
  end if;
  if exists (select 1 from public.teams t where exists (select 1 from public.players p where p.team_id = t.id)
             and not exists (select 1 from _sp_in i where i.team_id = t.id)) then
    perform public._raise('Falta la posición de algún equipo.');
  end if;
  select array_agg(position) into v_positions from _sp_in;
  if not public._valid_ranking(v_positions) then
    perform public._raise('Posiciones no válidas. En caso de empate usa la misma posición y salta las siguientes (1, 1, 3...).');
  end if;

  select jsonb_agg(jsonb_build_object('team_id', i.team_id, 'team_name', t.name, 'team_color', t.color,
           'position', i.position, 'points', public._points_at(v_points, i.position)) order by i.position, t.sort_order)
    into v_rows
  from _sp_in i join public.teams t on t.id = i.team_id;

  if p_dry_run then return jsonb_build_object('results', v_rows); end if;

  for rec in select * from jsonb_to_recordset(v_rows) as x(team_id uuid, position int, points int) loop
    insert into public.spaghetti_results (team_id, position, points) values (rec.team_id, rec.position, rec.points);
    perform public._award(rec.team_id, rec.points, format('Spaghetti & Marshmallow · %sº puesto', rec.position),
      v.id, null, 'spaghetti', format('spaghetti:%s', rec.team_id));
  end loop;
  update public.challenges set results_confirmed_at = now() where id = v.id;
  perform public._bump('challenges');
  perform public._bump('scores');
  return jsonb_build_object('results', v_rows);
end $$;

-- =============================================================================
-- JUEZ · DUELOS
-- =============================================================================
create or replace function public.admin_create_duel(p_game_id uuid, p_format text, p_player_ids uuid[], p_notes text default '')
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  v_n int := coalesce(array_length(p_player_ids, 1), 0);
  v_limit int;
  v_id uuid;
  v_over text;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  v := public._lock_challenge('duels', true);
  if not exists (select 1 from public.duel_games where id = p_game_id and active) then
    perform public._raise('Selecciona un juego válido.');
  end if;
  if p_format not in ('1v1', 'multi') then perform public._raise('Formato no válido.'); end if;
  if (select count(distinct x) from unnest(p_player_ids) x) <> v_n then
    perform public._raise('Hay participantes duplicados.');
  end if;
  if p_format = '1v1' and v_n <> 2 then perform public._raise('Un duelo 1 contra 1 requiere exactamente 2 jugadores.'); end if;
  if p_format = 'multi' and v_n < 3 then perform public._raise('Una partida multijugador requiere 3 o más jugadores.'); end if;
  if v_n > 12 then perform public._raise('Máximo 12 jugadores por partida.'); end if;

  -- Bloqueo de los jugadores para evitar carreras al comprobar el límite
  perform 1 from public.players where id = any(p_player_ids) order by id for update;
  if (select count(*) from public.players where id = any(p_player_ids) and team_id is not null) <> v_n then
    perform public._raise('Todos los jugadores deben existir y tener equipo asignado.');
  end if;
  if (select count(distinct team_id) from public.players where id = any(p_player_ids)) < 2 then
    perform public._raise('Los jugadores deben pertenecer a equipos diferentes.');
  end if;
  if p_format = '1v1' and (select count(distinct team_id) from public.players where id = any(p_player_ids)) <> 2 then
    perform public._raise('En un 1 contra 1 los jugadores deben ser de equipos diferentes.');
  end if;

  v_limit := coalesce((v.config ->> 'limit_per_player')::int, 3);
  select string_agg(p.name, ', ') into v_over from public.players p
  where p.id = any(p_player_ids)
    and (select count(*) from public.duel_players dp join public.duels d on d.id = dp.duel_id
         where dp.player_id = p.id and d.status in ('in_progress', 'finished')) >= v_limit;
  if v_over is not null then
    perform public._raise(format('Límite de %s duelos puntuables alcanzado: %s.', v_limit, v_over));
  end if;

  insert into public.duels (game_id, format, notes, created_by)
  values (p_game_id, p_format, coalesce(p_notes, ''), auth.uid()) returning id into v_id;
  insert into public.duel_players (duel_id, player_id, team_id)
  select v_id, p.id, p.team_id from public.players p where p.id = any(p_player_ids);
  perform public._bump('duels');
  return v_id;
end $$;

-- p_results: [{ "player_id": uuid, "position": int }]
create or replace function public.admin_finish_duel(p_duel_id uuid, p_results jsonb, p_dry_run boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v public.challenges;
  d public.duels;
  v_game text;
  v_positions int[];
  v_rows jsonb;
  v_n int;
  rec record;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  v := public._lock_challenge('duels', false);
  select * into d from public.duels where id = p_duel_id for update;
  if not found then perform public._raise('Duelo no encontrado.'); end if;
  if d.status <> 'in_progress' then perform public._raise('Este duelo ya no está en curso.'); end if;
  select name into v_game from public.duel_games where id = d.game_id;

  create temp table if not exists _duel_in (player_id uuid, position int) on commit drop;
  truncate _duel_in;
  insert into _duel_in select (e ->> 'player_id')::uuid, (e ->> 'position')::int from jsonb_array_elements(p_results) e;
  select count(*) into v_n from public.duel_players where duel_id = d.id;

  if (select count(*) from _duel_in i join public.duel_players dp on dp.duel_id = d.id and dp.player_id = i.player_id) <> v_n
     or (select count(*) from _duel_in) <> v_n
     or (select count(distinct player_id) from _duel_in) <> v_n then
    perform public._raise('Indica la posición de todos los participantes del duelo.');
  end if;
  select array_agg(position) into v_positions from _duel_in;
  if not public._valid_ranking(v_positions) then
    perform public._raise('Posiciones no válidas. En caso de empate usa la misma posición (1, 1, 3...).');
  end if;

  select jsonb_agg(jsonb_build_object('player_id', i.player_id, 'player_name', p.name,
           'team_id', dp.team_id, 'team_name', t.name, 'team_color', t.color, 'position', i.position,
           'points', case when d.format = '1v1'
                          then case when i.position = 1 then coalesce((v.config ->> 'points_1v1')::int, 15) else 0 end
                          else public._points_at(coalesce(v.config -> 'points_multi', '[15,8]'::jsonb), i.position) end)
         order by i.position, p.name)
    into v_rows
  from _duel_in i
  join public.duel_players dp on dp.duel_id = d.id and dp.player_id = i.player_id
  join public.players p on p.id = i.player_id
  join public.teams t on t.id = dp.team_id;

  if p_dry_run then
    return jsonb_build_object('game', v_game, 'format', d.format, 'results', v_rows,
      'team_totals', (select jsonb_agg(jsonb_build_object('team_name', team_name, 'team_color', team_color, 'points', pts))
                      from (select x ->> 'team_name' team_name, x ->> 'team_color' team_color, sum((x ->> 'points')::int) pts
                            from jsonb_array_elements(v_rows) x group by 1, 2 order by 3 desc) s));
  end if;

  for rec in select * from jsonb_to_recordset(v_rows)
      as x(player_id uuid, player_name text, team_id uuid, position int, points int) loop
    update public.duel_players set position = rec.position, points = rec.points
    where duel_id = d.id and player_id = rec.player_id;
    perform public._award(rec.team_id, rec.points,
      format('Duelo %s · %s · %sº: %s', case when d.format = '1v1' then '1v1' else 'multijugador' end, v_game, rec.position, rec.player_name),
      v.id, rec.player_id, 'duel', format('duel:%s:%s', d.id, rec.player_id));
  end loop;
  update public.duels set status = 'finished', finished_at = now(), finished_by = auth.uid() where id = d.id;
  perform public._bump('duels');
  perform public._bump('scores');
  return jsonb_build_object('game', v_game, 'format', d.format, 'results', v_rows);
end $$;

create or replace function public.admin_cancel_duel(p_duel_id uuid, p_reason text default '')
returns void language plpgsql security definer set search_path = public as $$
declare d public.duels;
begin
  perform public.assert_admin();
  select * into d from public.duels where id = p_duel_id for update;
  if not found then perform public._raise('Duelo no encontrado.'); end if;
  if d.status <> 'in_progress' then perform public._raise('Solo se pueden cancelar duelos en curso.'); end if;
  update public.duels set status = 'cancelled', finished_at = now(), finished_by = auth.uid(),
    void_reason = nullif(btrim(p_reason), '') where id = d.id;
  perform public._bump('duels');
end $$;

-- Anula un duelo finalizado dejando constancia: genera movimientos compensatorios
create or replace function public.admin_void_duel(p_duel_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = public as $$
declare d public.duels; e record;
begin
  perform public.assert_admin();
  perform public._assert_competition_open();
  if char_length(btrim(coalesce(p_reason, ''))) < 3 then perform public._raise('Indica el motivo de la anulación.'); end if;
  select * into d from public.duels where id = p_duel_id for update;
  if not found then perform public._raise('Duelo no encontrado.'); end if;
  if d.status <> 'finished' then perform public._raise('Solo se pueden anular duelos finalizados.'); end if;
  for e in select * from public.score_events where source_key like 'duel:' || d.id::text || ':%' loop
    perform public._award(e.team_id, -e.points, 'Anulación de duelo: ' || btrim(p_reason), e.challenge_id,
                          e.player_id, 'void', 'void:' || e.id::text, e.id);
  end loop;
  update public.duels set status = 'voided', void_reason = btrim(p_reason) where id = d.id;
  perform public._bump('duels');
  perform public._bump('scores');
end $$;

-- =============================================================================
-- JUEZ · MISIONES
-- =============================================================================
create or replace function public.admin_create_mission(p_player_id uuid, p_description text, p_reward int default null)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_cfg jsonb;
  v_limit int;
  v_id uuid;
begin
  perform public.assert_admin();
  select config into v_cfg from public.challenges where kind = 'missions';
  v_limit := coalesce((v_cfg ->> 'limit_per_player')::int, 3);
  perform 1 from public.players where id = p_player_id for update;
  if not found then perform public._raise('Participante no encontrado.'); end if;
  if (select count(*) from public.missions where player_id = p_player_id and status <> 'discovered') >= v_limit then
    perform public._raise(format('Este jugador ya tiene el máximo de %s misiones.', v_limit));
  end if;
  insert into public.missions (player_id, description, reward)
  values (p_player_id, btrim(p_description), coalesce(p_reward, (v_cfg ->> 'reward_default')::int, 5))
  returning id into v_id;
  perform public._bump('missions');
  return v_id;
end $$;

create or replace function public.admin_update_mission(p_mission_id uuid, p_description text, p_reward int)
returns void language plpgsql security definer set search_path = public as $$
declare m public.missions;
begin
  perform public.assert_admin();
  select * into m from public.missions where id = p_mission_id for update;
  if not found then perform public._raise('Misión no encontrada.'); end if;
  if m.status in ('validated', 'discovered') then perform public._raise('No se puede editar una misión cerrada.'); end if;
  update public.missions set description = btrim(p_description), reward = p_reward where id = m.id;
  perform public._bump('missions');
end $$;

create or replace function public.admin_delete_mission(p_mission_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare m public.missions;
begin
  perform public.assert_admin();
  select * into m from public.missions where id = p_mission_id for update;
  if not found then perform public._raise('Misión no encontrada.'); end if;
  if m.status in ('validated', 'discovered') or exists (select 1 from public.mission_discoveries where mission_id = m.id) then
    perform public._raise('No se puede eliminar una misión con puntos o descubrimientos asociados.');
  end if;
  delete from public.missions where id = m.id;
  perform public._bump('missions');
end $$;

create or replace function public.admin_review_mission(p_mission_id uuid, p_approve boolean, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  m public.missions;
  v public.challenges;
  v_team uuid;
  v_name text;
begin
  perform public.assert_admin();
  select * into m from public.missions where id = p_mission_id for update;
  if not found then perform public._raise('Misión no encontrada.'); end if;
  if m.status <> 'claimed' then perform public._raise('La misión no está pendiente de validación.'); end if;
  if p_approve then
    perform public._assert_competition_open();
    v := public._lock_challenge('missions', true);
    select team_id, name into v_team, v_name from public.players where id = m.player_id;
    if v_team is null then perform public._raise('El jugador no tiene equipo asignado.'); end if;
    update public.missions set status = 'validated', validated_at = now(), validated_by = auth.uid(),
      judge_note = nullif(btrim(p_note), '') where id = m.id;
    perform public._award(v_team, m.reward, format('Misión secreta completada: %s', v_name),
      v.id, m.player_id, 'mission', 'mission:' || m.id::text);
    -- Acusaciones pendientes sobre esta misión ya no pueden prosperar
    perform public._bump('scores');
  else
    update public.missions set status = 'rejected', judge_note = nullif(btrim(p_note), '') where id = m.id;
  end if;
  perform public._bump('missions');
end $$;

-- Resolver una acusación. Si es correcta, p_mission_id indica la misión descubierta.
create or replace function public.admin_resolve_discovery(p_discovery_id uuid, p_correct boolean,
  p_mission_id uuid default null, p_note text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  x public.mission_discoveries;
  m public.missions;
  v public.challenges;
  v_team uuid;
  v_name text;
  v_disc_points int;
begin
  perform public.assert_admin();
  select * into x from public.mission_discoveries where id = p_discovery_id for update;
  if not found then perform public._raise('Acusación no encontrada.'); end if;
  if x.status <> 'pending' then perform public._raise('Esta acusación ya fue resuelta.'); end if;

  if p_correct then
    perform public._assert_competition_open();
    v := public._lock_challenge('missions', true);
    select * into m from public.missions where id = p_mission_id for update;
    if not found or m.player_id <> x.accused_player_id then
      perform public._raise('Selecciona una misión del jugador acusado.');
    end if;
    if m.status = 'validated' then perform public._raise('Esa misión ya se había completado y validado: no puede descubrirse.'); end if;
    if m.status = 'discovered' then perform public._raise('Esa misión ya fue descubierta.'); end if;
    select team_id, name into v_team, v_name from public.players where id = x.accuser_player_id;
    if v_team is null then perform public._raise('El acusador no tiene equipo.'); end if;
    v_disc_points := coalesce((v.config ->> 'discovery_points')::int, 5);

    update public.missions set status = 'discovered', judge_note = 'Descubierta por otro jugador' where id = m.id;
    update public.mission_discoveries set status = 'correct', mission_id = m.id, resolved_at = now(),
      resolved_by = auth.uid(), judge_note = nullif(btrim(p_note), '') where id = x.id;
    perform public._award(v_team, v_disc_points, format('Misión descubierta por %s', v_name),
      v.id, x.accuser_player_id, 'discovery', 'discovery:' || m.id::text);
    perform public._bump('scores');
  else
    update public.mission_discoveries set status = 'incorrect', resolved_at = now(), resolved_by = auth.uid(),
      judge_note = nullif(btrim(p_note), '') where id = x.id;
  end if;
  perform public._bump('missions');
end $$;

-- =============================================================================
-- JUEZ · PANEL Y CLASIFICACIÓN
-- =============================================================================
create or replace function public.admin_get_standings()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'teams', (select coalesce(jsonb_agg(jsonb_build_object('team_id', s.team_id, 'name', s.name, 'color', s.color,
                'points', s.points, 'rank', s.rank, 'players_count', s.players_count) order by s.rank, s.sort_order), '[]'::jsonb)
              from public._standings() s),
    'last_update', public._last_score_at());
end $$;

create or replace function public.admin_get_dashboard()
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform public.assert_admin();
  return jsonb_build_object(
    'players', (select count(*) from public.players),
    'players_unassigned', (select count(*) from public.players where team_id is null),
    'teams', (select count(*) from public.teams),
    'challenges', (select jsonb_object_agg(status, n) from (select status, count(*) n from public.challenges group by status) s),
    'duels_active', (select count(*) from public.duels where status = 'in_progress'),
    'missions_pending', (select count(*) from public.missions where status = 'claimed'),
    'discoveries_pending', (select count(*) from public.mission_discoveries where status = 'pending'),
    'recent_events', (select coalesce(jsonb_agg(row_to_json(e)), '[]'::jsonb) from (
        select se.id, se.points, se.reason, se.created_at, se.source_type, t.name team_name, t.color team_color
        from public.score_events se join public.teams t on t.id = se.team_id
        order by se.created_at desc limit 8) e)
  );
end $$;

-- =============================================================================
-- PANTALLA TV
-- =============================================================================
create or replace function public.admin_set_tv_mode(p_mode text)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if p_mode not in ('leaderboard', 'leaderboard_no_scores', 'waiting', 'final_results', 'champion') then
    perform public._raise('Modo no válido.');
  end if;
  if p_mode in ('final_results', 'champion')
     and (select winner_revealed_at from public.competition_settings where id = 1) is null then
    perform public._raise('Usa «REVELAR GANADOR» para mostrar los resultados finales.');
  end if;
  update public.tv_settings set mode = p_mode where id = 1;
  perform public._bump('tv');
end $$;

create or replace function public.admin_reveal_winner()
returns void language plpgsql security definer set search_path = public as $$
begin
  perform public.assert_admin();
  if (select status from public.competition_settings where id = 1) <> 'finished' then
    perform public._raise('Finaliza la competición antes de revelar al ganador.');
  end if;
  update public.competition_settings set winner_revealed_at = now() where id = 1;
  update public.tv_settings set mode = 'champion' where id = 1;
  perform public._bump('tv');
  perform public._bump('settings');
end $$;

create or replace function public.admin_rotate_tv_key()
returns text language plpgsql security definer set search_path = public as $$
declare v_key text := encode(gen_random_bytes(18), 'hex');
begin
  perform public.assert_admin();
  update public.tv_settings set access_key = v_key where id = 1;
  return v_key;
end $$;

-- Datos para /tv. Solo con la clave de TV; devuelve exclusivamente lo
-- necesario para el modo activo (nunca misiones ni detalles internos).
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
                         'paused_remaining_ms', sp.paused_remaining_ms, 'duration_seconds', sp.duration_seconds) end,
    'server_now', now()
  );
end $$;

create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now(); $$;

-- =============================================================================
-- PRIVILEGIOS DE EJECUCIÓN
-- =============================================================================
revoke all on all functions in schema public from public, anon, authenticated;

-- Necesarias para evaluar políticas RLS
grant execute on function public.is_admin(), public.current_player_id(), public.current_team_id(),
  public.is_participant() to authenticated;

-- Anónimo (pantalla TV) y cualquiera
grant execute on function public.get_tv_state(text), public.server_now() to anon, authenticated;

-- Jugadores (sesión anónima de Supabase => rol authenticated)
grant execute on function
  public.join_competition(text, text, text),
  public.claim_player(text, text),
  public.touch_session(),
  public.get_my_state(),
  public.get_player_modalities(),
  public.claim_mission(uuid, text),
  public.accuse_player(uuid, text),
  public.get_revealed_missions()
to authenticated;

-- Juez (cada función valida is_admin() internamente)
grant execute on function
  public.admin_create_player(text, uuid),
  public.admin_reset_player_access(uuid),
  public.admin_set_challenge_status(uuid, text),
  public.admin_update_challenge_config(uuid, jsonb),
  public.admin_set_competition_status(text),
  public.admin_regenerate_invite_code(),
  public.admin_adjust_score(uuid, int, text, uuid, uuid),
  public.admin_revert_score_event(uuid, text),
  public.admin_crash_setup(text[]),
  public.admin_crash_set_lineup(uuid, uuid[]),
  public.admin_crash_set_race_status(uuid, text),
  public.admin_crash_record_race(uuid, jsonb, boolean),
  public.admin_crash_reset_training(),
  public.admin_overcooked_save_score(uuid, int, boolean, text),
  public.admin_overcooked_delete_score(uuid, boolean),
  public.admin_overcooked_confirm(boolean),
  public.admin_spaghetti_set_reference(text, boolean),
  public.admin_spaghetti_set_visible(boolean),
  public.admin_spaghetti_timer(text, int),
  public.admin_spaghetti_confirm(jsonb, boolean),
  public.admin_create_duel(uuid, text, uuid[], text),
  public.admin_finish_duel(uuid, jsonb, boolean),
  public.admin_cancel_duel(uuid, text),
  public.admin_void_duel(uuid, text),
  public.admin_create_mission(uuid, text, int),
  public.admin_update_mission(uuid, text, int),
  public.admin_delete_mission(uuid),
  public.admin_review_mission(uuid, boolean, text),
  public.admin_resolve_discovery(uuid, boolean, uuid, text),
  public.admin_get_standings(),
  public.admin_get_dashboard(),
  public.admin_set_tv_mode(text),
  public.admin_reveal_winner(),
  public.admin_rotate_tv_key()
to authenticated;
