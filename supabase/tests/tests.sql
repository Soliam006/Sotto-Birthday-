-- =============================================================================
-- Pruebas de integración de la base de datos (PostgreSQL local + stub).
-- Ejecutar con supabase/tests/run_local.sh. Cada bloque falla con una
-- excepción si el comportamiento no es el esperado.
-- =============================================================================
\set ON_ERROR_STOP 1
set client_min_messages = warning;

-- Utilidades -------------------------------------------------------------------
create or replace function pg_temp.login(p_uid uuid) returns void language plpgsql as $$
begin
  perform set_config('request.jwt.claim.sub', coalesce(p_uid::text, ''), false);
end $$;

create or replace function pg_temp.expect_error(p_sql text, p_like text) returns void language plpgsql as $$
begin
  begin
    execute p_sql;
  exception when others then
    if sqlerrm not ilike '%' || p_like || '%' then
      raise exception 'Error inesperado en [%]: % (se esperaba ~ %)', p_sql, sqlerrm, p_like;
    end if;
    return;
  end;
  raise exception 'Se esperaba error en [%] (~ %)', p_sql, p_like;
end $$;

create or replace function pg_temp.assert(p_cond boolean, p_msg text) returns void language plpgsql as $$
begin
  if not coalesce(p_cond, false) then raise exception 'ASSERT FALLIDO: %', p_msg; end if;
end $$;

grant execute on all functions in schema pg_temp to anon, authenticated;

-- Identidades -------------------------------------------------------------------
insert into auth.users (id, email) values ('00000000-0000-0000-0000-0000000000a1', 'juez@example.com');
insert into auth.users (id, is_anonymous)
select ('00000000-0000-0000-0000-00000000000' || i)::uuid, true from generate_series(1, 9) i;
insert into public.admins (user_id) values ('00000000-0000-0000-0000-0000000000a1');

select invite_code as invite from public.competition_settings \gset
select access_key as tvkey from public.tv_settings \gset
select id as red from public.teams where name = 'Equipo Rojo' \gset
select id as blue from public.teams where name = 'Equipo Azul' \gset
select id as green from public.teams where name = 'Equipo Verde' \gset
select id as orange from public.teams where name = 'Equipo Naranja' \gset

-- 1. Acceso de jugadores ---------------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error($$select public.join_competition('XXXXXX', 'Ana')$$, 'código de invitación');
select public.join_competition(:'invite', 'Ana');
select pg_temp.assert((public.join_competition(:'invite', 'Ana') ->> 'existing')::boolean, 'join idempotente');
select pg_temp.login('00000000-0000-0000-0000-000000000002');
select pg_temp.expect_error(format($$select public.join_competition(%L, 'ana')$$, :'invite'), 'Ya existe');
select public.join_competition(:'invite', 'Bruno');
select pg_temp.login('00000000-0000-0000-0000-000000000003');
select public.join_competition(:'invite', 'Carla');
select pg_temp.login('00000000-0000-0000-0000-000000000004');
select public.join_competition(:'invite', 'Dani');
select pg_temp.login('00000000-0000-0000-0000-000000000005');
select public.join_competition(:'invite', 'Elena');
select pg_temp.login('00000000-0000-0000-0000-000000000006');
select public.join_competition(:'invite', 'Fede');

-- Un jugador no puede usar funciones del juez
select pg_temp.expect_error($$select public.admin_create_player('Hacker')$$, 'reservada al juez');
select pg_temp.expect_error($$select public.admin_adjust_score(null, 100, 'trampa')$$, 'reservada al juez');
reset role;

-- El update anterior no debe haber afectado a nada (RLS) -> comprobamos con un update real
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
do $$
declare n int;
begin
  update public.players set name = 'HACK' where true;
  get diagnostics n = row_count;
  perform pg_temp.assert(n = 0, 'un jugador no puede modificar jugadores');
end $$;
reset role;

-- 2. Juez: asignación de equipos ---------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.players set team_id = :'red'    where name in ('Ana', 'Bruno');
update public.players set team_id = :'blue'   where name in ('Carla', 'Dani');
update public.players set team_id = :'green'  where name in ('Elena');
update public.players set team_id = :'orange' where name in ('Fede');
select public.admin_create_player('Gabi', :'green') as gabi \gset
select id as ana from public.players where name = 'Ana' \gset
select id as bruno from public.players where name = 'Bruno' \gset
select id as carla from public.players where name = 'Carla' \gset
select id as dani from public.players where name = 'Dani' \gset
select id as elena from public.players where name = 'Elena' \gset
select id as fede from public.players where name = 'Fede' \gset
select code as gabicode from public.player_access_codes where player_id = :'gabi' \gset
select pg_temp.assert((select count(*) from public.teams) = 4, 'juez ve equipos');
select pg_temp.expect_error($$insert into public.teams (name, color) values ('E5','#111111'),('E6','#222222'),('E7','#333333')$$, 'más de 6');
reset role;

