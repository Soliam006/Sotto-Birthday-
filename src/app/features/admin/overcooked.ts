import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
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

interface RosterRow { team_id: string; player_id: string }
interface RosterMeta { team_id: string; version: number; updated_at: string; updated_by_player: string | null; updated_by_admin: boolean }
interface OcResult { team_id: string; is_training: boolean; score: number; position: number | null; points: number | null; notes: string }

@Component({
  selector: 'app-admin-overcooked',
  imports: [MatIcon, DatePipe, FormsModule, RouterLink, Spinner, ChallengeControls, AllocationPreview],
  template: `
    <a routerLink="/admin/modalities" class="mb-2 inline-block text-xs text-slate-400"><mat-icon>arrow_back</mat-icon> Modalidades</a>
    <app-challenge-controls kind="overcooked" />
    @let ch = store.challenge('overcooked');
    @let confirmed = !!ch?.results_confirmed_at;

    @if (loading()) { <app-spinner /> } @else {
      <section class="card mb-4">
        <h2 class="section-title"><mat-icon>settings</mat-icon> Condiciones comunes</h2>
        <form class="grid gap-3 sm:grid-cols-2" (ngSubmit)="saveConfig()">
          <div><label class="label" for="lvl">Nivel / escenario</label><input id="lvl" class="input" name="level" [(ngModel)]="level" placeholder="Ej.: 1-4" /></div>
          <div><label class="label" for="ppt">Cocineros por equipo</label><input id="ppt" type="number" min="1" max="12" class="input" name="ppt" [(ngModel)]="playersPerTeam" /></div>
          <div class="sm:col-span-2"><label class="label" for="cond">Condiciones</label><textarea id="cond" class="input min-h-16" name="cond" [(ngModel)]="conditions" placeholder="Ej.: modo arcade, 1 intento, sin pausa"></textarea></div>
          <button class="btn-secondary sm:col-span-2" type="submit"><mat-icon>save</mat-icon> Guardar condiciones (visibles para los jugadores)</button>
        </form>
      </section>

      <!-- Cocineros de cada equipo -->
      <section class="card mb-4">
        <h2 class="section-title"><mat-icon>groups</mat-icon> Cocineros de cada equipo</h2>
        @if (!ppt()) {
          <p class="text-sm text-slate-400">Fija primero «Cocineros por equipo» en las condiciones comunes.</p>
        } @else {
          <p class="mb-3 text-xs text-slate-400">Los jugadores pueden elegirlos desde su móvil; aquí lo ves en directo y puedes corregirlo. El orden no importa.</p>
          <div class="grid gap-3 md:grid-cols-2">
            @for (t of activeTeams(); track t.id) {
              @let sel = rosterDraftOf(t.id);
              @let req = required(t.id);
              @let locked = confirmed || !!resultOf(t.id, false);
              <div class="rounded-xl border border-white/5 bg-ink-900 p-3">
                <p class="mb-1 flex items-center gap-2 font-semibold">
                  <span class="size-3 rounded-full" [style.background]="t.color"></span>{{ t.name }}
                  <span class="chip ml-auto" [class]="serverRosterComplete(t.id) ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'">
                    {{ serverRoster(t.id).length }} / {{ req }}
                  </span>
                </p>
                @if (metaOf(t.id); as meta) {
                  <p class="mb-2 text-[11px] text-slate-500">Guardada por {{ meta.updated_by_admin ? 'el juez' : (store.playerById().get(meta.updated_by_player ?? '')?.name ?? 'un jugador') }} · {{ meta.updated_at | date: 'HH:mm' }}</p>
                }
                <div class="flex flex-wrap gap-1.5">
                  @for (p of membersOf(t.id); track p.id) {
                    @let on = sel.includes(p.id);
                    <button type="button" class="chip px-2.5 py-1.5 text-sm" [disabled]="locked" [attr.aria-pressed]="on"
                            [class]="on ? 'bg-amber-400 text-ink-950' : 'bg-white/5 text-slate-300'" (click)="toggleRoster(t.id, p.id)">
                      <mat-icon class="icon-sm">{{ on ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>{{ p.name }}
                    </button>
                  }
                </div>
                @if (locked) {
                  <p class="mt-2 flex items-center gap-1 text-[11px] text-slate-500"><mat-icon class="icon-xs">lock</mat-icon> Ya ha jugado la partida oficial (borra su puntuación para cambiarla).</p>
                } @else {
                  @if (dirtyTeams().has(t.id)) { <p class="mt-2 text-[11px] text-amber-300">Cambios sin guardar</p> }
                  <button class="btn-secondary btn-sm mt-2 w-full" [disabled]="sel.length !== req" (click)="saveRoster(t.id)">
                    Guardar cocineros ({{ sel.length }}/{{ req }})
                  </button>
                }
              </div>
            }
          </div>
        }
      </section>

      @for (mode of modes; track mode.training) {
        <section class="card mb-4" [class.opacity-80]="mode.training">
          <h2 class="section-title">@if (mode.training) { <mat-icon class="text-sky-300">science</mat-icon> Partida de entrenamiento (no puntúa) } @else { 🏆 Partida oficial }</h2>
          <div class="flex flex-col gap-2">
            @for (t of activeTeams(); track t.id) {
              @let r = resultOf(t.id, mode.training);
              <div class="flex items-center gap-2">
                <span class="size-3 shrink-0 rounded-full" [style.background]="t.color"></span>
                <span class="min-w-0 flex-1">
                  <span class="block truncate font-semibold">{{ t.name }}</span>
                  @if (!mode.training && serverRoster(t.id).length) {
                    <span class="block truncate text-[11px] text-slate-500">{{ rosterNames(t.id) }}</span>
                  }
                </span>
                @if (!mode.training && !confirmed && !r && !serverRosterComplete(t.id)) {
                  <span class="chip bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">groups</mat-icon> Faltan cocineros</span>
                } @else if (!mode.training && confirmed) {
                  <span class="font-display text-2xl">{{ r?.score ?? '—' }}</span>
                  <span class="chip bg-amber-500/15 text-amber-300">{{ r?.position }}º · +{{ r?.points }}</span>
                } @else {
                  <input type="number" min="0" class="input min-h-9 w-28 py-1.5 text-right" placeholder="Puntos"
                         [ngModel]="draft()[key(t.id, mode.training)] ?? r?.score ?? null"
                         (ngModelChange)="setDraft(t.id, mode.training, $event)" [name]="key(t.id, mode.training)" />
                  <button class="btn-secondary btn-sm" (click)="saveScore(t.id, mode.training)"
                          [disabled]="draft()[key(t.id, mode.training)] == null">Guardar</button>
                  @if (r) { <span class="text-emerald-300" title="Guardado"><mat-icon>check</mat-icon></span> }
                }
              </div>
            }
          </div>
        </section>
      }

      @if (!confirmed) {
        <section class="card">
          <h2 class="section-title"><mat-icon>check_circle</mat-icon> Confirmar resultados oficiales</h2>
          @if (preview(); as pv) { <app-allocation-preview [rows]="pv" /> }
          <div class="mt-3 flex gap-2">
            <button class="btn-secondary flex-1" (click)="doPreview()"><mat-icon>visibility</mat-icon> Ver clasificación</button>
            <button class="btn-primary flex-1" [disabled]="!preview() || busy()" (click)="confirmResults()">Confirmar y sumar puntos</button>
          </div>
        </section>
      } @else {
        <p class="rounded-xl bg-emerald-500/10 p-3 text-sm text-emerald-200"><mat-icon>check</mat-icon> Resultados confirmados e incorporados a la clasificación.</p>
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

  // Selección de cocineros: servidor + borradores del juez por equipo
  protected readonly rosters = signal<RosterRow[]>([]);
  protected readonly rosterMeta = signal<RosterMeta[]>([]);
  protected readonly rosterDraft = signal<Record<string, string[]>>({});
  /** Equipos que el juez está editando: no se sobrescriben al llegar datos nuevos */
  protected readonly dirtyTeams = signal<ReadonlySet<string>>(new Set());
  protected readonly ppt = computed(() => Number(this.store.challenge('overcooked')?.config['players_per_team'] ?? 0));

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
      const [results, rosters, meta] = await Promise.all([
        this.sb.q<OcResult[]>(this.sb.client.from('overcooked_results').select('*')),
        this.sb.q<RosterRow[]>(this.sb.client.from('overcooked_rosters').select('team_id, player_id')),
        this.sb.q<RosterMeta[]>(this.sb.client.from('overcooked_roster_meta').select('*')),
      ]);
      this.results.set(results);
      this.rosters.set(rosters);
      this.rosterMeta.set(meta);
      const dirty = this.dirtyTeams();
      this.rosterDraft.update((d) => {
        const next: Record<string, string[]> = {};
        for (const t of this.store.teams()) next[t.id] = dirty.has(t.id) && d[t.id] ? d[t.id] : this.serverRoster(t.id);
        return next;
      });
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  membersOf(teamId: string) {
    return this.store.players().filter((p) => p.team_id === teamId);
  }
  /** Cocineros exigidos: los fijados, o todo el equipo si tiene menos miembros */
  required(teamId: string): number {
    return Math.min(this.ppt(), this.membersOf(teamId).length);
  }
  serverRoster(teamId: string): string[] {
    return this.rosters().filter((r) => r.team_id === teamId).map((r) => r.player_id);
  }
  serverRosterComplete(teamId: string): boolean {
    const ids = this.serverRoster(teamId);
    const req = this.required(teamId);
    return req > 0 && ids.length === req && ids.every((id) => this.store.playerById().get(id)?.team_id === teamId);
  }
  rosterDraftOf(teamId: string): string[] {
    return this.rosterDraft()[teamId] ?? this.serverRoster(teamId);
  }
  rosterNames(teamId: string): string {
    return this.serverRoster(teamId).map((id) => this.store.playerById().get(id)?.name ?? '—').join(', ');
  }
  metaOf(teamId: string): RosterMeta | undefined {
    return this.rosterMeta().find((m) => m.team_id === teamId && m.version > 0);
  }

  toggleRoster(teamId: string, playerId: string): void {
    const cur = this.rosterDraftOf(teamId);
    let next: string[];
    if (cur.includes(playerId)) next = cur.filter((x) => x !== playerId);
    else if (cur.length >= this.required(teamId)) {
      this.toast.info(`Ya hay ${this.required(teamId)} cocineros: quita a alguien antes de añadir a otro.`);
      return;
    } else next = [...cur, playerId];
    this.rosterDraft.update((d) => ({ ...d, [teamId]: next }));
    this.dirtyTeams.update((s) => new Set(s).add(teamId));
  }

  async saveRoster(teamId: string): Promise<void> {
    try {
      await this.sb.rpc('admin_overcooked_set_roster', { p_team_id: teamId, p_player_ids: this.rosterDraftOf(teamId) });
      this.dirtyTeams.update((s) => { const n = new Set(s); n.delete(teamId); return n; });
      this.toast.success(`Cocineros de ${this.store.teamById().get(teamId)?.name} guardados`);
      await this.load();
    } catch (e) {
      this.toast.error(e);
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
