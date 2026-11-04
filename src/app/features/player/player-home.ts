import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHALLENGE_ICONS } from '../../core/models';
import { Leaderboard } from '../../shared/leaderboard';
import { ErrorBox, Spinner, StatusBadge } from '../../shared/ui';
import { HiddenScores } from './hidden-scores';
import { PlayerStore } from './player-store';

@Component({
  selector: 'app-player-home',
  imports: [RouterLink, Leaderboard, Spinner, ErrorBox, StatusBadge, HiddenScores],
  template: `
    @if (store.state(); as s) {
      <section class="animate-rise relative mb-5 overflow-hidden rounded-3xl border border-white/10 p-5"
               [style.background]="'linear-gradient(135deg, ' + (s.team?.color ?? '#475569') + '33, #0d0f17 70%)'">
        <p class="text-xs uppercase tracking-[0.25em] text-slate-400">Bienvenido/a</p>
        <h1 class="font-display text-5xl leading-none">{{ s.player?.name }}</h1>
        @if (s.team; as t) {
          <div class="mt-4 flex items-center gap-3">
            <span class="size-10 rounded-xl" [style.background]="t.color" [style.box-shadow]="'0 0 24px ' + t.color"></span>
            <div>
              <p class="text-xs uppercase tracking-wider text-slate-400">Tu equipo</p>
              <p class="font-display text-3xl leading-none" [style.color]="t.color">{{ t.name }}</p>
            </div>
          </div>
          <p class="mt-3 text-sm text-slate-300">
            Con: {{ teammates().join(', ') || 'aún no hay compañeros' }}
          </p>
        } @else {
          <p class="mt-4 rounded-xl bg-white/5 p-3 text-sm text-slate-300">⏳ El juez aún no te ha asignado equipo. ¡Enseguida!</p>
        }
        <div class="mt-4 flex items-center gap-2 text-xs">
          <span class="chip" [class]="statusChip()">{{ statusLabel() }}</span>
        </div>
      </section>

      <section class="mb-6">
        <h2 class="section-title">🏆 Clasificación</h2>
        @if (s.scores_visible && s.leaderboard) {
          <app-leaderboard [rows]="s.leaderboard" [highlight]="s.team?.id" />
        } @else {
          <app-hidden-scores />
        }
      </section>

      <section class="mb-6">
        <h2 class="section-title">🎮 Modalidades <a routerLink="/player/modalities" class="text-xs font-sans text-amber-300">Ver todas →</a></h2>
        @if (store.modalities(); as m) {
          <div class="grid grid-cols-2 gap-2">
            @for (c of m.challenges; track c.id) {
              <a [routerLink]="['/player/modalities']" [fragment]="c.kind" class="card-tight flex flex-col gap-2 transition active:scale-[0.98]">
                <span class="text-2xl">{{ icons[c.kind] }}</span>
                <span class="text-sm font-semibold leading-tight">{{ c.name }}</span>
                <app-status-badge [status]="c.status" />
              </a>
            }
          </div>
        } @else { <app-spinner /> }
      </section>
    } @else if (store.error()) {
      <app-error-box [message]="store.error()"><button class="btn-secondary btn-sm" (click)="store.loadState()">Reintentar</button></app-error-box>
    } @else {
      <app-spinner />
    }
  `,
})
export class PlayerHome {
  protected readonly store = inject(PlayerStore);
  protected readonly icons = CHALLENGE_ICONS;
  protected readonly teammates = computed(() => {
    const s = this.store.state();
    return (s?.team?.members ?? []).filter((m) => m.id !== s?.player?.id).map((m) => m.name);
  });
  protected readonly statusLabel = computed(() => {
    const st = this.store.state()?.competition?.status;
    return st === 'finished' ? '🏁 Competición finalizada' : st === 'running' ? '🔥 Competición en marcha' : '⏳ La competición empezará pronto';
  });
  protected readonly statusChip = computed(() => {
    const st = this.store.state()?.competition?.status;
    return st === 'running' ? 'bg-emerald-500/15 text-emerald-300' : st === 'finished' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/15 text-slate-300';
  });
}
