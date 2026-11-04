-- =============================================================================
-- BIRTHDAY CUP · 0002 · Roles, RLS y privilegios
-- =============================================================================
-- Modelo de permisos:
--   * Juez (admin): usuario de Supabase Auth con email/contraseña presente en
--     public.admins. Lectura total; escrituras CRUD directas sobre tablas de
--     catálogo; operaciones oficiales mediante RPC.
--   * Jugador: sesión anónima de Supabase Auth vinculada a un jugador mediante
--     public.player_sessions. Solo lee lo imprescindible.
--   * TV (anon): sin sesión. Solo puede ejecutar get_tv_state(clave) y leer
--     live_signals.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Funciones auxiliares de identidad (SECURITY DEFINER para evitar recursión RLS)
-- -----------------------------------------------------------------------------
create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.admins a where a.user_id = auth.uid());
$$;

create or replace function public.current_player_id()
returns uuid language sql stable security definer set search_path = public as $$
  select s.player_id from public.player_sessions s
  where s.user_id = auth.uid() and s.revoked_at is null
  limit 1;
$$;

create or replace function public.current_team_id()
returns uuid language sql stable security definer set search_path = public as $$
  select p.team_id from public.players p where p.id = public.current_player_id();
$$;

create or replace function public.is_participant()
returns boolean language sql stable security definer set search_path = public as $$
  select public.is_admin() or public.current_player_id() is not null;
$$;

create or replace function public.assert_admin()
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not public.is_admin() then
    raise exception 'Acción reservada al juez.' using errcode = '42501';
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- Privilegios base: se revoca todo y se concede lo mínimo
-- -----------------------------------------------------------------------------
revoke all on all tables in schema public from anon, authenticated;
revoke all on all functions in schema public from public, anon, authenticated;
alter default privileges in schema public revoke all on tables from anon, authenticated;
alter default privileges in schema public revoke execute on functions from public, anon, authenticated;

grant usage on schema public to anon, authenticated;

-- Activar RLS en todas las tablas
alter table public.admins               enable row level security;
alter table public.competition_settings enable row level security;
alter table public.tv_settings          enable row level security;
alter table public.teams                enable row level security;
alter table public.players              enable row level security;
alter table public.player_access_codes  enable row level security;
alter table public.player_sessions      enable row level security;
alter table public.challenges           enable row level security;
alter table public.crash_races          enable row level security;
alter table public.crash_lineups        enable row level security;
alter table public.crash_race_results   enable row level security;
alter table public.overcooked_results   enable row level security;
alter table public.spaghetti_state      enable row level security;
alter table public.spaghetti_results    enable row level security;
alter table public.duel_games           enable row level security;
alter table public.duels                enable row level security;
alter table public.duel_players         enable row level security;
alter table public.missions             enable row level security;
alter table public.mission_discoveries  enable row level security;
alter table public.score_events         enable row level security;
alter table public.live_signals         enable row level security;