-- Código personal: Gabi entra desde un dispositivo, el código rota
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000007');
select public.claim_player(:'gabicode');
select pg_temp.assert((public.get_my_state() -> 'player' ->> 'name') = 'Gabi', 'gabi vinculada');
select pg_temp.login('00000000-0000-0000-0000-000000000008');
select pg_temp.expect_error(format($$select public.claim_player(%L)$$, :'gabicode'), 'no válido');
reset role;

-- 3. Privacidad del jugador ----------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.assert((select count(*) from public.score_events) = 0, 'jugador no ve score_events');
select pg_temp.assert((select count(*) from public.competition_settings) = 0, 'jugador no ve settings');
select pg_temp.assert((select count(*) from public.player_access_codes) = 0, 'jugador no ve códigos');
select pg_temp.assert((select count(*) from public.player_sessions) = 1, 'jugador ve solo su sesión');
select pg_temp.assert((public.get_my_state() -> 'leaderboard') = 'null'::jsonb, 'clasificación oculta');
select pg_temp.assert((public.get_my_state() -> 'team' ->> 'name') = 'Equipo Rojo', 'equipo de Ana');
select pg_temp.expect_error($$select public.get_tv_state('mala')$$, 'Clave de pantalla');
reset role;

-- Usuario anónimo sin vincular: no ve jugadores
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000009');
select pg_temp.assert((select count(*) from public.players) = 0, 'no vinculado no ve jugadores');
reset role;

-- 4. Duelos ---------------------------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select id as chess from public.duel_games where name = 'Ajedrez' \gset
select id as duels_ch from public.challenges where kind = 'duels' \gset
select pg_temp.expect_error(format($$select public.admin_create_duel(%L, '1v1', array[%L,%L]::uuid[])$$, :'chess', :'ana', :'carla'), 'no está en curso');
select public.admin_set_challenge_status(:'duels_ch', 'in_progress');
select pg_temp.expect_error(format($$select public.admin_create_duel(%L, '1v1', array[%L,%L]::uuid[])$$, :'chess', :'ana', :'bruno'), 'equipos diferentes');
select pg_temp.expect_error(format($$select public.admin_create_duel(%L, '1v1', array[%L,%L]::uuid[])$$, :'chess', :'ana', :'ana'), 'duplicados');
select pg_temp.expect_error(format($$select public.admin_create_duel(%L, 'multi', array[%L,%L]::uuid[])$$, :'chess', :'ana', :'carla'), '3 o más');
select public.admin_create_duel(:'chess', '1v1', array[:'ana', :'carla']::uuid[]) as duel1 \gset
select pg_temp.assert(
  (public.admin_finish_duel(:'duel1', jsonb_build_array(jsonb_build_object('player_id', :'ana', 'position', 1),
                                                    jsonb_build_object('player_id', :'carla', 'position', 2)), true)
   -> 'results' -> 0 ->> 'points')::int = 15, 'preview 1v1 = 15');
select pg_temp.assert((select count(*) from public.score_events) = 0, 'dry run no escribe');
select public.admin_finish_duel(:'duel1', jsonb_build_array(jsonb_build_object('player_id', :'ana', 'position', 1),
                                                       jsonb_build_object('player_id', :'carla', 'position', 2)));
select pg_temp.expect_error(format($$select public.admin_finish_duel(%L, '[]'::jsonb)$$, :'duel1'), 'ya no está en curso');
select pg_temp.assert((select sum(points) from public.score_events where team_id = :'red') = 15, 'rojo 15');

-- Multijugador con empate en 2º puesto
select public.admin_create_duel(:'chess', 'multi', array[:'bruno', :'dani', :'elena', :'fede']::uuid[]) as duel2 \gset
select pg_temp.expect_error(format($$select public.admin_finish_duel(%L, %L::jsonb)$$, :'duel2',
  jsonb_build_array(jsonb_build_object('player_id', :'bruno', 'position', 1), jsonb_build_object('player_id', :'dani', 'position', 3),
                    jsonb_build_object('player_id', :'elena', 'position', 3), jsonb_build_object('player_id', :'fede', 'position', 4))), 'Posiciones no válidas');
select public.admin_finish_duel(:'duel2',
  jsonb_build_array(jsonb_build_object('player_id', :'bruno', 'position', 1), jsonb_build_object('player_id', :'dani', 'position', 2),
                    jsonb_build_object('player_id', :'elena', 'position', 2), jsonb_build_object('player_id', :'fede', 'position', 4)));
