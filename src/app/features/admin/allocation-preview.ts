import { Component, computed, input } from '@angular/core';
import { AllocationRow } from '../../core/models';

/** Resumen de los puntos calculados por el servidor antes de confirmar. */
@Component({
  selector: 'app-allocation-preview',
  template: `
    <div class="rounded-2xl border border-amber-400/30 bg-amber-500/5 p-3">
      <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-amber-300">Resumen de puntos (calculado por el servidor)</p>
      <ul class="flex flex-col gap-1.5">
        @for (r of rows(); track $index) {
          <li class="flex items-center gap-2 text-sm">
            <span class="font-display w-8 text-xl">{{ r.human_position ?? r.position }}º</span>
            <span class="size-3 rounded-full" [style.background]="r.team_color"></span>
            <span class="min-w-0 flex-1 truncate">{{ r.player_name ? r.player_name + ' · ' : '' }}<span class="text-slate-400">{{ r.team_name }}</span>
              @if (r.raw_position) { <span class="text-xs text-slate-500"> (llegó {{ r.raw_position }}º con bots)</span> }
              @if (r.score != null) { <span class="text-xs text-slate-500"> ({{ r.score }} pts de juego)</span> }
            </span>
            <span class="font-display text-xl" [class]="r.points ? 'text-emerald-300' : 'text-slate-500'">+{{ r.points }}</span>
          </li>
        }
      </ul>
      @if (totals().length > 1 && hasPlayers()) {
        <div class="mt-3 border-t border-white/10 pt-2">
          <p class="mb-1 text-xs uppercase tracking-wider text-slate-400">Total por equipo</p>
          <div class="flex flex-wrap gap-2">
            @for (t of totals(); track t.name) {
              <span class="chip bg-white/5"><span class="size-2.5 rounded-full" [style.background]="t.color"></span>{{ t.name }} +{{ t.points }}</span>
            }
          </div>
        </div>
      }
    </div>
  `,
})
export class AllocationPreview {
  readonly rows = input.required<AllocationRow[]>();
  readonly hasPlayers = computed(() => this.rows().some((r) => !!r.player_name));
  readonly totals = computed(() => {
    const m = new Map<string, { name: string; color: string; points: number }>();
    for (const r of this.rows()) {
      const cur = m.get(r.team_id) ?? { name: r.team_name, color: r.team_color, points: 0 };
      cur.points += r.points;
      m.set(r.team_id, cur);
    }
    return [...m.values()].sort((a, b) => b.points - a.points);
  });
}