-- -----------------------------------------------------------------------------
-- admins: cada usuario puede comprobar si él mismo es juez
-- -----------------------------------------------------------------------------
grant select on public.admins to authenticated;
create policy admins_self_select on public.admins for select to authenticated
  using (user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Configuración: solo juez (los jugadores usan RPC curadas)
-- -----------------------------------------------------------------------------
grant select on public.competition_settings to authenticated;
grant update (name, subtitle, invite_code, registration_open, scores_visible, missions_revealed)
  on public.competition_settings to authenticated;
create policy settings_admin_select on public.competition_settings for select to authenticated
  using (public.is_admin());
create policy settings_admin_update on public.competition_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.tv_settings to authenticated;
grant update (message, show_timer) on public.tv_settings to authenticated;
create policy tv_admin_select on public.tv_settings for select to authenticated
  using (public.is_admin());
create policy tv_admin_update on public.tv_settings for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- -----------------------------------------------------------------------------
-- Equipos y jugadores: lectura para participantes, escritura juez
-- -----------------------------------------------------------------------------
grant select, insert, update, delete on public.teams to authenticated;
create policy teams_participant_select on public.teams for select to authenticated
  using (public.is_participant());
create policy teams_admin_insert on public.teams for insert to authenticated
  with check (public.is_admin());
create policy teams_admin_update on public.teams for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy teams_admin_delete on public.teams for delete to authenticated
  using (public.is_admin());

grant select, update, delete on public.players to authenticated;
create policy players_participant_select on public.players for select to authenticated
  using (public.is_participant());
create policy players_admin_update on public.players for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy players_admin_delete on public.players for delete to authenticated
  using (public.is_admin());

grant select on public.player_access_codes to authenticated;
create policy access_codes_admin_select on public.player_access_codes for select to authenticated
  using (public.is_admin());

grant select on public.player_sessions to authenticated;
create policy sessions_select on public.player_sessions for select to authenticated
  using (public.is_admin() or user_id = auth.uid());

-- -----------------------------------------------------------------------------
-- Modalidades: lectura para participantes; edición de textos/config por juez.
-- El estado solo cambia mediante RPC con validación.
-- -----------------------------------------------------------------------------
grant select on public.challenges to authenticated;
grant update (name, tagline, description, rules) on public.challenges to authenticated;
create policy challenges_participant_select on public.challenges for select to authenticated
  using (public.is_participant());
create policy challenges_admin_update on public.challenges for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

-- Crash: carreras y alineaciones públicas para participantes; resultados solo juez
grant select on public.crash_races to authenticated;
grant update (track) on public.crash_races to authenticated;
create policy crash_races_select on public.crash_races for select to authenticated
  using (public.is_participant());
create policy crash_races_admin_update on public.crash_races for update to authenticated
  using (public.is_admin()) with check (public.is_admin());

grant select on public.crash_lineups to authenticated;
create policy crash_lineups_select on public.crash_lineups for select to authenticated
  using (public.is_participant());

grant select on public.crash_race_results to authenticated;
create policy crash_results_admin on public.crash_race_results for select to authenticated
  using (public.is_admin());

grant select on public.overcooked_results to authenticated;
create policy overcooked_admin on public.overcooked_results for select to authenticated
  using (public.is_admin());

grant select on public.spaghetti_state to authenticated;
create policy spaghetti_state_admin on public.spaghetti_state for select to authenticated
  using (public.is_admin());

grant select on public.spaghetti_results to authenticated;
create policy spaghetti_results_admin on public.spaghetti_results for select to authenticated
  using (public.is_admin());

-- Duelos: catálogo de juegos visible; duelos solo juez
grant select, insert, update, delete on public.duel_games to authenticated;
create policy duel_games_select on public.duel_games for select to authenticated
  using (public.is_participant());
create policy duel_games_admin_insert on public.duel_games for insert to authenticated
  with check (public.is_admin());
create policy duel_games_admin_update on public.duel_games for update to authenticated
  using (public.is_admin()) with check (public.is_admin());
create policy duel_games_admin_delete on public.duel_games for delete to authenticated
  using (public.is_admin());

grant select on public.duels to authenticated;
create policy duels_admin on public.duels for select to authenticated using (public.is_admin());
grant select on public.duel_players to authenticated;
create policy duel_players_admin on public.duel_players for select to authenticated using (public.is_admin());

-- Misiones: cada jugador SOLO ve las suyas. El juez lo ve todo.
grant select on public.missions to authenticated;
create policy missions_select on public.missions for select to authenticated
  using (public.is_admin() or player_id = public.current_player_id());

grant select on public.mission_discoveries to authenticated;
create policy discoveries_select on public.mission_discoveries for select to authenticated
  using (public.is_admin() or accuser_player_id = public.current_player_id());

-- Puntuación: solo juez (jugadores y TV usan RPC que respetan la visibilidad)
grant select on public.score_events to authenticated;
create policy score_events_admin on public.score_events for select to authenticated
  using (public.is_admin());

-- Señales en directo: lectura pública (no contienen datos)
grant select on public.live_signals to anon, authenticated;
create policy live_signals_read on public.live_signals for select to anon, authenticated
  using (true);
