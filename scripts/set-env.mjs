// Genera src/environments/environment.ts a partir de variables de entorno
// (Vercel) o de un archivo .env local. Nunca incluye la Service Role Key.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';

const fromFile = {};
if (existsSync('.env')) {
  for (const line of readFileSync('.env', 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m) fromFile[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}
const get = (k) => process.env[k] ?? fromFile[k] ?? '';

const url = get('SUPABASE_URL') || get('NG_APP_SUPABASE_URL');
const anonKey = get('SUPABASE_ANON_KEY') || get('NG_APP_SUPABASE_ANON_KEY');

if (/service_role/.test(anonKey)) {
  console.error('✖ SUPABASE_ANON_KEY parece una Service Role Key. Usa la clave "anon"/"publishable".');
  process.exit(1);
}
if (!url || !anonKey) {
  console.warn('⚠ Faltan SUPABASE_URL y/o SUPABASE_ANON_KEY. La app mostrará la pantalla de configuración.');
}

mkdirSync('src/environments', { recursive: true });
writeFileSync(
  'src/environments/environment.ts',
  `// Archivo generado por scripts/set-env.mjs. No editar ni subir a git.
export const environment = {
  supabaseUrl: ${JSON.stringify(url)},
  supabaseAnonKey: ${JSON.stringify(anonKey)},
};
`,
);
console.log('✔ src/environments/environment.ts generado');