select pg_temp.assert((select sum(points) from public.score_events where team_id = :'red') = 30, 'rojo 30');
select pg_temp.assert((select sum(points) from public.score_events where team_id = :'blue') = 8, 'azul 8');
select pg_temp.assert((select sum(points) from public.score_events where team_id = :'green') = 8, 'verde 8');

-- Límite de duelos por jugador (3)
select public.admin_update_challenge_config(:'duels_ch', '{"limit_per_player": 2}');
select public.admin_create_duel(:'chess', '1v1', array[:'ana', :'fede']::uuid[]) as duel3 \gset
select pg_temp.expect_error(format($$select public.admin_create_duel(%L, '1v1', array[%L,%L]::uuid[])$$, :'chess', :'ana', :'elena'), 'Límite');
select public.admin_cancel_duel(:'duel3');
select public.admin_create_duel(:'chess', '1v1', array[:'ana', :'elena']::uuid[]) as duel4 \gset
select public.admin_cancel_duel(:'duel4');

-- Anulación con movimiento compensatorio
select public.admin_void_duel(:'duel1', 'Error del juez');
select pg_temp.assert((select sum(points) from public.score_events where team_id = :'red') = 15, 'rojo 15 tras anular');
select pg_temp.assert((select count(*) from public.score_events where source_type = 'void') = 1, 'movimiento void');
reset role;

-- Inmutabilidad del historial (incluso para el propietario)
select pg_temp.expect_error($$update public.score_events set points = 999$$, 'inmutable');
select pg_temp.expect_error($$delete from public.score_events$$, 'inmutable');

-- 5. Crash Team Racing ------------------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select id as crash_ch from public.challenges where kind = 'crash' \gset
select pg_temp.expect_error(format($$select public.admin_set_challenge_status(%L, 'in_progress')$$, :'crash_ch'), 'Configura las carreras');
select public.admin_crash_setup(array['Circuito Crash', 'Cañón Coco']);
select pg_temp.assert((select count(*) from public.crash_races) = 3, '2 oficiales + entrenamiento');
select pg_temp.expect_error(format($$select public.admin_set_challenge_status(%L, 'in_progress')$$, :'crash_ch'), 'exactamente 2 pilotos');
select public.admin_crash_set_lineup(:'red', array[:'ana', :'bruno']::uuid[]);
select public.admin_crash_set_lineup(:'blue', array[:'carla', :'dani']::uuid[]);
select public.admin_crash_set_lineup(:'green', array[:'elena', :'gabi']::uuid[]);
select pg_temp.expect_error(format($$select public.admin_crash_set_lineup(%L, array[%L]::uuid[])$$, :'orange', :'fede'), 'exactamente 2');
select public.admin_crash_set_lineup(:'orange', array[:'fede', :'fede']::uuid[]);  -- equipo de 1 => repite piloto
select pg_temp.expect_error(format($$select public.admin_crash_set_lineup(%L, array[%L,%L]::uuid[])$$, :'red', :'ana', :'ana'), 'distinto');
select public.admin_set_challenge_status(:'crash_ch', 'in_progress');
select id as race1 from public.crash_races where race_number = 1 \gset
select id as training from public.crash_races where race_number = 0 \gset
-- Entrenamiento: no puntúa
select public.admin_crash_record_race(:'training', jsonb_build_array(
  jsonb_build_object('player_id', :'ana', 'raw_position', 1), jsonb_build_object('player_id', :'carla', 'raw_position', 2)));
select pg_temp.assert((select count(*) from public.score_events where source_type = 'crash') = 0, 'entrenamiento sin puntos');
-- Carrera 1: bots en 1º, 2º y 4º puesto
select pg_temp.expect_error(format($$select public.admin_crash_record_race(%L, %L::jsonb)$$, :'race1',
  jsonb_build_array(jsonb_build_object('player_id', :'ana', 'raw_position', 3), jsonb_build_object('player_id', :'carla', 'raw_position', 5))), 'Falta el resultado');
select public.admin_crash_record_race(:'race1', jsonb_build_array(
  jsonb_build_object('player_id', :'ana', 'raw_position', 6),
  jsonb_build_object('player_id', :'carla', 'raw_position', 3),
  jsonb_build_object('player_id', :'elena', 'raw_position', 5),
  jsonb_build_object('player_id', :'fede', 'raw_position', 8)));
