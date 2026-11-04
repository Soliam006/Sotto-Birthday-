-- =============================================================================
-- REINICIO COMPLETO DE LA COMPETICIÓN (solo para ensayos antes del evento)
-- Ejecutar en Supabase → SQL Editor. Borra resultados, duelos, misiones y el
-- historial de puntos. Conserva equipos, jugadores, juegos y configuración.
-- ¡No lo ejecutes durante la fiesta!
-- =============================================================================
begin;
set local birthday_cup.allow_reset = 'on';
delete from public.score_events;
delete from public.mission_discoveries;
delete from public.missions;
delete from public.duel_players;
delete from public.duels;
delete from public.crash_race_results;
update public.crash_races set status = 'pending', finished_at = null;
delete from public.overcooked_results;
delete from public.spaghetti_results;
update public.spaghetti_state set timer_status = 'idle', started_at = null, ends_at = null,
  paused_remaining_ms = null, reference_visible = false;
update public.challenges set status = 'pending', started_at = null, finished_at = null, results_confirmed_at = null;
update public.competition_settings set status = 'setup', finished_at = null, winner_revealed_at = null,
  scores_visible = false, missions_revealed = false;
update public.tv_settings set mode = 'waiting';
-- Descomenta para eliminar también a los participantes y sus sesiones:
-- delete from public.crash_lineups; delete from public.players;
commit;
