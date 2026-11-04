-- =============================================================================
-- Convierte un usuario de Supabase Auth en JUEZ.
-- 1) Authentication → Users → "Add user" → email + contraseña (Auto Confirm).
-- 2) Sustituye el email y ejecuta este script en el SQL Editor.
-- =============================================================================
insert into public.admins (user_id, display_name)
select id, 'Juez' from auth.users where email = 'TU_EMAIL@ejemplo.com'
on conflict (user_id) do nothing;

select a.user_id, u.email from public.admins a join auth.users u on u.id = a.user_id;