select pg_temp.assert((select human_position from public.crash_race_results where race_id = :'race1' and player_id = :'carla') = 1, 'carla 1ª humana');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'crash' and team_id = :'blue') = 20, 'azul +20');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'crash' and team_id = :'orange') = 5, 'naranja +5');
select pg_temp.expect_error(format($$select public.admin_crash_record_race(%L, '[]'::jsonb)$$, :'race1'), 'ya tiene resultado');
select pg_temp.expect_error(format($$select public.admin_set_challenge_status(%L, 'finished')$$, :'crash_ch'), 'sin resultado');
reset role;

-- 6. Misiones -------------------------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select id as missions_ch from public.challenges where kind = 'missions' \gset
select public.admin_create_mission(:'ana', 'Conseguir que alguien cante') as m1 \gset
select public.admin_create_mission(:'ana', 'Chocar los cinco con tres personas') as m2 \gset
select public.admin_create_mission(:'carla', 'Que alguien cuente una anécdota') as m3 \gset
select public.admin_create_mission(:'ana', 'Tercera misión');
select pg_temp.expect_error(format($$select public.admin_create_mission(%L, 'Cuarta misión')$$, :'ana'), 'máximo');
select public.admin_set_challenge_status(:'missions_ch', 'in_progress');
reset role;

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000003'); -- Carla
select pg_temp.assert((select count(*) from public.missions) = 1, 'carla solo ve su misión');
select pg_temp.assert((select count(*) from public.missions where player_id = :'ana') = 0, 'carla no ve misiones de Ana');
select pg_temp.expect_error(format($$select public.claim_mission(%L, 'la hice')$$, :'m1'), 'no encontrada');
select public.claim_mission(:'m3', 'Le pregunté por su viaje');
-- Carla acusa a Ana
select public.accuse_player(:'ana', 'Creo que intenta que alguien cante');
select pg_temp.expect_error(format($$select public.accuse_player(%L, 'otra vez')$$, :'ana'), 'pendiente');
select pg_temp.expect_error(format($$select public.accuse_player(%L, 'compañero')$$, :'dani'), 'otros equipos');
select pg_temp.assert(public.get_revealed_missions() is null, 'misiones no reveladas');
reset role;

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001'); -- Ana
select pg_temp.assert((select count(*) from public.missions) = 3, 'ana ve sus 3 misiones');
select pg_temp.assert((select count(*) from public.mission_discoveries) = 0, 'ana no ve acusaciones contra ella');
select public.claim_mission(:'m2', 'Choqué con Bruno, Dani y Elena');
reset role;

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.admin_review_mission(:'m2', true);
select pg_temp.expect_error(format($$select public.admin_review_mission(%L, true)$$, :'m2'), 'no está pendiente');
select public.admin_review_mission(:'m3', false, 'No vale, fue tu madre');
select id as disc from public.mission_discoveries limit 1 \gset
select pg_temp.expect_error(format($$select public.admin_resolve_discovery(%L, true, %L)$$, :'disc', :'m2'), 'no puede descubrirse');
select public.admin_resolve_discovery(:'disc', true, :'m1');
select pg_temp.assert((select status from public.missions where id = :'m1') = 'discovered', 'm1 descubierta');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'discovery' and team_id = :'blue') = 5, 'azul +5 descubrimiento');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'mission' and team_id = :'red') = 5, 'rojo +5 misión');
reset role;

-- Ana no puede reclamar una misión descubierta
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.expect_error(format($$select public.claim_mission(%L, 'la hice')$$, :'m1'), 'ya no se puede');
reset role;

-- 7. Overcooked con empate ------------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select id as oc_ch from public.challenges where kind = 'overcooked' \gset
select public.admin_overcooked_save_score(:'red', 50, true);  -- entrenamiento permitido aunque no esté en curso
select public.admin_set_challenge_status(:'oc_ch', 'in_progress');
select public.admin_overcooked_save_score(:'red', 300);
select public.admin_overcooked_save_score(:'blue', 300);
select public.admin_overcooked_save_score(:'green', 120);
select pg_temp.expect_error($$select public.admin_overcooked_confirm()$$, 'Falta la puntuación');
select public.admin_overcooked_save_score(:'orange', 80);
select pg_temp.expect_error(format($$select public.admin_set_challenge_status(%L, 'finished')$$, :'oc_ch'), 'Confirma');
select public.admin_overcooked_confirm();
select pg_temp.expect_error($$select public.admin_overcooked_confirm()$$, 'ya estaban confirmados');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'overcooked' and team_id = :'red') = 40, 'rojo 40 empate');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'overcooked' and team_id = :'blue') = 40, 'azul 40 empate');
select pg_temp.assert((select sum(points) from public.score_events where source_type = 'overcooked' and team_id = :'green') = 20, 'verde 3º = 20');
select public.admin_set_challenge_status(:'oc_ch', 'finished');
reset role;

