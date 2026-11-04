import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { ScoreEvent } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Leaderboard } from '../../shared/leaderboard';
import { Empty, Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';

const SOURCE_LABELS: Record<string, string> = {
  crash: '🏎️ Crash', overcooked: '🍳 Overcooked', duel: '♟️ Duelo', mission: '🕵️ Misión',
  discovery: '🎯 Descubrimiento', spaghetti: '🍝 Spaghetti', adjustment: '✏️ Ajuste', void: '↩️ Anulación',
};

@Component({
  selector: 'app-admin-scores',
  imports: [FormsModule, DatePipe, Leaderboard, Spinner, Empty],
  template: `
    <div class="mb-4 flex flex-wrap items-end justify-between gap-2">
      <h1 class="title-xl">Puntuaciones</h1>
      <button class="btn-secondary btn-sm" (click)="toggleVisibility()">
        {{ store.settings()?.scores_visible ? '👁️ Visible para jugadores' : '🙈 Oculta para jugadores' }} · cambiar
      </button>
    </div>

    <div class="grid gap-6 lg:grid-cols-2">
      <section>
        <h2 class="section-title">🏆 Clasificación real</h2>
        <app-leaderboard [rows]="store.standings()" />
        <p class="mt-2 text-xs text-slate-500">Calculada siempre a partir de los movimientos oficiales. Ocultarla a los jugadores no afecta al registro de puntos.</p>
      </section>

      <section class="card">
        <h2 class="section-title">✏️ Ajuste manual / corrección</h2>
        <form class="grid gap-3" (ngSubmit)="adjust()">
          <select class="input" name="team" [(ngModel)]="team">
            <option value="">Equipo…</option>
            @for (t of store.teams(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
          </select>
          <div class="flex gap-2">
            <button type="button" class="btn-secondary w-12" (click)="points.set(-(points() || 0))">±</button>
            <input type="number" class="input flex-1 text-center text-lg" name="points" [(ngModel)]="points" placeholder="Puntos (+/-)" />
          </div>
          <select class="input" name="player" [(ngModel)]="player">
            <option value="">Sin participante asociado</option>
            @for (p of teamPlayers(); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
          </select>
          <input class="input" name="reason" [(ngModel)]="reason" placeholder="Motivo (obligatorio)" maxlength="200" />
          <button class="btn-primary" type="submit" [disabled]="!team() || !points() || reason().trim().length < 3">Registrar ajuste</button>
        </form>
        <p class="mt-2 text-xs text-slate-500">Las correcciones nunca borran el historial: generan un movimiento compensatorio.</p>
      </section>
    </div>

    <section class="mt-6">
      <h2 class="section-title">🧾 Historial de movimientos
        <select class="input w-auto min-h-9 py-1 font-sans text-sm" [ngModel]="filter()" (ngModelChange)="filter.set($event)" name="filter">
          <option value="">Todos</option>
          @for (t of store.teams(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
        </select>
      </h2>
      @if (loading()) { <app-spinner /> } @else {
        <ul class="flex flex-col gap-1.5">
          @for (e of filtered(); track e.id) {
            <li class="card-tight flex items-center gap-3 text-sm" [class.opacity-50]="revertedIds().has(e.id)">
              <span class="size-3 shrink-0 rounded-full" [style.background]="store.teamById().get(e.team_id)?.color"></span>
              <div class="min-w-0 flex-1">
                <p class="truncate">{{ e.reason }}</p>
                <p class="text-xs text-slate-500">{{ sources[e.source_type] ?? e.source_type }} · {{ store.teamById().get(e.team_id)?.name }} · {{ e.created_at | date: 'HH:mm:ss' }}
                  @if (revertedIds().has(e.id)) { · <span class="text-rose-300">anulado</span> }</p>
              </div>
              <span class="font-display text-xl" [class]="e.points > 0 ? 'text-emerald-300' : 'text-rose-300'">{{ e.points > 0 ? '+' : '' }}{{ e.points }}</span>
              @if (!revertedIds().has(e.id) && !e.corrects_event_id) {
                <button class="btn-ghost btn-sm px-2" title="Anular movimiento" (click)="revert(e)">↩️</button>
              }
            </li>
          } @empty { <app-empty icon="🧾" title="Sin movimientos" /> }
        </ul>
      }
    </section>
  `,
})
export class AdminScores implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly sources = SOURCE_LABELS;

  protected readonly loading = signal(true);
  protected readonly events = signal<ScoreEvent[]>([]);
  protected readonly filter = signal('');
  protected readonly team = signal('');
  protected readonly points = signal<number | null>(null);
  protected readonly player = signal('');
  protected readonly reason = signal('');

  protected readonly filtered = computed(() => this.events().filter((e) => !this.filter() || e.team_id === this.filter()));
  protected readonly revertedIds = computed(() => new Set(this.events().filter((e) => e.corrects_event_id && (e.source_type === 'void' || e.points === -(this.events().find((x) => x.id === e.corrects_event_id)?.points ?? 0))).map((e) => e.corrects_event_id!)));
  protected readonly teamPlayers = computed(() => this.store.players().filter((p) => p.team_id === this.team()));

  ngOnInit(): void {
    void this.load();
    this.live.watch(['scores'], () => void this.load(), this.destroyRef);
  }

  async load(): Promise<void> {
    try {
      this.events.set(await this.sb.q<ScoreEvent[]>(this.sb.client.from('score_events').select('*').order('created_at', { ascending: false }).limit(500)));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  async adjust(): Promise<void> {
    const t = this.store.teamById().get(this.team());
    const pts = Number(this.points());
    if (!(await this.confirm.ask({ title: 'Registrar ajuste', message: `${pts > 0 ? '+' : ''}${pts} puntos para ${t?.name}.\nMotivo: ${this.reason().trim()}` }))) return;
    try {
      await this.sb.rpc('admin_adjust_score', { p_team_id: this.team(), p_points: pts, p_reason: this.reason().trim(), p_player_id: this.player() || null, p_corrects_event_id: null });
      this.toast.points('Ajuste registrado');
      this.points.set(null);
      this.reason.set('');
      await Promise.all([this.load(), this.store.loadStandings()]);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async revert(e: ScoreEvent): Promise<void> {
    const reason = await this.confirm.prompt({
      title: 'Anular movimiento',
      message: `Se añadirá un movimiento de ${-e.points} puntos que compensa: «${e.reason}».`,
      danger: true, confirmText: 'Anular', prompt: { label: 'Motivo', required: true },
    });
    if (!reason) return;
    try {
      await this.sb.rpc('admin_revert_score_event', { p_event_id: e.id, p_reason: reason });
      this.toast.success('Movimiento compensado');
      await Promise.all([this.load(), this.store.loadStandings()]);
    } catch (err) {
      this.toast.error(err);
    }
  }

  async toggleVisibility(): Promise<void> {
    const next = !this.store.settings()?.scores_visible;
    if (!(await this.confirm.ask({ title: next ? 'Mostrar clasificación' : 'Ocultar clasificación', message: next ? 'Los jugadores verán puntos y posiciones.' : 'Los jugadores dejarán de ver puntos y posiciones (también desde la API).' }))) return;
    try {
      await this.sb.q(this.sb.client.from('competition_settings').update({ scores_visible: next }).eq('id', 1).select('id'));
      await this.store.loadSettings();
      this.toast.success(next ? 'Clasificación visible para jugadores' : 'Clasificación oculta para jugadores');
    } catch (e) {
      this.toast.error(e);
    }
  }
}
