# 🏆 BIRTHDAY CUP

Aplicación web para gestionar una competición por equipos durante un cumpleaños.
Tres experiencias separadas:

| Experiencia | Ruta | Acceso |
|---|---|---|
| **Juez (admin)** | `/admin` | Email + contraseña (Supabase Auth) y alta en `public.admins` |
| **Jugador** | `/player` | QR de invitación → nombre → sesión anónima de Supabase vinculada en servidor |
| **Pantalla TV** | `/tv?key=…` | Clave de solo lectura (sin permisos de juez) |

**Stack:** Angular 22 (standalone, signals, zoneless) · TypeScript estricto · Tailwind CSS 4 · Supabase (Postgres, Auth, Realtime, Storage) · Vercel.

---

## 1. Arquitectura

```
src/app/
  core/           Servicios transversales: SupabaseService, AuthService, LiveService (Realtime),
                  guards, modelos, toasts, confirmaciones, reloj sincronizado con el servidor
  shared/         Componentes reutilizables: clasificación, cronómetro, QR, badges, estados vacíos
  features/
    join/         Acceso de invitados (QR general / QR personal)
    player/       Vista de jugador: Inicio, Modalidades, Mis misiones, Mi equipo
    admin/        Panel del juez: Dashboard, Participantes, Equipos, Modalidades (Crash,
                  Overcooked, Spaghetti), Duelos, Misiones, Puntuaciones, Pantalla TV, Configuración
    tv/           Pantalla pública para televisión
supabase/
  migrations/     Migraciones SQL versionadas (esquema, RLS, RPC, Realtime/Storage/seed)
  scripts/        create_admin.sql · reset_competition.sql · dev_seed.sql (solo desarrollo)
  tests/          Pruebas de integración SQL ejecutables contra PostgreSQL local
```

### Principios de seguridad
- **El servidor es la única autoridad.** Toda operación oficial (resultados, puntos, duelos,
  validaciones, cronómetro…) es una función `SECURITY DEFINER` que comprueba `is_admin()` antes
  de actuar. Los puntos se calculan en servidor a partir de la configuración almacenada; el
  cliente solo envía posiciones o puntuaciones de juego.
- **RLS en todas las tablas.** Los jugadores solo leen lo imprescindible: sus propias misiones,
  sus acusaciones, equipos y nombres. `score_events`, resultados, duelos y configuración son
  exclusivos del juez.
- **Clasificación oculta de verdad.** Los jugadores solo obtienen puntos/posiciones mediante
  `get_my_state()`, que no los devuelve si `scores_visible = false`. La TV usa
  `get_tv_state(clave)`, con visibilidad independiente.
- **Sin duplicados.** Cada movimiento tiene una `source_key` única (`duel:<id>:<jugador>`,
  `mission:<id>`…), y las operaciones bloquean la fila (`FOR UPDATE`) y verifican su estado.
- **Historial inmutable.** Un trigger impide `UPDATE`/`DELETE` en `score_events`; las
  correcciones generan movimientos compensatorios (`admin_adjust_score`,
  `admin_revert_score_event`, `admin_void_duel`).
- **Realtime sin fugas.** Los clientes escuchan la tabla `live_signals` (solo contadores de
  versión) y, al cambiar, vuelven a pedir los datos a las RPC, que aplican permisos.
  Hay además un sondeo de respaldo cada 20 s.
- **Cronómetro en servidor.** Spaghetti guarda `ends_at` / `paused_remaining_ms`; los
  dispositivos calculan el tiempo restante corrigiendo el desfase con la hora del servidor.
- La **Service Role Key nunca** se usa en el cliente (`scripts/set-env.mjs` aborta si se detecta).

---

## 2. Configuración de Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).
2. **Authentication → Sign In / Providers**:
   - Activa **Allow anonymous sign-ins** (necesario para los jugadores).
   - Mantén Email habilitado y **desactiva "Allow new users to sign up"** (el juez se crea a mano).
3. **Aplica las migraciones** (en orden):
   - Con Supabase CLI: `supabase link --project-ref <ref>` y `supabase db push`.
   - O pega en **SQL Editor** el contenido de cada archivo de `supabase/migrations/` por orden.
4. Comprueba en **Database → Publications** que `supabase_realtime` incluye `live_signals`
   (la migración 0004 lo añade) y en **Storage** que existe el bucket público `references`.

