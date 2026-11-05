import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { AllocationRow, CrashLineup, CrashRace, CrashResult, Team } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';
import { AllocationPreview } from './allocation-preview';
import { ChallengeControls } from './challenge-controls';

interface EntryRow { team: Team; player_id: string; raw_position: number | null }
interface LineupMeta { team_id: string; version: number; updated_at: string; updated_by_player: string | null; updated_by_admin: boolean }

@Component({
  selector: 'app-admin-crash',
  imports: [MatIcon, DatePipe, FormsModule, RouterLink, Spinner, ChallengeControls, AllocationPreview],
  template: `
    <a routerLink="/admin/modalities" class="mb-2 inline-block text-xs text-slate-400"><mat-icon>arrow_back</mat-icon> Modalidades</a>
    <app-challenge-controls kind="crash" />
    @let ch = store.challenge('crash');
    @let editable = ch?.status === 'pending' || ch?.status === 'preparing';

    @if (loading()) { <app-spinner /> } @else {
      <!-- 1. Configuración de carreras -->
      <section class="card mb-4">
        <h2 class="section-title">1 · Carreras del torneo</h2>
        @if (editable) {
          <div class="mb-3 flex items-center gap-2">
            <label class="label mb-0" for="nraces">Número de carreras</label>
            <input id="nraces" type="number" min="1" max="12" class="input w-24" [ngModel]="trackNames().length"
                   (ngModelChange)="resize($event)" name="nraces" />
          </div>
          <div class="grid gap-2 sm:grid-cols-2">
            @for (t of trackNames(); track $index; let i = $index) {
              <div class="flex items-center gap-2">
                <span class="font-display w-16 text-lg text-slate-400">Carrera {{ i + 1 }}</span>
                <input class="input min-h-9 py-1.5" [ngModel]="t" (ngModelChange)="setTrack(i, $event)" [name]="'track' + i" placeholder="Pista" />
              </div>
            }
          </div>
          <button class="btn-primary btn-sm mt-3" (click)="saveSetup()"><mat-icon>save</mat-icon> Guardar carreras</button>
        } @else {
          <p class="text-sm text-slate-400">{{ officialRaces().length }} carreras oficiales: {{ trackList() }}</p>
        }
      </section>

      <!-- 2. Alineaciones -->
      @if (officialRaces().length) {
        <section class="card mb-4">
          <h2 class="section-title">2 · Alineaciones (orden de pilotos)</h2>
          <p class="mb-1 text-xs text-slate-400">Los propios jugadores pueden ordenar a su equipo desde su móvil; aquí lo ves en directo y puedes corregirlo.</p>
          <p class="mb-3 text-xs text-slate-400">Cada equipo presenta {{ officialRaces().length }} pilotos: el piloto N corre la carrera N.</p>
          <div class="grid gap-3 md:grid-cols-2">
            @for (t of activeTeams(); track t.id) {
              <div class="rounded-xl border border-white/5 bg-ink-900 p-3">
                <p class="mb-2 flex items-center gap-2 font-semibold"><span class="size-3 rounded-full" [style.background]="t.color"></span>{{ t.name }}
                  @if (lineupComplete(t.id)) { <span class="chip ml-auto bg-emerald-500/15 text-emerald-300"><mat-icon>check</mat-icon> Completa</span> }
                </p>
                @if (metaOf(t.id); as meta) {
                  <p class="-mt-1 mb-2 text-[11px] text-slate-500">Guardada por {{ meta.updated_by_admin ? 'el juez' : (store.playerById().get(meta.updated_by_player ?? '')?.name ?? 'un jugador') }} · {{ meta.updated_at | date: 'HH:mm' }}</p>
                }
                @if (dirtyTeams().has(t.id)) { <p class="-mt-1 mb-2 text-[11px] text-amber-300">Cambios sin guardar</p> }
                @for (r of officialRaces(); track r.id; let i = $index) {
                  <div class="mb-1.5 flex items-center gap-2">
                    <span class="w-6 text-sm text-slate-400">{{ i + 1 }}.</span>
                    <select class="input min-h-9 py-1.5 text-sm" [ngModel]="draftLineup()[t.id]?.[i] ?? ''"
                            (ngModelChange)="setLineup(t.id, i, $event)" [name]="'l-' + t.id + '-' + i" [disabled]="r.status === 'finished' || r.status === 'in_progress'">
                      <option value="">— Piloto —</option>
                      @for (p of membersOf(t.id); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                    </select>
                  </div>
                }
                <button class="btn-secondary btn-sm mt-1 w-full" (click)="saveLineup(t)">Guardar alineación</button>
              </div>
            }
          </div>
        </section>
      }

      <!-- 3. Carreras -->
      <section class="mb-4">
        <h2 class="section-title">3 · Resultados por carrera</h2>
        <p class="mb-3 text-xs text-slate-400">Introduce la posición en la que llegó cada piloto en la consola (incluyendo bots). La app calcula automáticamente el orden entre humanos.</p>
        <div class="flex flex-col gap-3">
          @for (r of races(); track r.id) {
            <article class="card" [class.border-emerald-400/40]="r.status === 'in_progress'">
              <div class="mb-3 flex flex-wrap items-center gap-2">
                <h3 class="font-display flex items-center gap-1.5 text-2xl">@if (r.is_training) { <mat-icon class="text-sky-300">science</mat-icon> Entrenamiento } @else { Carrera {{ r.race_number }} }</h3>
                <span class="text-sm text-slate-400">{{ r.track }}</span>
                <span class="ml-auto chip" [class]="r.status === 'finished' ? 'bg-amber-500/15 text-amber-300' : r.status === 'in_progress' ? 'bg-emerald-500/15 text-emerald-300' : 'bg-slate-500/15 text-slate-300'">
                  {{ r.status === 'finished' ? 'Finalizada' : r.status === 'in_progress' ? 'En pista' : 'Pendiente' }}
                </span>
              </div>

              @if (r.status === 'finished') {
                <ul class="flex flex-col gap-1">
                  @for (res of resultsOf(r.id); track res.player_id) {
                    <li class="flex items-center gap-2 text-sm">
                      <span class="font-display w-8 text-xl">{{ res.human_position }}º</span>
                      <span class="size-3 rounded-full" [style.background]="store.teamById().get(res.team_id)?.color"></span>
                      <span class="flex-1">{{ store.playerById().get(res.player_id)?.name }} <span class="text-xs text-slate-500">(llegó {{ res.raw_position }}º)</span></span>
                      <span class="font-display text-lg" [class]="r.is_training ? 'text-slate-500' : 'text-emerald-300'">{{ r.is_training ? '—' : '+' + res.points }}</span>
                    </li>
                  }
                </ul>
                @if (r.is_training) { <button class="btn-ghost btn-sm mt-2" (click)="resetTraining()"><mat-icon>restart_alt</mat-icon> Repetir entrenamiento</button> }
              } @else if (ch?.status === 'in_progress') {
                @if (openRace() === r.id) {
                  <div class="flex flex-col gap-2">
                    @for (e of entries(); track e.team.id; let i = $index) {
                      <div class="flex items-center gap-2">
                        <span class="size-3 shrink-0 rounded-full" [style.background]="e.team.color"></span>
                        <select class="input min-h-9 flex-1 py-1.5 text-sm" [ngModel]="e.player_id" (ngModelChange)="patchEntry(i, { player_id: $event })" [name]="'p' + i">
                          <option value="">{{ r.is_training ? 'No participa' : '— Piloto —' }}</option>
                          @for (p of membersOf(e.team.id); track p.id) { <option [value]="p.id">{{ p.name }}</option> }
                        </select>
                        <input type="number" min="1" max="16" class="input min-h-9 w-20 py-1.5 text-center" placeholder="Pos."
                               [ngModel]="e.raw_position" (ngModelChange)="patchEntry(i, { raw_position: $event })" [name]="'pos' + i" />
                      </div>
                    }
                    @if (preview(); as pv) { <app-allocation-preview [rows]="pv" /> }
                    <div class="flex flex-wrap gap-2">
                      <button class="btn-ghost btn-sm" (click)="openRace.set(null)">Cancelar</button>
                      <button class="btn-secondary btn-sm" (click)="doPreview(r)"><mat-icon>visibility</mat-icon> Calcular</button>
                      <button class="btn-primary btn-sm flex-1" [disabled]="!preview() || busy()" (click)="confirmRace(r)"><mat-icon>check_circle</mat-icon> Confirmar resultado</button>
                    </div>
                  </div>
                } @else {
                  <div class="flex flex-wrap gap-2">
                    @if (r.status === 'pending') { <button class="btn-secondary btn-sm" (click)="setRaceStatus(r, 'in_progress')"><mat-icon>traffic</mat-icon> Marcar en pista</button> }
                    <button class="btn-primary btn-sm" (click)="startEntry(r)"><mat-icon>edit_note</mat-icon> Registrar resultado</button>
                  </div>
                }
              } @else {
                <p class="text-sm text-slate-500">Inicia la modalidad para registrar resultados.</p>
              }
            </article>
          }
        </div>
      </section>

      <!-- Acumulado -->
      @if (totals().length) {
        <section class="card">
          <h2 class="section-title"><mat-icon>sports_score</mat-icon> Puntos acumulados en Crash</h2>
          <ul class="flex flex-col gap-1.5">
            @for (t of totals(); track t.team.id) {
              <li class="flex items-center gap-2"><span class="size-3 rounded-full" [style.background]="t.team.color"></span><span class="flex-1">{{ t.team.name }}</span><span class="font-display text-2xl">{{ t.points }}</span></li>
            }
          </ul>
        </section>
      }
    }
  `,
})
export class AdminCrash implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly races = signal<CrashRace[]>([]);
  protected readonly lineups = signal<CrashLineup[]>([]);
  protected readonly results = signal<CrashResult[]>([]);
  protected readonly trackNames = signal<string[]>(['', '', '', '']);
  protected readonly draftLineup = signal<Record<string, string[]>>({});
  /** Equipos con cambios del juez sin guardar: no se sobrescriben al llegar datos nuevos */
  protected readonly dirtyTeams = signal<ReadonlySet<string>>(new Set());
  protected readonly lineupMeta = signal<LineupMeta[]>([]);
  protected readonly openRace = signal<string | null>(null);
  protected readonly entries = signal<EntryRow[]>([]);
  protected readonly preview = signal<AllocationRow[] | null>(null);

  protected readonly officialRaces = computed(() => this.races().filter((r) => !r.is_training));
  protected readonly trackList = computed(() => this.officialRaces().map((r) => r.track).join(' · '));
  protected readonly activeTeams = computed(() => this.store.teams().filter((t) => this.membersOf(t.id).length > 0));
  protected readonly totals = computed(() =>
    this.store.teams()
      .map((team) => ({ team, points: this.results().filter((r) => r.team_id === team.id && !this.isTraining(r.race_id)).reduce((s, r) => s + r.points, 0) }))
      .filter((t) => this.results().some((r) => r.team_id === t.team.id))
      .sort((a, b) => b.points - a.points),
  );

  ngOnInit(): void {
    void this.load(true);
    this.live.watch(['challenges'], () => void this.load(false), this.destroyRef);
  }

  async load(initial: boolean): Promise<void> {
    try {
      const [races, lineups, results, meta] = await Promise.all([
        this.sb.q<CrashRace[]>(this.sb.client.from('crash_races').select('*').order('race_number')),
        this.sb.q<CrashLineup[]>(this.sb.client.from('crash_lineups').select('*').order('slot')),
        this.sb.q<CrashResult[]>(this.sb.client.from('crash_race_results').select('*').order('human_position')),
        this.sb.q<LineupMeta[]>(this.sb.client.from('crash_lineup_meta').select('*')),
      ]);
      this.lineupMeta.set(meta);
      this.races.set(races);
      this.lineups.set(lineups);
      this.results.set(results);
      if (initial) {
        const official = races.filter((r) => !r.is_training);
        if (official.length) this.trackNames.set(official.map((r) => r.track));
      }
      this.resetDraftLineup();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  /** Adopta la alineación del servidor en los equipos que el juez no está editando */
  private resetDraftLineup(): void {
    const server: Record<string, string[]> = {};
    for (const l of this.lineups()) (server[l.team_id] ??= [])[l.slot - 1] = l.player_id;
    const dirty = this.dirtyTeams();
    this.draftLineup.update((d) => {
      const next: Record<string, string[]> = { ...server };
      for (const teamId of dirty) if (d[teamId]) next[teamId] = d[teamId];
      return next;
    });
  }

  metaOf(teamId: string): LineupMeta | undefined {
    return this.lineupMeta().find((m) => m.team_id === teamId && m.version > 0);
  }

  isTraining(raceId: string): boolean {
    return this.races().find((r) => r.id === raceId)?.is_training ?? false;
  }
  membersOf(teamId: string) {
    return this.store.players().filter((p) => p.team_id === teamId);
  }
  resultsOf(raceId: string): CrashResult[] {
    return this.results().filter((r) => r.race_id === raceId);
  }
  lineupComplete(teamId: string): boolean {
    return this.lineups().filter((l) => l.team_id === teamId).length === this.officialRaces().length;
  }

  resize(n: number): void {
    const count = Math.max(1, Math.min(12, Number(n) || 1));
    this.trackNames.update((t) => Array.from({ length: count }, (_, i) => t[i] ?? ''));
  }
  setTrack(i: number, v: string): void {
    this.trackNames.update((t) => t.map((x, j) => (j === i ? v : x)));
  }

  async saveSetup(): Promise<void> {
    try {
      await this.sb.rpc('admin_crash_setup', { p_tracks: this.trackNames() });
      this.toast.success('Carreras guardadas');
      await Promise.all([this.load(true), this.store.loadChallenges()]);
    } catch (e) {
      this.toast.error(e);
    }
  }

  setLineup(teamId: string, i: number, playerId: string): void {
    this.draftLineup.update((d) => {
      const arr = [...(d[teamId] ?? [])];
      arr[i] = playerId;
      return { ...d, [teamId]: arr };
    });
    this.dirtyTeams.update((s) => new Set(s).add(teamId));
  }

  async saveLineup(t: Team): Promise<void> {
    const ids = Array.from({ length: this.officialRaces().length }, (_, i) => this.draftLineup()[t.id]?.[i] ?? '');
    if (ids.some((x) => !x)) {
      this.toast.error('Selecciona un piloto para cada carrera.');
      return;
    }
    try {
      await this.sb.rpc('admin_crash_set_lineup', { p_team_id: t.id, p_player_ids: ids });
      this.toast.success(`Alineación de ${t.name} guardada`);
      this.dirtyTeams.update((s) => { const n = new Set(s); n.delete(t.id); return n; });
      await this.load(false);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async setRaceStatus(r: CrashRace, status: string): Promise<void> {
    try {
      await this.sb.rpc('admin_crash_set_race_status', { p_race_id: r.id, p_status: status });
      await this.load(false);
    } catch (e) {
      this.toast.error(e);
    }
  }

  startEntry(r: CrashRace): void {
    this.preview.set(null);
    this.entries.set(
      this.activeTeams().map((team) => ({
        team,
        player_id: r.is_training ? '' : (this.lineups().find((l) => l.team_id === team.id && l.slot === r.race_number)?.player_id ?? ''),
        raw_position: null,
      })),
    );
    this.openRace.set(r.id);
  }

  patchEntry(i: number, patch: Partial<EntryRow>): void {
    this.preview.set(null);
    this.entries.update((e) => e.map((x, j) => (j === i ? { ...x, ...patch } : x)));
  }

  private payload(r: CrashRace) {
    const rows = this.entries().filter((e) => e.player_id || !r.is_training);
    return rows.map((e) => ({ player_id: e.player_id || null, raw_position: e.raw_position ? Number(e.raw_position) : null }));
  }

  async doPreview(r: CrashRace): Promise<void> {
    try {
      const res = await this.sb.rpc<{ results: AllocationRow[] }>('admin_crash_record_race', { p_race_id: r.id, p_results: this.payload(r), p_dry_run: true });
      this.preview.set(res.results);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async confirmRace(r: CrashRace): Promise<void> {
    const ok = await this.confirm.ask({
      title: `Confirmar ${r.is_training ? 'entrenamiento' : 'carrera ' + r.race_number}`,
      message: r.is_training ? 'El entrenamiento no otorga puntos.' : 'Los puntos se sumarán a la clasificación oficial. No podrá modificarse (solo compensarse).',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.sb.rpc('admin_crash_record_race', { p_race_id: r.id, p_results: this.payload(r), p_dry_run: false });
      this.toast.points(r.is_training ? 'Entrenamiento registrado' : `Carrera ${r.race_number} registrada`);
      this.openRace.set(null);
      this.preview.set(null);
      await this.load(false);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async resetTraining(): Promise<void> {
    try {
      await this.sb.rpc('admin_crash_reset_training');
      await this.load(false);
    } catch (e) {
      this.toast.error(e);
    }
  }
}
