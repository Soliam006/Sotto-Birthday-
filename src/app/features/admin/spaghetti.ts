import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { syncServerClock } from '../../core/clock';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { AllocationRow, SpaghettiState } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Countdown } from '../../shared/countdown';
import { Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';
import { AllocationPreview } from './allocation-preview';
import { ChallengeControls } from './challenge-controls';
import { SpaghettiHintsAdmin } from './spaghetti-hints-admin';

@Component({
  selector: 'app-admin-spaghetti',
  imports: [MatIcon, FormsModule, RouterLink, Spinner, Countdown, ChallengeControls, AllocationPreview, SpaghettiHintsAdmin],
  template: `
    <a routerLink="/admin/modalities" class="mb-2 inline-block text-xs text-slate-400"><mat-icon>arrow_back</mat-icon> Modalidades</a>
    <app-challenge-controls kind="spaghetti" />
    @let ch = store.challenge('spaghetti');

    @if (!state()) { <app-spinner /> } @else {
      @let s = state()!;
      <div class="grid gap-4 lg:grid-cols-2">
        <!-- Imagen -->
        <section class="card">
          <h2 class="section-title"><mat-icon>image</mat-icon> Imagen de referencia</h2>
          @if (s.reference_image_path) {
            <img [src]="imageUrl(s.reference_image_path)" alt="Referencia" class="mb-3 max-h-72 w-full rounded-xl bg-black object-contain" />
          } @else {
            <p class="mb-3 rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-slate-400">Aún no has subido la imagen</p>
          }
          <label class="btn-secondary w-full cursor-pointer">
            <mat-icon>{{ uploading() ? 'hourglass_top' : s.reference_image_path ? 'swap_horiz' : 'upload' }}</mat-icon>
            {{ uploading() ? 'Subiendo…' : (s.reference_image_path ? 'Sustituir imagen' : 'Subir imagen') }}
            <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" (change)="upload($event)" [disabled]="uploading()" />
          </label>
          @if (s.reference_image_path) {
            <button class="mt-2 w-full" [class]="s.reference_visible ? 'btn-ghost w-full mt-2' : 'btn-primary w-full mt-2'" (click)="toggleVisible(!s.reference_visible)">
              <mat-icon>{{ s.reference_visible ? 'visibility_off' : 'visibility' }}</mat-icon>
              {{ s.reference_visible ? 'Ocultar a los jugadores' : 'Mostrar a todos los jugadores' }}
            </button>
            <p class="mt-1 text-center text-xs" [class]="s.reference_visible ? 'text-emerald-300' : 'text-slate-500'">
              {{ s.reference_visible ? 'Visible en los móviles de los jugadores' : 'Oculta para los jugadores' }}
            </p>
          }
        </section>

        <!-- Cronómetro -->
        <section class="card flex flex-col items-center">
          <h2 class="section-title self-stretch"><mat-icon>timer</mat-icon> Cronómetro global</h2>
          <app-countdown [status]="s.timer_status" [endsAt]="s.ends_at" [pausedMs]="s.paused_remaining_ms" [durationSeconds]="s.duration_seconds" size="lg" />
          <p class="mt-1 text-xs text-slate-500">Sincronizado con el servidor: todos los dispositivos ven el mismo tiempo.</p>
          <div class="mt-4 flex w-full flex-wrap justify-center gap-2">
            @switch (s.timer_status) {
              @case ('running') {
                <button class="btn-secondary" (click)="timer('pause')"><mat-icon>pause</mat-icon> Pausar</button>
                <button class="btn-primary" (click)="timer('finish')"><mat-icon>sports_score</mat-icon> Terminar</button>
                <button class="btn-ghost text-rose-300" (click)="timer('cancel')"><mat-icon>close</mat-icon> Cancelar</button>
              }
              @case ('paused') {
                <button class="btn-success" (click)="timer('resume')"><mat-icon>play_arrow</mat-icon> Reanudar</button>
                <button class="btn-primary" (click)="timer('finish')"><mat-icon>sports_score</mat-icon> Terminar</button>
                <button class="btn-ghost text-rose-300" (click)="timer('cancel')"><mat-icon>close</mat-icon> Cancelar</button>
              }
              @default {
                @if (s.timer_status === 'idle' || s.timer_status === 'cancelled') {
                  <div class="flex items-center gap-2">
                    <input type="number" min="1" max="240" class="input w-20 text-center" [(ngModel)]="minutes" name="min" />
                    <span class="text-sm text-slate-400">min</span>
                  </div>
                  <button class="btn-success" (click)="timer('start')" [disabled]="ch?.status === 'finished'"><mat-icon>play_arrow</mat-icon> Iniciar prueba</button>
                }
                @if (s.timer_status !== 'idle') { <button class="btn-ghost" (click)="timer('reset')"><mat-icon>restart_alt</mat-icon> Reiniciar</button> }
              }
            }
          </div>
        </section>
      </div>

      <app-spaghetti-hints-admin [timer]="s" />

      <!-- Clasificación -->
      <section class="card mt-4">
        <h2 class="section-title">🏆 Clasificación final</h2>
        @if (ch?.results_confirmed_at) {
          <p class="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200"><mat-icon>check</mat-icon> Clasificación confirmada e incorporada a la puntuación.</p>
        } @else {
          <p class="mb-3 text-xs text-slate-400">Asigna la posición de cada equipo. En caso de empate usa la misma posición y salta las siguientes (1, 1, 3…).</p>
          <div class="flex flex-col gap-2">
            @for (t of activeTeams(); track t.id) {
              <div class="flex items-center gap-2">
                <span class="size-3 rounded-full" [style.background]="t.color"></span>
                <span class="flex-1 font-semibold">{{ t.name }}</span>
                <select class="input min-h-9 w-24 py-1.5" [ngModel]="ranking()[t.id] ?? ''" (ngModelChange)="setPos(t.id, $event)" [name]="'pos-' + t.id">
                  <option value="">—</option>
                  @for (n of positions(); track n) { <option [value]="n">{{ n }}º</option> }
                </select>
              </div>
            }
          </div>
          @if (preview(); as pv) { <div class="mt-3"><app-allocation-preview [rows]="pv" /></div> }
          <div class="mt-3 flex gap-2">
            <button class="btn-secondary flex-1" (click)="doPreview()"><mat-icon>visibility</mat-icon> Calcular</button>
            <button class="btn-primary flex-1" [disabled]="!preview() || busy()" (click)="confirmRanking()">Confirmar y sumar puntos</button>
          </div>
        }
      </section>
    }
  `,
})
export class AdminSpaghetti implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<SpaghettiState | null>(null);
  protected readonly uploading = signal(false);
  protected readonly busy = signal(false);
  protected readonly ranking = signal<Record<string, number>>({});
  protected readonly preview = signal<AllocationRow[] | null>(null);
  protected minutes = 30;

  protected readonly activeTeams = computed(() => this.store.teams().filter((t) => this.store.players().some((p) => p.team_id === t.id)));
  protected readonly positions = computed(() => Array.from({ length: this.activeTeams().length }, (_, i) => i + 1));

  ngOnInit(): void {
    this.minutes = Number(this.store.challenge('spaghetti')?.config['duration_minutes'] ?? 30);
    void this.load();
    this.live.watch(['spaghetti', 'challenges'], () => void this.load(), this.destroyRef);
  }

  async load(): Promise<void> {
    try {
      const t0 = Date.now();
      const [s, now] = await Promise.all([
        this.sb.q<SpaghettiState>(this.sb.client.from('spaghetti_state').select('*').eq('id', 1).single()),
        this.sb.rpc<string>('server_now'),
      ]);
      syncServerClock(now, t0);
      this.state.set(s);
    } catch (e) {
      this.toast.error(e);
    }
  }

  imageUrl(path: string): string {
    return this.sb.publicUrl('references', path);
  }

  async upload(ev: Event): Promise<void> {
    const file = (ev.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { this.toast.error('La imagen supera los 10 MB.'); return; }
    this.uploading.set(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
      const path = `spaghetti/${crypto.randomUUID()}.${ext}`;
      const { error } = await this.sb.client.storage.from('references').upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const old = this.state()?.reference_image_path;
      await this.sb.rpc('admin_spaghetti_set_reference', { p_path: path, p_visible: this.state()?.reference_visible ?? false });
      if (old) await this.sb.client.storage.from('references').remove([old]);
      this.toast.success('Imagen subida');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(false);
      (ev.target as HTMLInputElement).value = '';
    }
  }

  async toggleVisible(v: boolean): Promise<void> {
    try {
      await this.sb.rpc('admin_spaghetti_set_visible', { p_visible: v });
      this.toast.success(v ? 'Imagen visible para todos' : 'Imagen oculta');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async timer(action: 'start' | 'pause' | 'resume' | 'finish' | 'cancel' | 'reset'): Promise<void> {
    const confirmTexts: Partial<Record<typeof action, string>> = {
      start: `¿Iniciar la prueba? El cronómetro de ${this.minutes} minutos arrancará en todos los dispositivos.`,
      finish: '¿Terminar ya la prueba? El tiempo se detendrá para todos.',
      cancel: '¿Cancelar la prueba en curso?',
      reset: '¿Reiniciar el cronómetro?',
    };
    if (confirmTexts[action] && !(await this.confirm.ask({ title: 'Cronómetro', message: confirmTexts[action], danger: action === 'cancel' }))) return;
    try {
      const t0 = Date.now();
      const s = await this.sb.rpc<SpaghettiState & { server_now: string }>('admin_spaghetti_timer', {
        p_action: action,
        p_minutes: action === 'start' || action === 'reset' ? Number(this.minutes) : null,
      });
      syncServerClock(s.server_now, t0);
      this.state.set(s);
      if (action === 'start') await this.store.loadChallenges();
    } catch (e) {
      this.toast.error(e);
    }
  }

  setPos(teamId: string, v: string): void {
    this.preview.set(null);
    this.ranking.update((r) => ({ ...r, [teamId]: Number(v) }));
  }

  private payload() {
    return this.activeTeams().map((t) => ({ team_id: t.id, position: this.ranking()[t.id] || null }));
  }

  async doPreview(): Promise<void> {
    try {
      const r = await this.sb.rpc<{ results: AllocationRow[] }>('admin_spaghetti_confirm', { p_ranking: this.payload(), p_dry_run: true });
      this.preview.set(r.results);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async confirmRanking(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Confirmar clasificación', message: 'Los puntos se sumarán a la clasificación oficial.' }))) return;
    this.busy.set(true);
    try {
      await this.sb.rpc('admin_spaghetti_confirm', { p_ranking: this.payload(), p_dry_run: false });
      this.toast.points('Clasificación de Spaghetti confirmada');
      this.preview.set(null);
      await this.store.loadChallenges();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }
}
