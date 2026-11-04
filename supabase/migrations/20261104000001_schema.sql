-- =============================================================================
-- BIRTHDAY CUP · 0001 · Esquema relacional
-- =============================================================================
-- Todas las tablas viven en el esquema public. Las escrituras sensibles se
-- realizan exclusivamente mediante funciones SECURITY DEFINER (ver 0003) que
-- validan el rol del llamante. Las políticas RLS se definen en 0002.
-- =============================================================================

create extension if not exists pgcrypto;

-- -----------------------------------------------------------------------------
-- Utilidades
-- -----------------------------------------------------------------------------
create or replace function public.tg_set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- -----------------------------------------------------------------------------
-- Administradores (jueces). Se vinculan a auth.users (login email/contraseña).
-- -----------------------------------------------------------------------------
create table public.admins (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  display_name text not null default 'Juez',
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Configuración global (fila única id = 1)
-- -----------------------------------------------------------------------------
create table public.competition_settings (
  id                 smallint primary key default 1 check (id = 1),
  name               text not null default 'BIRTHDAY CUP',
  subtitle           text not null default '',
  status             text not null default 'setup'
                     check (status in ('setup', 'running', 'finished')),
  invite_code        text not null default upper(substr(md5(gen_random_uuid()::text), 1, 6)),
  registration_open  boolean not null default true,
  scores_visible     boolean not null default false,
  missions_revealed  boolean not null default false,
  winner_revealed_at timestamptz,
  finished_at        timestamptz,
  updated_at         timestamptz not null default now(),
  constraint invite_code_format check (invite_code ~ '^[A-Z0-9]{4,12}$')
);
create trigger trg_settings_updated before update on public.competition_settings
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Pantalla TV (fila única id = 1)
-- -----------------------------------------------------------------------------
create table public.tv_settings (
  id            smallint primary key default 1 check (id = 1),
  mode          text not null default 'waiting'
                check (mode in ('leaderboard', 'leaderboard_no_scores', 'waiting',
                                'final_results', 'champion')),
  message       text not null default '¡La competición está a punto de empezar!',
  show_timer    boolean not null default true,
  -- Clave de solo lectura que se incluye en la URL /tv?key=...
  access_key    text not null default encode(gen_random_bytes(18), 'hex'),
  updated_at    timestamptz not null default now()
);
create trigger trg_tv_updated before update on public.tv_settings
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- Equipos (2 a 6)
-- -----------------------------------------------------------------------------
create table public.teams (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  color      text not null check (color ~ '^#[0-9A-Fa-f]{6}$'),
  sort_order int  not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index teams_name_uq on public.teams (lower(btrim(name)));
create unique index teams_color_uq on public.teams (lower(color));
create trigger trg_teams_updated before update on public.teams
  for each row execute function public.tg_set_updated_at();

create or replace function public.tg_teams_max()
returns trigger language plpgsql as $$
begin
  if (select count(*) from public.teams) >= 6 then
    raise exception 'No se pueden crear más de 6 equipos.' using errcode = 'P0001';
  end if;
  return new;
end $$;
create trigger trg_teams_max before insert on public.teams
  for each row execute function public.tg_teams_max();

-- -----------------------------------------------------------------------------
-- Participantes
-- -----------------------------------------------------------------------------
create table public.players (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 40),
  team_id    uuid references public.teams(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index players_name_uq on public.players (lower(btrim(name)));
create index players_team_idx on public.players (team_id);
create trigger trg_players_updated before update on public.players
  for each row execute function public.tg_set_updated_at();

-- Código personal de acceso (solo visible para el juez). Permite recuperar
-- la identidad desde otro dispositivo mediante un QR individual.
create table public.player_access_codes (
  player_id  uuid primary key references public.players(id) on delete cascade,
  code       text not null unique check (code ~ '^[A-Z0-9]{8}$'),
  created_at timestamptz not null default now()
);

-- Sesiones: vínculo entre una sesión de Supabase Auth (anónima) y un jugador.
create table public.player_sessions (
  id           uuid primary key default gen_random_uuid(),
  player_id    uuid not null references public.players(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  method       text not null check (method in ('invite', 'personal_code')),
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  revoked_at   timestamptz,
  revoked_reason text
);
-- Un usuario de auth solo puede estar vinculado a un jugador activo, y un
-- jugador solo puede tener una sesión activa (evita suplantaciones).
create unique index player_sessions_user_active_uq
  on public.player_sessions (user_id) where revoked_at is null;
create unique index player_sessions_player_active_uq
  on public.player_sessions (player_id) where revoked_at is null;
create index player_sessions_player_idx on public.player_sessions (player_id);

-- -----------------------------------------------------------------------------
-- Modalidades (challenges): una fila por modalidad oficial
-- -----------------------------------------------------------------------------
create table public.challenges (
  id           uuid primary key default gen_random_uuid(),
  kind         text not null unique
               check (kind in ('crash', 'overcooked', 'duels', 'missions', 'spaghetti')),
  name         text not null,
  tagline      text not null default '',
  description  text not null default '',
  rules        text not null default '',
  status       text not null default 'pending'
               check (status in ('pending', 'preparing', 'in_progress', 'finished')),
  config       jsonb not null default '{}'::jsonb,
  sort_order   int not null default 0,
  started_at   timestamptz,
  finished_at  timestamptz,
  results_confirmed_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_challenges_updated before update on public.challenges
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- CRASH TEAM RACING
-- -----------------------------------------------------------------------------
create table public.crash_races (
  id          uuid primary key default gen_random_uuid(),
  race_number int  not null check (race_number >= 0),   -- 0 = entrenamiento
  is_training boolean not null default false,
  track       text not null default '',
  status      text not null default 'pending'
              check (status in ('pending', 'in_progress', 'finished')),
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint crash_training_is_zero check (is_training = (race_number = 0))
);
create unique index crash_races_number_uq on public.crash_races (race_number);
create trigger trg_crash_races_updated before update on public.crash_races
  for each row execute function public.tg_set_updated_at();

-- Orden de pilotos de cada equipo: slot N corre la carrera N
create table public.crash_lineups (
  team_id    uuid not null references public.teams(id) on delete cascade,
  slot       int  not null check (slot >= 1),
  player_id  uuid not null references public.players(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, slot)
);

create table public.crash_race_results (
  id             uuid primary key default gen_random_uuid(),
  race_id        uuid not null references public.crash_races(id) on delete restrict,
  player_id      uuid not null references public.players(id) on delete restrict,
  team_id        uuid not null references public.teams(id) on delete restrict,
  raw_position   int  not null check (raw_position >= 1),   -- posición real (con bots)
  human_position int  not null check (human_position >= 1), -- posición entre humanos
  points         int  not null default 0,
  created_at     timestamptz not null default now(),
  unique (race_id, player_id),
  unique (race_id, team_id),
  unique (race_id, raw_position)
);

-- -----------------------------------------------------------------------------
-- OVERCOOKED
-- -----------------------------------------------------------------------------
create table public.overcooked_results (
  id          uuid primary key default gen_random_uuid(),
  team_id     uuid not null references public.teams(id) on delete restrict,
  is_training boolean not null default false,
  score       int  not null check (score >= 0),
  position    int,
  points      int,
  notes       text not null default '',
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (team_id, is_training)
);
create trigger trg_overcooked_updated before update on public.overcooked_results
  for each row execute function public.tg_set_updated_at();

-- -----------------------------------------------------------------------------
-- SPAGHETTI & MARSHMALLOW
-- -----------------------------------------------------------------------------
create table public.spaghetti_state (
  id                    smallint primary key default 1 check (id = 1),
  reference_image_path  text,
  reference_visible     boolean not null default false,
  duration_seconds      int not null default 1800 check (duration_seconds between 60 and 14400),
  timer_status          text not null default 'idle'
                        check (timer_status in ('idle', 'running', 'paused', 'finished', 'cancelled')),
  started_at            timestamptz,
  ends_at               timestamptz,  -- autoridad del cronómetro
  paused_remaining_ms   bigint,
  updated_at            timestamptz not null default now()
);
create trigger trg_spaghetti_updated before update on public.spaghetti_state
  for each row execute function public.tg_set_updated_at();

create table public.spaghetti_results (
  team_id    uuid primary key references public.teams(id) on delete restrict,
  position   int not null check (position >= 1),
  points     int,
  created_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- DUELOS
-- -----------------------------------------------------------------------------
create table public.duel_games (
  id         uuid primary key default gen_random_uuid(),
  name       text not null check (char_length(btrim(name)) between 1 and 60),
  active     boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
create unique index duel_games_name_uq on public.duel_games (lower(btrim(name)));

create table public.duels (
  id          uuid primary key default gen_random_uuid(),
  game_id     uuid not null references public.duel_games(id) on delete restrict,
  format      text not null check (format in ('1v1', 'multi')),
  status      text not null default 'in_progress'
              check (status in ('in_progress', 'finished', 'cancelled', 'voided')),
  notes       text not null default '',
  started_at  timestamptz not null default now(),
  finished_at timestamptz,
  created_by  uuid references auth.users(id) on delete set null,
  finished_by uuid references auth.users(id) on delete set null,
  void_reason text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index duels_status_idx on public.duels (status, started_at desc);
create trigger trg_duels_updated before update on public.duels
  for each row execute function public.tg_set_updated_at();

create table public.duel_players (
  duel_id   uuid not null references public.duels(id) on delete cascade,
  player_id uuid not null references public.players(id) on delete restrict,
  team_id   uuid not null references public.teams(id) on delete restrict, -- equipo en el momento del duelo
  position  int check (position >= 1),
  points    int,
  primary key (duel_id, player_id)
);
create index duel_players_player_idx on public.duel_players (player_id);

-- -----------------------------------------------------------------------------
-- MISIONES SECRETAS
-- -----------------------------------------------------------------------------
create table public.missions (
  id            uuid primary key default gen_random_uuid(),
  player_id     uuid not null references public.players(id) on delete restrict,
  description   text not null check (char_length(btrim(description)) between 3 and 500),
  reward        int  not null default 5 check (reward between 0 and 100),
  status        text not null default 'assigned'
                check (status in ('assigned', 'claimed', 'validated', 'rejected', 'discovered')),
  claim_note    text,
  judge_note    text,
  assigned_at   timestamptz not null default now(),
  claimed_at    timestamptz,
  validated_at  timestamptz,
  validated_by  uuid references auth.users(id) on delete set null,
  updated_at    timestamptz not null default now()
);
create index missions_player_idx on public.missions (player_id);
create index missions_status_idx on public.missions (status);
create trigger trg_missions_updated before update on public.missions
  for each row execute function public.tg_set_updated_at();

create table public.mission_discoveries (
  id                 uuid primary key default gen_random_uuid(),
  accuser_player_id  uuid not null references public.players(id) on delete restrict,
  accused_player_id  uuid not null references public.players(id) on delete restrict,
  guess              text not null check (char_length(btrim(guess)) between 3 and 500),
  status             text not null default 'pending'
                     check (status in ('pending', 'correct', 'incorrect')),
  mission_id         uuid references public.missions(id) on delete restrict,
  judge_note         text,
  created_at         timestamptz not null default now(),
  resolved_at        timestamptz,
  resolved_by        uuid references auth.users(id) on delete set null,
  constraint discovery_not_self check (accuser_player_id <> accused_player_id)
);
create index mission_discoveries_status_idx on public.mission_discoveries (status, created_at);
create index mission_discoveries_accuser_idx on public.mission_discoveries (accuser_player_id);
-- Una misión solo puede descubrirse una vez
create unique index mission_discoveries_mission_uq
  on public.mission_discoveries (mission_id) where status = 'correct';

-- -----------------------------------------------------------------------------
-- MOVIMIENTOS DE PUNTUACIÓN (libro mayor inmutable)
-- -----------------------------------------------------------------------------
create table public.score_events (
  id                uuid primary key default gen_random_uuid(),
  team_id           uuid not null references public.teams(id) on delete restrict,
  points            int  not null check (points <> 0),
  reason            text not null,
  challenge_id      uuid references public.challenges(id) on delete restrict,
  player_id         uuid references public.players(id) on delete restrict,
  source_type       text not null
                    check (source_type in ('crash', 'overcooked', 'duel', 'mission',
                                           'discovery', 'spaghetti', 'adjustment', 'void')),
  -- Clave idempotente: impide conceder dos veces los mismos puntos.
  source_key        text,
  corrects_event_id uuid references public.score_events(id) on delete restrict,
  created_by        uuid references auth.users(id) on delete set null,
  created_at        timestamptz not null default now()
);
create unique index score_events_source_key_uq on public.score_events (source_key)
  where source_key is not null;
create index score_events_team_idx on public.score_events (team_id);
create index score_events_created_idx on public.score_events (created_at desc);

-- El historial no se modifica ni se borra (salvo reinicio explícito, ver scripts/).
create or replace function public.tg_score_events_immutable()
returns trigger language plpgsql as $$
begin
  if coalesce(current_setting('birthday_cup.allow_reset', true), '') = 'on' then
    return coalesce(old, new);
  end if;
  raise exception 'El historial de puntuación es inmutable. Usa un ajuste compensatorio.'
    using errcode = 'P0001';
end $$;
create trigger trg_score_events_immutable before update or delete on public.score_events
  for each row execute function public.tg_score_events_immutable();

-- -----------------------------------------------------------------------------
-- SEÑALES EN DIRECTO (Realtime)
-- -----------------------------------------------------------------------------
-- Tabla sin datos sensibles. Los triggers incrementan la versión de cada
-- "tema" y los clientes, al recibir el cambio, vuelven a pedir los datos a
-- las funciones RPC, que aplican los permisos. Así Realtime nunca transmite
-- información privada (misiones, puntos ocultos...).
create table public.live_signals (
  topic      text primary key,
  version    bigint not null default 0,
  updated_at timestamptz not null default now()
);
