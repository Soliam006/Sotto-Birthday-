import { Component } from '@angular/core';

@Component({
  selector: 'app-hidden-scores',
  template: `
    <div class="relative overflow-hidden rounded-2xl border border-white/10 bg-gradient-to-br from-violet-950/60 to-ink-850 p-6 text-center">
      <div class="mb-2 text-5xl">🤫</div>
      <p class="font-display text-2xl tracking-wide text-violet-200">Clasificación secreta</p>
      <p class="mx-auto mt-2 max-w-xs text-sm text-slate-300">
        Los resultados están ocultos. ¡Tendrás que esperar al final para descubrir quién gana!
      </p>
    </div>
  `,
})
export class HiddenScores {}
