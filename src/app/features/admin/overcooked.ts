import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { AllocationRow } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';
import { AllocationPreview } from './allocation-preview';
import { ChallengeControls } from './challenge-controls';

interface OcResult { team_id: string; is_training: boolean; score: number; position: number | null; points: number | null; notes: string }

@Component({
  selector: 'app-admin-overcooked',
  imports: [FormsModule, RouterLink, Spinner, ChallengeControls, AllocationPreview],
  template: `
    <a routerLink="/admin/modalities" class="mb-2 inline-block text-xs text-slate-400">← Modalidades</a>
    <app-challenge-controls kind="overcooked" />
    @let ch = store.challenge('overcooked');
    @let confirmed = !!ch?.results_confirmed_at;

    @if (loading()) { <app-spinner /> } @else {
      <section class="card mb-4">
        <h2 class="section-title">⚙️ Condiciones comunes</h2>
        <form class="grid gap-3 sm:grid-cols-2" (ngSubmit)="saveConfig()">
          <div><label class="label" for="lvl">Nivel / escenario</label><input id="lvl" class="input" name="level" [(ngModel)]="level" placeholder="Ej.: 1-4" /></div>
          <div><label class="label" for="ppt">Cocineros por equipo</label><input id="ppt" type="number" min="1" max="4" class="input" name="ppt" [(ngModel)]="playersPerTeam" /></div>
          <div class="sm:col-span-2"><label class="label" for="cond">Condiciones</label><textarea id="cond" class="input min-h-16" name="cond" [(ngModel)]="conditions" placeholder="Ej.: modo arcade, 1 intento, sin pausa"></textarea></div>
          <button class="btn-secondary sm:col-span-2" type="submit">💾 Guardar condiciones (visibles para los jugadores)</button>
        </form>
      </section>

      @for (mode of modes; track mode.training) {
        <section class="card mb-4" [class.opacity-80]="mode.training">
          <h2 class="section-title">{{ mode.training ? '🧪 Partida de entrenamiento (no puntúa)' : '🏆 Partida oficial' }}</h2>
          <div class="flex flex-col gap-2">
            @for (t of activeTeams(); track t.id) {
              @let r = resultOf(t.id, mode.training);
              <div class="flex items-center gap-2">
                <span class="size-3 shrink-0 rounded-full" [style.background]="t.color"></span>
                <span class="min-w-0 flex-1 truncate font-semibold">{{ t.name }}</span>
                @if (!mode.training && confirmed) {
                  <span class="font-display text-2xl">{{ r?.score ?? '—' }}</span>
                  <span class="chip bg-amber-500/15 text-amber-300">{{ r?.position }}º · +{{ r?.points }}</span>
                } @else {
                  <input type="number" min="0" class="input min-h-9 w-28 py-1.5 text-right" placeholder="Puntos"
                         [ngModel]="draft()[key(t.id, mode.training)] ?? r?.score ?? null"
                         (ngModelChange)="setDraft(t.id, mode.training, $event)" [name]="key(t.id, mode.training)" />
                  <button class="btn-secondary btn-sm" (click)="saveScore(t.id, mode.training)"
                          [disabled]="draft()[key(t.id, mode.training)] == null">Guardar</button>
                  @if (r) { <span class="text-emerald-300" title="Guardado">✔</span> }
                }
              </div>
            }
          </div>
        </section>
      }

      @if (!confirmed) {
        <section class="card">
          <h2 class="section-title">✅ Confirmar resultados oficiales</h2>
          @if (preview(); as pv) { <app-allocation-preview [rows]="pv" /> }
          <div class="mt-3 flex gap-2">
            <button class="btn-secondary flex-1" (click)="doPreview()">👁️ Ver clasificación</button>
            <button class="btn-primary flex-1" [disabled]="!preview() || busy()" (click)="confirmResults()">Confirmar y sumar puntos</button>
          </div>
        </section>
      } @else {
        <p class="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200">✔ Resultados confirmados e incorporados a la clasificación.</p>
      }
    }
  `,
})
export class AdminOvercooked implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly modes = [{ training: true }, { training: false }];
  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly results = signal<OcResult[]>([]);
  protected readonly draft = signal<Record<string, number | null>>({});
  protected readonly preview = signal<AllocationRow[] | null>(null);
  protected level = '';
  protected conditions = '';
  protected playersPerTeam: number | null = null;

  protected readonly activeTeams = computed(() => this.store.teams().filter((t) => this.store.players().some((p) => p.team_id === t.id)));

  ngOnInit(): void {
    const cfg = this.store.challenge('overcooked')?.config ?? {};
    this.level = String(cfg['level'] ?? '');
    this.conditions = String(cfg['conditions'] ?? '');
    this.playersPerTeam = (cfg['players_per_team'] as number) ?? null;
    void this.load();
    this.live.watch(['challenges'], () => void this.load(), this.destroyRef);
  }

  async load(): Promise<void> {
    try {
      this.results.set(await this.sb.q<OcResult[]>(this.sb.client.from('overcooked_results').select('*')));
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  key(teamId: string, training: boolean): string {
    return `${training ? 't' : 'o'}-${teamId}`;
  }
  resultOf(teamId: string, training: boolean): OcResult | undefined {
    return this.results().find((r) => r.team_id === teamId && r.is_training === training);
  }
  setDraft(teamId: string, training: boolean, v: number | null): void {
    this.draft.update((d) => ({ ...d, [this.key(teamId, training)]: v === null || (v as unknown) === '' ? null : Number(v) }));
  }

  async saveConfig(): Promise<void> {
    const c = this.store.challenge('overcooked');
    if (!c) return;
    try {
      await this.sb.rpc('admin_update_challenge_config', {
        p_challenge_id: c.id,
        p_config: { level: this.level.trim(), conditions: this.conditions.trim(), players_per_team: this.playersPerTeam ? Number(this.playersPerTeam) : null },
      });
      this.toast.success('Condiciones guardadas');
      await this.store.loadChallenges();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async saveScore(teamId: string, training: boolean): Promise<void> {
    const v = this.draft()[this.key(teamId, training)];
    if (v == null) return;
    try {
      await this.sb.rpc('admin_overcooked_save_score', { p_team_id: teamId, p_score: v, p_is_training: training, p_notes: '' });
      this.draft.update((d) => { const n = { ...d }; delete n[this.key(teamId, training)]; return n; });
      this.preview.set(null);
      this.toast.success('Puntuación guardada');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async doPreview(): Promise<void> {
    try {
      const r = await this.sb.rpc<{ results: AllocationRow[] }>('admin_overcooked_confirm', { p_dry_run: true });
      this.preview.set(r.results);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async confirmResults(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Confirmar resultados de Overcooked', message: 'Los puntos se sumarán a la clasificación oficial y las puntuaciones quedarán bloqueadas.' }))) return;
    this.busy.set(true);
    try {
      await this.sb.rpc('admin_overcooked_confirm', { p_dry_run: false });
      this.toast.points('Resultados de Overcooked confirmados');
      this.preview.set(null);
      await Promise.all([this.load(), this.store.loadChallenges()]);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
