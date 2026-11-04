import { Component, computed, input } from '@angular/core';
import { StandingRow } from '../core/models';

/** Clasificación compacta para móvil (jugador y juez). */
@Component({
  selector: 'app-leaderboard',
  template: `
    @let max = maxPoints();
    <ol class="flex flex-col gap-2">
      @for (row of rows(); track row.team_id; let i = $index) {
        <li class="animate-rise relative overflow-hidden rounded-xl border border-white/8 bg-ink-800/80 p-3"
            [style.animation-delay.ms]="i * 50">
          <div class="absolute inset-y-0 left-0 opacity-20 transition-all duration-700"
               [style.width.%]="max > 0 ? ((row.points ?? 0) / max) * 100 : 0" [style.background]="row.color"></div>
          <div class="relative flex items-center gap-3">
            <span class="font-display w-8 text-center text-2xl" [class.text-amber-300]="row.rank === 1">
              {{ row.rank === 1 ? '👑' : row.rank }}
            </span>
            <span class="size-4 shrink-0 rounded-full" [style.background]="row.color"
                  [style.box-shadow]="'0 0 12px ' + row.color"></span>
            <span class="flex-1 truncate font-semibold">{{ row.name }}</span>
            @if (highlight() === row.team_id) { <span class="chip bg-white/10 text-white">Tu equipo</span> }
            <span class="font-display text-2xl tabular-nums">{{ row.points }}</span>
          </div>
        </li>
      }
    </ol>
    @if (leaderGap() !== null) {
      <p class="mt-2 text-center text-xs text-slate-400">Ventaja del líder: <b class="text-slate-200">{{ leaderGap() }}</b> pts</p>
    }
  `,
})
export class Leaderboard {
  readonly rows = input.required<StandingRow[]>();
  readonly highlight = input<string | null | undefined>(null);
  readonly maxPoints = computed(() => Math.max(0, ...this.rows().map((r) => r.points ?? 0)));
  readonly leaderGap = computed(() => {
    const r = this.rows();
    if (r.length < 2 || r[0].points == null || r[1].points == null) return null;
    return r[0].points - r[1].points;
  });
}
