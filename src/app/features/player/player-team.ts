import { Component, computed, inject } from '@angular/core';
import { ErrorBox, Spinner } from '../../shared/ui';
import { HiddenScores } from './hidden-scores';
import { PlayerStore } from './player-store';

@Component({
  selector: 'app-player-team',
  imports: [Spinner, ErrorBox, HiddenScores],
  template: `
    @if (store.state(); as s) {
      @if (s.team; as t) {
        <section class="animate-rise relative mb-5 overflow-hidden rounded-3xl border p-6 text-center"
                 [style.border-color]="t.color + '66'"
                 [style.background]="'radial-gradient(circle at 50% 0%, ' + t.color + '44, #0d0f17 70%)'">
          <div class="mx-auto mb-3 grid size-20 place-items-center rounded-3xl text-4xl"
               [style.background]="t.color" [style.box-shadow]="'0 0 40px ' + t.color">🛡️</div>
          <h1 class="font-display text-5xl leading-none" [style.color]="t.color">{{ t.name }}</h1>
          <p class="mt-1 text-sm text-slate-400">{{ t.members.length }} integrantes</p>
          @if (myRow(); as r) {
            <div class="mt-4 flex justify-center gap-6">
              <div><p class="font-display text-5xl">{{ r.points }}</p><p class="text-xs uppercase tracking-wider text-slate-400">Puntos</p></div>
              <div><p class="font-display text-5xl">{{ r.rank }}º</p><p class="text-xs uppercase tracking-wider text-slate-400">Posición</p></div>
            </div>
          }
        </section>

        <h2 class="section-title">👥 Integrantes</h2>
        <ul class="mb-6 grid grid-cols-2 gap-2">
          @for (m of t.members; track m.id) {
            <li class="card-tight flex items-center gap-2" [class.ring-2]="m.id === s.player?.id" [style.--tw-ring-color]="t.color">
              <span class="grid size-9 shrink-0 place-items-center rounded-full font-bold text-ink-950" [style.background]="t.color">{{ m.name.charAt(0).toUpperCase() }}</span>
              <span class="truncate font-semibold">{{ m.name }}</span>
            </li>
          }
        </ul>
        @if (!s.scores_visible) { <app-hidden-scores /> }
        <p class="mt-4 text-center text-xs text-slate-500">Todos los puntos que consigas (duelos, carreras, misiones…) suman para tu equipo.</p>
      } @else {
        <div class="card text-center">
          <p class="text-4xl">⏳</p>
          <p class="mt-2 font-semibold">Aún no tienes equipo</p>
          <p class="text-sm text-slate-400">El juez te asignará uno en breve.</p>
        </div>
      }
    } @else if (store.error()) {
      <app-error-box [message]="store.error()" />
    } @else {
      <app-spinner />
    }
  `,
})
export class PlayerTeam {
  protected readonly store = inject(PlayerStore);
  protected readonly myRow = computed(() => {
    const s = this.store.state();
    if (!s?.scores_visible || !s.leaderboard || !s.team) return null;
    return s.leaderboard.find((r) => r.team_id === s.team!.id) ?? null;
  });
}
