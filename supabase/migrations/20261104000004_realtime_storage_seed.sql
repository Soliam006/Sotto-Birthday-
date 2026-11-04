-- =============================================================================
-- BIRTHDAY CUP · 0004 · Realtime, Storage y datos iniciales
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Señales en directo: cualquier cambio en una tabla incrementa su "tema"
-- -----------------------------------------------------------------------------
create or replace function public.tg_bump_signal()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public._bump(tg_argv[0]);
  return null;
end $$;

do $$
declare r record;
begin
  for r in select * from (values
      ('teams', 'teams'), ('players', 'players'), ('player_sessions', 'players'),
      ('competition_settings', 'settings'), ('tv_settings', 'tv'),
      ('challenges', 'challenges'), ('crash_races', 'challenges'), ('crash_lineups', 'challenges'),
      ('crash_race_results', 'challenges'), ('overcooked_results', 'challenges'),
      ('spaghetti_results', 'challenges'), ('duel_games', 'challenges'),
      ('spaghetti_state', 'spaghetti'), ('duels', 'duels'), ('duel_players', 'duels'),
      ('missions', 'missions'), ('mission_discoveries', 'missions'), ('score_events', 'scores')
    ) as t(tbl, topic) loop
    execute format('create trigger trg_signal_%1$s after insert or update or delete on public.%1$I
                    for each statement execute function public.tg_bump_signal(%2$L)', r.tbl, r.topic);
  end loop;
end $$;

insert into public.live_signals (topic) values
  ('teams'), ('players'), ('settings'), ('tv'), ('challenges'), ('spaghetti'),
  ('duels'), ('missions'), ('scores')
on conflict do nothing;

-- Publicación de Realtime (existe en Supabase; se ignora si no)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.live_signals;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Storage: bucket público "references" para la imagen de Spaghetti.
-- Lectura pública (nombre de archivo aleatorio, solo se comunica cuando el
-- juez la muestra); escritura exclusiva del juez.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
    values ('references', 'references', true, 10485760,
            array['image/png', 'image/jpeg', 'image/webp', 'image/gif'])
    on conflict (id) do nothing;

    execute $p$create policy "references_admin_insert" on storage.objects for insert to authenticated
      with check (bucket_id = 'references' and public.is_admin())$p$;
    execute $p$create policy "references_admin_update" on storage.objects for update to authenticated
      using (bucket_id = 'references' and public.is_admin())$p$;
    execute $p$create policy "references_admin_delete" on storage.objects for delete to authenticated
      using (bucket_id = 'references' and public.is_admin())$p$;
    execute $p$create policy "references_admin_select" on storage.objects for select to authenticated
      using (bucket_id = 'references' and public.is_admin())$p$;
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Datos iniciales imprescindibles (no son datos de prueba)
-- -----------------------------------------------------------------------------
insert into public.competition_settings (id) values (1) on conflict do nothing;
insert into public.tv_settings (id) values (1) on conflict do nothing;
insert into public.spaghetti_state (id) values (1) on conflict do nothing;

insert into public.teams (name, color, sort_order) values
  ('Equipo Rojo', '#EF4444', 1),
  ('Equipo Azul', '#3B82F6', 2),
  ('Equipo Verde', '#22C55E', 3),
  ('Equipo Naranja', '#F97316', 4)
on conflict do nothing;

insert into public.duel_games (name, sort_order) values
  ('Ajedrez', 1), ('Molino', 2), ('Damas', 3), ('Damas chinas Diamond', 4)
on conflict do nothing;

insert into public.challenges (kind, name, tagline, description, rules, sort_order, config) values
(
  'crash', 'Crash Team Racing Nitro-Fueled', 'Torneo de carreras',
  'Torneo de carreras por relevos: cada equipo elige un piloto distinto para cada carrera.',
  E'• Cada equipo presenta tantos pilotos como carreras tenga el torneo y fija su orden.\n'
  '• Los bots no cuentan: solo importa la posición entre los jugadores humanos.\n'
  '• Puntos por carrera: 1º humano 20 · 2º 15 · 3º 10 · 4º 5.\n'
  '• La carrera de entrenamiento no da puntos.',
  1, '{"race_count": 0, "points": [20, 15, 10, 5]}'
),
(
  'overcooked', 'Overcooked', 'Competición por puntuación',
  'Cada equipo juega una partida oficial en el mismo nivel y con las mismas condiciones.',
  E'• Todos los equipos juegan el mismo nivel y con el mismo número de cocineros.\n'
  '• Hay una partida de entrenamiento que no puntúa.\n'
  '• Clasificación por puntuación final: 1º 40 · 2º 30 · 3º 20 · 4º 10.\n'
  '• Los empates reciben los puntos de su posición.',
  2, '{"points": [40, 30, 20, 10], "level": "", "conditions": "", "players_per_team": 2}'
),
(
  'duels', 'Duelos', 'Enfrentamientos de mesa',
  'Retos entre jugadores de distintos equipos en juegos de mesa. Avisa al juez ANTES de empezar.',
  E'• El juez registra el duelo antes de empezar: si no está registrado, no puntúa.\n'
  '• 1 contra 1 (equipos distintos): el ganador suma 15 puntos.\n'
  '• Multijugador (3 o más): 1º 15 · 2º 8 · resto 0.\n'
  '• Máximo 3 duelos puntuables por jugador.',
  3, '{"points_1v1": 15, "points_multi": [15, 8], "limit_per_player": 3}'
),
(
  'missions', 'Misiones secretas', 'Retos individuales',
  'Cada jugador recibe misiones secretas. ¡Que no te descubran!',
  E'• Tus misiones son secretas: solo tú y el juez las conocéis.\n'
  '• Cada misión validada suma 5 puntos a tu equipo.\n'
  '• Si sospechas que alguien de otro equipo está haciendo una misión, acúsale: si aciertas, tu equipo suma 5 puntos.\n'
  '• Una misión ya completada y validada no puede descubrirse.',
  4, '{"reward_default": 5, "discovery_points": 5, "limit_per_player": 3}'
),
(
  'spaghetti', 'Spaghetti & Marshmallow', 'Desafío de construcción',
  'Reproducid la estructura de la imagen de referencia con espaguetis y nubes en 30 minutos.',
  E'• Todos los equipos tienen los mismos materiales.\n'
  '• El cronómetro es común y lo controla el juez.\n'
  '• Al terminar el tiempo, ¡manos fuera de la estructura!\n'
  '• Clasificación del juez: 1º 50 · 2º 35 · 3º 20 · 4º 10.',
  5, '{"points": [50, 35, 20, 10], "duration_minutes": 30}'
)
on conflict (kind) do nothing;
