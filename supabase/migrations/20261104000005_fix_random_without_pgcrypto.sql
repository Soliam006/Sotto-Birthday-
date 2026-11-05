-- =============================================================================
-- BIRTHDAY CUP · 0005 · Aleatoriedad sin depender de pgcrypto
-- =============================================================================
-- En Supabase la extensión pgcrypto está instalada en el esquema "extensions".
-- Las funciones SECURITY DEFINER fijan search_path = public, por lo que
-- gen_random_bytes() no se resolvía ("function gen_random_bytes(integer) does
-- not exist") al unirse un jugador, crear participantes o rotar claves.
--
-- Se sustituye por gen_random_uuid(), nativa de PostgreSQL 13+ (pg_catalog,
-- siempre visible) y generada con un CSPRNG: 122 bits aleatorios por UUID.
-- =============================================================================

-- Códigos legibles (sin 0/O ni 1/I): un UUID nuevo por carácter, usando su
-- primer byte (totalmente aleatorio en UUID v4). 256 % 32 = 0 => sin sesgo.
create or replace function public._gen_code(p_len int)
returns text language sql volatile set search_path = public as $$
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789',
                           1 + (get_byte(uuid_send(gen_random_uuid()), 0) % 32), 1), '')
  from generate_series(1, p_len);
$$;

-- Clave hexadecimal de 64 caracteres (2 UUID v4 => 244 bits aleatorios)
create or replace function public._gen_hex_key()
returns text language sql volatile set search_path = public as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$;

alter table public.tv_settings alter column access_key set default public._gen_hex_key();

create or replace function public.admin_rotate_tv_key()
returns text language plpgsql security definer set search_path = public as $$
declare v_key text := public._gen_hex_key();
begin
  perform public.assert_admin();
  update public.tv_settings set access_key = v_key where id = 1;
  return v_key;
end $$;

-- Funciones internas: sin acceso directo para clientes
revoke all on function public._gen_code(int), public._gen_hex_key() from public, anon, authenticated;
grant execute on function public.admin_rotate_tv_key() to authenticated;