-- 8. Spaghetti: cronómetro en servidor -------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select pg_temp.expect_error($$select public.admin_spaghetti_set_visible(true)$$, 'Sube primero');
select public.admin_spaghetti_set_reference('spaghetti/abc123.png', false);
select public.admin_spaghetti_timer('start');
select pg_temp.assert((select timer_status from public.spaghetti_state) = 'running', 'cronómetro en marcha');
select pg_temp.assert((select status from public.challenges where kind = 'spaghetti') = 'in_progress', 'spaghetti en curso');
select pg_temp.assert((select ends_at - started_at from public.spaghetti_state) = interval '30 minutes', '30 minutos');
select public.admin_spaghetti_timer('pause');
select pg_temp.assert((select paused_remaining_ms from public.spaghetti_state) > 1790000, 'pausa conserva el tiempo');
select public.admin_spaghetti_timer('resume');
select pg_temp.expect_error($$select public.admin_spaghetti_confirm('[]'::jsonb)$$, 'Finaliza el cronómetro');
select public.admin_spaghetti_timer('finish');
select pg_temp.assert(
  (public.admin_spaghetti_confirm(jsonb_build_array(
     jsonb_build_object('team_id', :'green', 'position', 1), jsonb_build_object('team_id', :'red', 'position', 2),
     jsonb_build_object('team_id', :'blue', 'position', 3), jsonb_build_object('team_id', :'orange', 'position', 4)), true)
   -> 'results' -> 0 ->> 'points')::int = 50, 'preview spaghetti');
reset role;

-- Jugador: no ve la imagen hasta que el juez la muestra
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.assert((public.get_player_modalities() -> 'spaghetti' ->> 'reference_image_path') is null, 'imagen oculta');
reset role;

-- 9. Visibilidad y TV -----------------------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
update public.competition_settings set scores_visible = true;
select public.admin_set_tv_mode('leaderboard_no_scores');
select pg_temp.expect_error($$select public.admin_set_tv_mode('champion')$$, 'REVELAR GANADOR');
select pg_temp.expect_error($$select public.admin_reveal_winner()$$, 'Finaliza la competición');
reset role;

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-000000000001');
select pg_temp.assert(jsonb_array_length(public.get_my_state() -> 'leaderboard') = 4, 'clasificación visible');
select pg_temp.assert((public.get_my_state() -> 'leaderboard' -> 0 ->> 'points') is not null, 'con puntos');
reset role;

set role anon;
select pg_temp.assert((public.get_tv_state(:'tvkey') -> 'teams' -> 0 ->> 'points') is null, 'tv sin puntos');
select pg_temp.assert((public.get_tv_state(:'tvkey') -> 'teams' -> 0 ->> 'rank') is not null, 'tv con orden');
select pg_temp.expect_error($$select count(*) from public.teams$$, 'permission denied');
select pg_temp.expect_error($$select public.get_my_state()$$, 'permission denied');
reset role;

set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select public.admin_set_competition_status('finished');
select pg_temp.expect_error(format($$select public.admin_adjust_score(%L, 5, 'tarde')$$, :'red'), 'ha finalizado');
select public.admin_reveal_winner();
reset role;

set role anon;
select pg_temp.assert((public.get_tv_state(:'tvkey') ->> 'mode') = 'champion', 'tv campeón');
select pg_temp.assert((public.get_tv_state(:'tvkey') -> 'teams' -> 0 ->> 'points') is not null, 'tv campeón con puntos');
reset role;

-- 10. Coherencia de la clasificación -------------------------------------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select pg_temp.assert(
  (select sum((t ->> 'points')::int) from jsonb_array_elements(public.admin_get_standings() -> 'teams') t)
  = (select sum(points) from public.score_events), 'total = suma de movimientos');
reset role;

-- 11. Rotación de la clave de TV (sin pgcrypto en el search_path) ------------
set role authenticated;
select pg_temp.login('00000000-0000-0000-0000-0000000000a1');
select pg_temp.assert(public.admin_rotate_tv_key() ~ '^[0-9a-f]{64}$', 'nueva clave TV de 64 hex');
select pg_temp.assert(public.admin_regenerate_invite_code() ~ '^[A-Z2-9]{6}$', 'nuevo código de invitación');
reset role;
set role anon;
select pg_temp.expect_error(format($$select public.get_tv_state(%L)$$, :'tvkey'), 'Clave de pantalla');
reset role;

select 'TODAS LAS PRUEBAS SUPERADAS' as resultado;
