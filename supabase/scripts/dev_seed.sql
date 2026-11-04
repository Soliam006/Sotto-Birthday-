-- =============================================================================
-- DATOS DE PRUEBA (solo entorno de desarrollo). NO ejecutar en producción.
-- Crea 12 participantes ficticios repartidos en los equipos existentes.
-- =============================================================================
insert into public.players (name, team_id)
select n, (select id from public.teams order by sort_order offset (i % (select count(*) from public.teams)) limit 1)
from unnest(array['Test Alba','Test Bea','Test Carlos','Test Diego','Test Eva','Test Fran',
                  'Test Gema','Test Hugo','Test Irene','Test Javi','Test Kike','Test Lola']) with ordinality as t(n, i)
on conflict do nothing;
insert into public.player_access_codes (player_id, code)
select p.id, public._gen_code(8) from public.players p
where p.name like 'Test %' and not exists (select 1 from public.player_access_codes c where c.player_id = p.id);
