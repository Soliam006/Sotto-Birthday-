import { Injectable, computed, inject, signal } from '@angular/core';
import { LiveService } from '../../core/live.service';
import { MyState, PlayerModalities } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { AuthService } from '../../core/auth.service';
import { syncServerClock } from '../../core/clock';
import { Router } from '@angular/router';

/** Estado compartido de la vista de jugador, actualizado en directo. */
@Injectable({ providedIn: 'root' })
export class PlayerStore {
  private readonly sb = inject(SupabaseService);
  private readonly live = inject(LiveService);
  private readonly toast = inject(ToastService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  readonly state = signal<MyState | null>(null);
  readonly modalities = signal<PlayerModalities | null>(null);
  readonly error = signal('');
  readonly team = computed(() => this.state()?.team ?? null);

  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loadState();
    void this.loadModalities();
    this.live.watch(['teams', 'players', 'scores', 'settings'], () => void this.loadState());
    this.live.watch(['challenges', 'spaghetti', 'duels'], () => void this.loadModalities());
  }

  async loadState(): Promise<void> {
    try {
      const prev = this.state();
      const s = await this.sb.rpc<MyState>('get_my_state');
      if (!s.linked) {
        // Sesión revocada por el juez
        this.toast.info('Tu sesión se ha cerrado. Vuelve a escanear tu QR.');
        await this.auth.resolveRole();
        this.started = false;
        await this.router.navigateByUrl('/');
        return;
      }
      this.notifyChanges(prev, s);
      this.state.set(s);
      this.error.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  async loadModalities(): Promise<void> {
    try {
      const t0 = Date.now();
      const m = await this.sb.rpc<PlayerModalities>('get_player_modalities');
      syncServerClock(m.server_now, t0);
      const prev = this.modalities();
      if (prev && m.crash.lineup_version > prev.crash.lineup_version && m.crash.lineup_updated_by_id !== this.state()?.player?.id) {
        this.toast.info(`${m.crash.lineup_updated_by ?? 'Alguien'} ha guardado el orden de pilotos de Crash`);
      }
      if (prev && m.overcooked.roster_version > prev.overcooked.roster_version && m.overcooked.roster_updated_by_id !== this.state()?.player?.id) {
        this.toast.info(`${m.overcooked.roster_updated_by ?? 'Alguien'} ha guardado los cocineros de Overcooked`);
      }
      this.modalities.set(m);
    } catch (e) {
      this.error.set((e as Error).message);
    }
  }

  private notifyChanges(prev: MyState | null, next: MyState): void {
    if (!prev?.linked) return;
    if (prev.team?.id !== next.team?.id && next.team) this.toast.info(`Ahora formas parte de ${next.team.name}`);
    if (!prev.scores_visible && next.scores_visible) this.toast.info('¡La clasificación ya es visible!');
    if (prev.scores_visible && next.leaderboard && prev.leaderboard && next.team) {
      const before = prev.leaderboard.find((r) => r.team_id === next.team!.id)?.points ?? 0;
      const after = next.leaderboard.find((r) => r.team_id === next.team!.id)?.points ?? 0;
      if (after > before) this.toast.points(`¡Tu equipo suma ${after - before} puntos!`);
    }
  }
}
