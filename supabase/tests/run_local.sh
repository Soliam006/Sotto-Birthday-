#!/usr/bin/env bash
# Crea una base de datos local desechable, aplica el stub + migraciones y ejecuta los tests.
# Uso: supabase/tests/run_local.sh   (requiere PostgreSQL local y permisos de superusuario)
set -euo pipefail
DIR="$(cd "$(dirname "$0")" && pwd)"
DB="${DB:-birthday_cup_test}"
PSQL="${PSQL:-psql}"
$PSQL -v ON_ERROR_STOP=1 -q -d postgres -c "drop database if exists $DB" -c "create database $DB"
$PSQL -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/supabase_stub.sql"
for f in "$DIR"/../migrations/*.sql; do
  echo "→ $(basename "$f")"
  $PSQL -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f"
done
echo "→ tests.sql"
$PSQL -v ON_ERROR_STOP=1 -q -d "$DB" -f "$DIR/tests.sql"