### Crear al juez (administrador)
1. **Authentication → Users → Add user → Create new user**: email + contraseña, marca *Auto Confirm User*.
2. En **SQL Editor** ejecuta `supabase/scripts/create_admin.sql` sustituyendo el email.

### Ensayo antes de la fiesta
`supabase/scripts/reset_competition.sql` borra resultados, duelos, misiones e historial de
puntos (conserva equipos y jugadores). Solo para ensayos.

---

## 3. Desarrollo local

```bash
cp .env.example .env        # SUPABASE_URL y SUPABASE_ANON_KEY (clave pública "anon")
npm install
npm start                   # http://localhost:4200
npm run build               # dist/birthday-cup/browser
npm run test:db             # pruebas SQL contra un PostgreSQL local (requiere superusuario)
```

`scripts/set-env.mjs` genera `src/environments/environment.ts` (ignorado por git) a partir de
variables de entorno o de `.env`. Sin credenciales, la app muestra la pantalla `/setup`.

---

## 4. Despliegue en Vercel

1. Importa el repositorio en Vercel (la configuración está en `vercel.json`).
2. **Settings → Environment Variables**: `SUPABASE_URL` y `SUPABASE_ANON_KEY`.
3. Despliega. Las rutas SPA se reescriben a `index.html`.
4. En Supabase → **Authentication → URL Configuration**, pon la URL de Vercel como *Site URL*.

---

## 5. El día de la fiesta

1. **Juez:** entra en `https://<tu-app>/admin`.
2. **Invitados:** *Configuración* → imprime o muestra el **QR de invitación**
   (`/?code=XXXXXX`). Cada invitado escanea, escribe su nombre y queda vinculado a su móvil.
3. Asigna equipos en *Participantes* (o «Repartir sin equipo»).
4. **TV:** *Pantalla TV* → «Abrir pantalla TV» en el navegador del televisor (doble clic = pantalla completa).
5. **Incidencias:** si un invitado cambia de móvil o borra el navegador, en *Participantes* →
   su ficha → «Cerrar sesión y generar nuevo QR» y que escanee el **QR personal** (un solo uso).
6. Al terminar: *Pantalla TV* → «Finalizar competición» → **«REVELAR GANADOR»**.

---

## 6. Reglas implementadas y decisiones tomadas

| Tema | Decisión |
|---|---|
| Crash | El juez introduce la posición real (con bots) de cada piloto; el servidor calcula el orden entre humanos. 20/15/10/5. Carrera 0 = entrenamiento sin puntos. Cada equipo presenta tantos pilotos distintos como carreras (si un equipo tiene menos integrantes que carreras, se permite repetir). No se puede finalizar con carreras pendientes. |
| Overcooked | Puntuación oficial por equipo → ranking automático con empates (1,1,3). 40/30/20/10. El juez confirma antes de sumar. |
| Spaghetti | 30 min por defecto (configurable). Imagen en Storage, visible solo cuando el juez la muestra. 50/35/20/10. |
| Duelos | 1v1: equipos distintos, ganador +15. Multi: ≥3 jugadores de ≥2 equipos, 15/8/0. Límite 3 duelos puntuables por jugador (cancelados no cuentan). **Empate en 1v1: ambos reciben los puntos de 1º (regla literal «los empates reciben la puntuación de su posición»)** — ajustable si prefieres otra cosa. |
| Misiones | Máx. 3 por jugador, +5 al validar. Si se rechaza, el jugador puede reintentarlo. |
| Descubrimientos | Solo contra jugadores de **otro equipo** (evita que un equipo se dé puntos a sí mismo). Acierto +5 y la misión queda «descubierta» (ya no puntúa). Una misión validada no puede descubrirse. |
| Equipos | 2–6. Cambiar de equipo a un jugador no mueve los puntos ya ganados (se guardan con el equipo del momento). Posiciones 5º y 6º reciben 0 en las tablas de 4 posiciones (editables en *Modalidades → Textos y puntos*). |
| Puntuar | Solo con la modalidad **En curso** y la competición no finalizada. |
| TV | Los modos «Resultados finales» y «Campeón» solo están disponibles tras «REVELAR GANADOR», que exige finalizar antes la competición. |
