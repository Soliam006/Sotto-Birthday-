import { Component } from '@angular/core';

@Component({
  selector: 'app-setup-page',
  template: `
    <main class="mx-auto flex min-h-dvh max-w-lg flex-col justify-center gap-4 p-6">
      <h1 class="title-xl gold-text">BIRTHDAY CUP</h1>
      <div class="card">
        <h2 class="title-md mb-2">Falta conectar Supabase</h2>
        <p class="mb-3 text-sm text-slate-300">
          La aplicación no tiene credenciales configuradas. Define estas variables de entorno
          (en Vercel o en un archivo <code>.env</code>) y vuelve a compilar:
        </p>
        <pre class="overflow-x-auto rounded-lg bg-black/40 p-3 text-xs">SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=&lt;clave anon pública&gt;</pre>
        <p class="mt-3 text-xs text-slate-400">Consulta el README para los pasos completos.</p>
      </div>
    </main>
  `,
})
export class SetupPage {}
