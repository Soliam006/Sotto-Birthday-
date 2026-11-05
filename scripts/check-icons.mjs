// Comprueba que todos los iconos usados en <mat-icon> están incluidos en la
// URL de Google Fonts (icon_names=...) de src/index.html. Si falta alguno, el
// navegador mostraría su nombre en texto en lugar del icono.
// Detecta: <mat-icon>nombre</mat-icon>, <mat-icon>{{ cond ? 'a' : 'b' }}</mat-icon>,
// icon="nombre" (app-empty) e icon: 'nombre' (datos de navegación/modalidades).
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const files = [];
const walk = (d) => readdirSync(d).forEach((f) => {
  const p = join(d, f);
  if (statSync(p).isDirectory()) walk(p);
  else if (p.endsWith('.ts') && !p.endsWith('.spec.ts')) files.push(p);
});
walk('src/app');

const used = new Map();
const add = (name, file) => { if (/^[a-z][a-z0-9_]*$/.test(name)) used.set(name, file); };
for (const f of files) {
  // Se ignoran los comentarios de código
  const s = readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  for (const m of s.matchAll(/<mat-icon[^>]*>([\s\S]*?)<\/mat-icon>/g)) {
    const inner = m[1].trim();
    // En expresiones solo cuentan los resultados de las ternarias (tras ? o :), no las condiciones
    if (inner.startsWith('{{')) for (const q of inner.matchAll(/[?:]\s*'([a-z0-9_]+)'/g)) add(q[1], f);
    else add(inner, f);
  }
  for (const m of s.matchAll(/\bicon="([a-z0-9_]+)"/g)) add(m[1], f);
  for (const m of s.matchAll(/\bicon: '([a-z0-9_]+)'(?!, emoji: true)/g)) add(m[1], f);
  // Diccionarios nombre-de-icono (CHALLENGE_ICONS, SOURCE_LABELS, toast-host)
  const dict = s.match(/CHALLENGE_ICONS[^=]*=\s*\{([^}]*)\}/);
  if (dict) for (const q of dict[1].matchAll(/'([a-z0-9_]+)'/g)) add(q[1], f);
  const toast = s.match(/success: '([a-z_]+)', error: '([a-z_]+)', info: '([a-z_]+)'/);
  if (toast) toast.slice(1).forEach((n) => add(n, f));
}

const html = readFileSync('src/index.html', 'utf8');
const listed = new Set((html.match(/icon_names=([a-z0-9_,]+)/)?.[1] ?? '').split(','));
const missing = [...used.keys()].filter((n) => !listed.has(n)).sort();
const sorted = [...listed].join(',') === [...listed].sort().join(',');

if (missing.length || !sorted) {
  if (missing.length) console.error('✖ Iconos usados que faltan en icon_names (src/index.html):\n  ' + missing.map((n) => `${n}  (${used.get(n)})`).join('\n  '));
  if (!sorted) console.error('✖ icon_names debe estar en orden alfabético (lo exige Google Fonts).');
  process.exit(1);
}
const unused = [...listed].filter((n) => !used.has(n));
console.log(`✔ ${used.size} iconos verificados` + (unused.length ? ` (en la lista sin uso detectado: ${unused.join(', ')})` : ''));
