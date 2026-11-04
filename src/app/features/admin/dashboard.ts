import { Component, DestroyRef, OnInit, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { RouterLink } from '@angular/router';
import { LiveService } from '../../core/live.service';
import { CHALLENGE_ICONS } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { Leaderboard } from '../../shared/leaderboard';
import { Empty, Spinner, StatusBadge } from '../../shared/ui';
import { AdminStore } from './admin-store';

interface DashboardData {
  players: number;
  players_unassigned: number;
  teams: number;
  challenges: Record<string, number> | null;
  duels_active: number;
  missions_pending: number;
  discoveries_pending: number;
  recent_events: { id: string; points: number; reason: string; created_at: string; team_name: string; team_color: string }[];
}

@Component({
  selector: 'app-dashboard',
  imports: [RouterLink, DatePipe, Leaderboard, Spinner, StatusBadge, Empty],
  template: `
    <div class="mb-5 flex flex-wrap items-end justify-between gap-2">
      <div>
        <p class="text-xs uppercase tracking-[0.25em] text-slate-400">{{ store.settings()?.status === 'finished' ? 'Competición finalizada' : store.settings()?.status === 'running' ? 'Competición en marcha' : 'Preparación' }}</p>
        <h1 class="title-xl">Dashboard</h1>
      </div>
      <span class="chip" [class]="store.settings()?.scores_visible ? 'bg-emerald-500/15 text-emerald-300' : 'bg-violet-500/15 text-violet-300'">
        {{ store.settings()?.scores_visible ? '👁️ Clasificación visible' : '🙈 Clasificación oculta' }}
      </span>
    </div>

    @if (data(); as d) {
      <section class="mb-6 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <a routerLink="/admin/players" class="card-tight"><p class="font-display text-4xl">{{ d.players }}</p><p class="text-xs text-slate-400">Participantes @if (d.players_unassigned) {<span class="text-amber-300">· {{ d.players_unassigned }} sin equipo</span>}</p></a>
        <a routerLink="/admin/teams" class="card-tight"><p class="font-display text-4xl">{{ d.teams }}</p><p class="text-xs text-slate-400">Equipos</p></a>
        <a routerLink="/admin/duels" class="card-tight"><p class="font-display text-4xl text-emerald-300">{{ d.duels_active }}</p><p class="text-xs text-slate-400">Duelos activos</p></a>
        <a routerLink="/admin/missions" class="card-tight" [class.ring-2]="d.missions_pending + d.discoveries_pending > 0" [class.ring-amber-400]="d.missions_pending + d.discoveries_pending > 0">
          <p class="font-display text-4xl text-amber-300">{{ d.missions_pending + d.discoveries_pending }}</p>
          <p class="text-xs text-slate-400">Pendientes de validar</p>
        </a>
      </section>

      <div class="grid gap-6 lg:grid-cols-2">
        <section>
          <h2 class="section-title">🏆 Clasificación real <a routerLink="/admin/scores" class="font-sans text-xs text-amber-300">Historial →</a></h2>
          @if (store.standings().length) { <app-leaderboard [rows]="store.standings()" /> }
          @if (store.lastUpdate()) { <p class="mt-2 text-xs text-slate-500">Última puntuación: {{ store.lastUpdate() | date: 'HH:mm:ss' }}</p> }
        </section>

        <section>
          <h2 class="section-title">🎮 Modalidades
            <span class="font-sans text-xs text-slate-400">{{ d.challenges?.['pending'] ?? 0 }} pend. · {{ d.challenges?.['in_progress'] ?? 0 }} en curso · {{ d.challenges?.['finished'] ?? 0 }} fin.</span>
          </h2>
          <ul class="flex flex-col gap-2">
            @for (c of store.challenges(); track c.id) {
              <li>
                <a [routerLink]="link(c.kind)" class="card-tight flex items-center gap-3 transition hover:bg-ink-700">
                  <span class="text-2xl">{{ icons[c.kind] }}</span>
                  <span class="flex-1 font-semibold">{{ c.name }}</span>
                  <app-status-badge [status]="c.status" />
                </a>
              </li>
            }
          </ul>
        </section>
      </div>

      <section class="mt-6">
        <h2 class="section-title">⚡ Accesos rápidos</h2>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <a routerLink="/admin/duels" [queryParams]="{ nuevo: 1 }" class="btn-primary">♟️ Nuevo duelo</a>
          <a routerLink="/admin/missions" class="btn-secondary">🕵️ Validar misiones</a>
          <a routerLink="/admin/modalities/spaghetti" class="btn-secondary">⏱️ Cronómetro</a>
          <a routerLink="/admin/tv" class="btn-secondary">📺 Pantalla TV</a>
        </div>
      </section>

      <section class="mt-6">
        <h2 class="section-title">🧾 Últimos movimientos</h2>
        <ul class="flex flex-col gap-1.5">
          @for (e of d.recent_events; track e.id) {
            <li class="card-tight flex items-center gap-3 text-sm">
              <span class="size-3 shrink-0 rounded-full" [style.background]="e.team_color"></span>
              <span class="min-w-0 flex-1"><span class="block truncate">{{ e.reason }}</span><span class="text-xs text-slate-500">{{ e.team_name }} · {{ e.created_at | date: 'HH:mm' }}</span></span>
              <span class="font-display text-xl" [class]="e.points > 0 ? 'text-emerald-300' : 'text-rose-300'">{{ e.points > 0 ? '+' : '' }}{{ e.points }}</span>
            </li>
          } @empty {
            <app-empty icon="🧾" title="Aún no hay puntos" text="Los movimientos aparecerán aquí en cuanto registres resultados." />
          }
        </ul>
      </section>
    } @else {
      <app-spinner />
    }
  `,
})
export class Dashboard implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly icons = CHALLENGE_ICONS;
  protected readonly data = signal<DashboardData | null>(null);

  ngOnInit(): void {
    void this.load();
    this.live.watch(['scores', 'players', 'teams', 'challenges', 'duels', 'missions'], () => void this.load(), this.destroyRef);
  }

  async load(): Promise<void> {
    try {
      this.data.set(await this.sb.rpc<DashboardData>('admin_get_dashboard'));
    } catch (e) {
      this.store.error.set((e as Error).message);
    }
  }

  link(kind: string): string {
    return kind === 'duels' ? '/admin/duels' : kind === 'missions' ? '/admin/missions' : `/admin/modalities/${kind}`;
  }
}
