import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { AllocationRow, Duel, DuelFormat, DuelGame, Player } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Empty, Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';
import { AllocationPreview } from './allocation-preview';
import { ChallengeControls } from './challenge-controls';

@Component({
  selector: 'app-admin-duels',
  imports: [MatIcon, FormsModule, DatePipe, Spinner, Empty, ChallengeControls, AllocationPreview],
  template: `
    <app-challenge-controls kind="duels" />
    @let ch = store.challenge('duels');

    @if (!creating()) {
      <button class="btn-primary mb-5 w-full text-base" (click)="openNew()" [disabled]="ch?.status !== 'in_progress'"><mat-icon>add</mat-icon> NUEVO DUELO</button>
      @if (ch?.status !== 'in_progress') { <p class="-mt-3 mb-4 text-center text-xs text-slate-500">Inicia la modalidad para registrar duelos.</p> }
    } @else {
      <!-- Formulario de nuevo duelo -->
      <section class="card mb-5 border-amber-400/30">
        <h2 class="title-md mb-3">Nuevo duelo</h2>
        <div class="grid gap-3">
          <div>
            <p class="label">1 · Juego</p>
            <div class="flex flex-wrap gap-2">
              @for (g of activeGames(); track g.id) {
                <button type="button" class="chip px-3 py-2 text-sm" [class]="gameId() === g.id ? 'bg-amber-400 text-ink-950' : 'bg-white/5 text-slate-200'" (click)="gameId.set(g.id)">{{ g.name }}</button>
              }
            </div>
          </div>
          <div>
            <p class="label">2 · Formato</p>
            <div class="grid grid-cols-2 gap-2">
              <button type="button" class="btn" [class]="format() === '1v1' ? 'btn-primary' : 'btn-secondary'" (click)="setFormat('1v1')"><mat-icon>swords</mat-icon> 1 contra 1</button>
              <button type="button" class="btn" [class]="format() === 'multi' ? 'btn-primary' : 'btn-secondary'" (click)="setFormat('multi')"><mat-icon>group</mat-icon> Multijugador</button>
            </div>
          </div>
          <div>
            <p class="label">3 · Participantes ({{ selected().length }} {{ format() === '1v1' ? '/ 2' : '· mín. 3' }})</p>
            <div class="relative mb-2">
              <mat-icon class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-500">search</mat-icon>
              <input class="input pl-10" placeholder="Buscar jugador…" aria-label="Buscar jugador" [ngModel]="search()" (ngModelChange)="search.set($event)" name="search" />
            </div>
            <div class="grid max-h-64 gap-1.5 overflow-y-auto sm:grid-cols-2">
              @for (p of searchable(); track p.id) {
                @let used = usage(p.id);
                <button type="button" class="flex items-center gap-2 rounded-xl border px-3 py-2 text-left text-sm transition"
                        [class]="isSelected(p.id) ? 'border-amber-400 bg-amber-400/10' : 'border-white/5 bg-ink-800'"
                        [disabled]="!isSelected(p.id) && used >= limit()" (click)="togglePlayer(p)">
                  <span class="size-3 shrink-0 rounded-full" [style.background]="store.teamOf(p.id)?.color"></span>
                  <span class="min-w-0 flex-1 truncate">{{ p.name }}</span>
                  <span class="text-xs" [class]="used >= limit() ? 'text-rose-300' : 'text-slate-500'">{{ used }}/{{ limit() }}</span>
                </button>
              }
            </div>
          </div>
          @if (selected().length) {
            <div>
              <p class="label">4 · Comprobación de equipos</p>
              <ul class="flex flex-wrap gap-2">
                @for (p of selected(); track p.id) {
                  <li class="chip bg-white/5 py-1.5 text-sm"><span class="size-2.5 rounded-full" [style.background]="store.teamOf(p.id)?.color"></span>{{ p.name }} · {{ store.teamOf(p.id)?.name }}</li>
                }
              </ul>
              @if (validation(); as v) { <p class="mt-2 text-sm text-rose-300"><mat-icon>warning</mat-icon> {{ v }}</p> }
            </div>
          }
          <div class="flex gap-2">
            <button class="btn-ghost flex-1" (click)="creating.set(false)">Cancelar</button>
            <button class="btn-success flex-1" [disabled]="!!validation() || !gameId() || busy()" (click)="create()">5 · <mat-icon>play_arrow</mat-icon> Iniciar duelo</button>
          </div>
        </div>
      </section>
    }

    @if (loading()) { <app-spinner /> } @else {
      <!-- Activos -->
      <section class="mb-6">
        <h2 class="section-title"><mat-icon>local_fire_department</mat-icon> Duelos en curso ({{ active().length }})</h2>
        <div class="flex flex-col gap-3">
          @for (d of active(); track d.id) {
            <article class="card border-emerald-400/20">
              <button class="flex w-full items-start gap-3 text-left" (click)="toggleOpen(d)">
                <mat-icon class="icon-lg text-emerald-300">{{ d.format === '1v1' ? 'swords' : 'group' }}</mat-icon>
                <div class="min-w-0 flex-1">
                  <p class="font-display text-2xl leading-tight">{{ gameName(d.game_id) }}</p>
                  <p class="text-xs text-slate-400">{{ d.format === '1v1' ? '1 contra 1' : 'Multijugador' }} · desde {{ d.started_at | date: 'HH:mm' }}</p>
                  <div class="mt-2 flex flex-wrap gap-1.5">
                    @for (dp of d.duel_players; track dp.player_id) {
                      <span class="chip bg-white/5"><span class="size-2.5 rounded-full" [style.background]="store.teamById().get(dp.team_id)?.color"></span>{{ playerName(dp.player_id) }}</span>
                    }
                  </div>
                </div>
                <span class="chip bg-emerald-500/15 text-emerald-300">En curso</span>
              </button>

              @if (openId() === d.id) {
                <div class="mt-4 border-t border-white/5 pt-4">
                  <p class="label">{{ d.format === '1v1' ? 'Selecciona el ganador' : 'Posición final de cada jugador' }}</p>
                  @if (d.format === '1v1') {
                    <div class="grid grid-cols-2 gap-2">
                      @for (dp of d.duel_players; track dp.player_id) {
                        <button class="btn" [class]="winner() === dp.player_id ? 'btn-primary' : 'btn-secondary'" (click)="setWinner(d, dp.player_id)">🏆 {{ playerName(dp.player_id) }}</button>
                      }
                      <button class="btn col-span-2" [class]="winner() === 'draw' ? 'btn-primary' : 'btn-ghost'" (click)="setWinner(d, 'draw')"><mat-icon>handshake</mat-icon> Empate</button>
                    </div>
                  } @else {
                    <div class="flex flex-col gap-2">
                      @for (dp of d.duel_players; track dp.player_id) {
                        <div class="flex items-center gap-2">
                          <span class="size-3 rounded-full" [style.background]="store.teamById().get(dp.team_id)?.color"></span>
                          <span class="flex-1">{{ playerName(dp.player_id) }}</span>
                          <select class="input min-h-9 w-24 py-1.5" [ngModel]="positions()[dp.player_id] ?? ''" (ngModelChange)="setPosition(dp.player_id, $event)" [name]="'pos-' + dp.player_id">
                            <option value="">—</option>
                            @for (n of range(d.duel_players.length); track n) { <option [value]="n">{{ n }}º</option> }
                          </select>
                        </div>
                      }
                      <p class="text-xs text-slate-500">Empates: misma posición y se saltan las siguientes (1, 2, 2, 4).</p>
                    </div>
                  }
                  @if (preview(); as pv) { <div class="mt-3"><app-allocation-preview [rows]="pv" /></div> }
                  <div class="mt-3 flex flex-wrap gap-2">
                    <button class="btn-ghost btn-sm text-rose-300" (click)="cancel(d)"><mat-icon>close</mat-icon> Cancelar duelo</button>
                    <button class="btn-secondary btn-sm" (click)="doPreview(d)"><mat-icon>visibility</mat-icon> Ver resumen</button>
                    <button class="btn-primary btn-sm flex-1" [disabled]="!preview() || busy()" (click)="finish(d)"><mat-icon>sports_score</mat-icon> FINALIZAR DUELO</button>
                  </div>
                </div>
              }
            </article>
          } @empty {
            <app-empty icon="chess" title="No hay duelos en curso" text="Cuando dos o más jugadores quieran retarse, pulsa «Nuevo duelo»." />
          }
        </div>
      </section>

      <!-- Historial -->
      <section class="mb-6">
        <h2 class="section-title"><mat-icon>history</mat-icon> Historial ({{ history().length }})</h2>
        <div class="flex flex-col gap-2">
          @for (d of history(); track d.id) {
            <article class="card-tight text-sm" [class.opacity-60]="d.status !== 'finished'">
              <div class="flex items-center gap-2">
                <span class="font-semibold">{{ gameName(d.game_id) }}</span>
                <span class="text-xs text-slate-500">{{ d.format === '1v1' ? '1v1' : 'Multi' }} · {{ d.finished_at | date: 'HH:mm' }}</span>
                <span class="ml-auto chip" [class]="statusChip(d.status)">{{ statusLabel(d.status) }}</span>
              </div>
              <div class="mt-1.5 flex flex-wrap gap-1.5">
                @for (dp of sortedPlayers(d); track dp.player_id) {
                  <span class="chip bg-white/5">{{ dp.position ? dp.position + 'º ' : '' }}<span class="size-2.5 rounded-full" [style.background]="store.teamById().get(dp.team_id)?.color"></span>{{ playerName(dp.player_id) }}@if (dp.points) {<b class="text-emerald-300"> +{{ dp.points }}</b>}</span>
                }
              </div>
              @if (d.void_reason) { <p class="mt-1 text-xs text-slate-400">Motivo: {{ d.void_reason }}</p> }
              @if (d.status === 'finished') { <button class="btn-ghost btn-sm mt-1 text-rose-300" (click)="voidDuel(d)">Anular (compensa los puntos)</button> }
            </article>
          } @empty { <p class="text-sm text-slate-500">Aún no hay duelos finalizados.</p> }
        </div>
      </section>

      <!-- Juegos -->
      <section class="card">
        <h2 class="section-title"><mat-icon>casino</mat-icon> Juegos puntuables</h2>
        <div class="mb-3 flex flex-wrap gap-2">
          @for (g of games(); track g.id) {
            <button class="chip px-3 py-1.5 text-sm" [class]="g.active ? 'bg-emerald-500/15 text-emerald-200' : 'bg-white/5 text-slate-500 line-through'" (click)="toggleGame(g)">{{ g.name }}</button>
          }
        </div>
        <form class="flex gap-2" (ngSubmit)="addGame()">
          <input class="input flex-1" name="newGame" [(ngModel)]="newGame" placeholder="Añadir juego…" maxlength="60" />
          <button class="btn-secondary" type="submit" [disabled]="!newGame().trim()">Añadir</button>
        </form>
        <p class="mt-2 text-xs text-slate-500">Pulsa un juego para activarlo/desactivarlo. Límite por jugador: {{ limit() }} duelos (configurable en Modalidades).</p>
      </section>
    }
  `,
})
export class AdminDuels implements OnInit {
  readonly nuevo = input<string | undefined>(undefined);
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly duels = signal<Duel[]>([]);
  protected readonly games = signal<DuelGame[]>([]);
  protected readonly creating = signal(false);
  protected readonly gameId = signal('');
  protected readonly format = signal<DuelFormat>('1v1');
  protected readonly selected = signal<Player[]>([]);
  protected readonly search = signal('');
  protected readonly openId = signal<string | null>(null);
  protected readonly winner = signal<string | null>(null);
  protected readonly positions = signal<Record<string, number>>({});
  protected readonly preview = signal<AllocationRow[] | null>(null);
  protected readonly newGame = signal('');

  protected readonly active = computed(() => this.duels().filter((d) => d.status === 'in_progress'));
  protected readonly history = computed(() => this.duels().filter((d) => d.status !== 'in_progress'));
  protected readonly activeGames = computed(() => this.games().filter((g) => g.active));
  protected readonly limit = computed(() => Number(this.store.challenge('duels')?.config['limit_per_player'] ?? 3));
  protected readonly searchable = computed(() => {
    const q = this.search().trim().toLowerCase();
    return this.store.players().filter((p) => p.team_id && (!q || p.name.toLowerCase().includes(q)));
  });
  protected readonly validation = computed(() => {
    const sel = this.selected();
    const teams = new Set(sel.map((p) => p.team_id));
    if (this.format() === '1v1') {
      if (sel.length !== 2) return 'Selecciona exactamente 2 jugadores.';
      if (teams.size !== 2) return 'Los dos jugadores deben ser de equipos diferentes.';
    } else {
      if (sel.length < 3) return 'Selecciona 3 o más jugadores.';
      if (teams.size < 2) return 'Debe haber jugadores de al menos 2 equipos.';
    }
    return '';
  });

  ngOnInit(): void {
    void this.load();
    this.live.watch(['duels', 'challenges'], () => void this.load(), this.destroyRef);
    if (this.nuevo()) this.openNew();
  }

  async load(): Promise<void> {
    try {
      const [duels, games] = await Promise.all([
        this.sb.q<Duel[]>(this.sb.client.from('duels').select('*, duel_players(player_id, team_id, position, points)').order('started_at', { ascending: false })),
        this.sb.q<DuelGame[]>(this.sb.client.from('duel_games').select('*').order('sort_order').order('name')),
      ]);
      this.duels.set(duels);
      this.games.set(games);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  usage(playerId: string): number {
    return this.duels().filter((d) => (d.status === 'in_progress' || d.status === 'finished') && d.duel_players.some((p) => p.player_id === playerId)).length;
  }
  gameName(id: string): string {
    return this.games().find((g) => g.id === id)?.name ?? 'Juego';
  }
  playerName(id: string): string {
    return this.store.playerById().get(id)?.name ?? '—';
  }
  isSelected(id: string): boolean {
    return this.selected().some((p) => p.id === id);
  }
  range(n: number): number[] {
    return Array.from({ length: n }, (_, i) => i + 1);
  }
  sortedPlayers(d: Duel) {
    return [...d.duel_players].sort((a, b) => (a.position ?? 99) - (b.position ?? 99));
  }
  statusLabel(s: string): string {
    return ({ finished: 'Finalizado', cancelled: 'Cancelado', voided: 'Anulado' } as Record<string, string>)[s] ?? s;
  }
  statusChip(s: string): string {
    return s === 'finished' ? 'bg-amber-500/15 text-amber-300' : 'bg-slate-500/20 text-slate-300';
  }

  openNew(): void {
    this.creating.set(true);
    this.selected.set([]);
    this.search.set('');
    this.gameId.set(this.activeGames()[0]?.id ?? '');
  }
  setFormat(f: DuelFormat): void {
    this.format.set(f);
    if (f === '1v1' && this.selected().length > 2) this.selected.set(this.selected().slice(0, 2));
  }
  togglePlayer(p: Player): void {
    if (this.isSelected(p.id)) this.selected.update((s) => s.filter((x) => x.id !== p.id));
    else if (this.format() === '1v1' && this.selected().length >= 2) this.toast.info('En 1 contra 1 solo hay dos jugadores.');
    else this.selected.update((s) => [...s, p]);
  }

  async create(): Promise<void> {
    const names = this.selected().map((p) => p.name).join(' vs ');
    if (!(await this.confirm.ask({ title: 'Iniciar duelo', message: `${this.gameName(this.gameId())}: ${names}` }))) return;
    this.busy.set(true);
    try {
      await this.sb.rpc('admin_create_duel', { p_game_id: this.gameId(), p_format: this.format(), p_player_ids: this.selected().map((p) => p.id), p_notes: '' });
      this.toast.success('Duelo registrado: ¡que empiece la partida!');
      this.creating.set(false);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  toggleOpen(d: Duel): void {
    this.preview.set(null);
    this.winner.set(null);
    this.positions.set({});
    this.openId.set(this.openId() === d.id ? null : d.id);
  }
  setWinner(d: Duel, id: string): void {
    this.preview.set(null);
    this.winner.set(id);
    const pos: Record<string, number> = {};
    for (const dp of d.duel_players) pos[dp.player_id] = id === 'draw' || dp.player_id === id ? 1 : 2;
    this.positions.set(pos);
  }
  setPosition(playerId: string, v: string): void {
    this.preview.set(null);
    this.positions.update((p) => ({ ...p, [playerId]: Number(v) }));
  }
  private payload(d: Duel) {
    return d.duel_players.map((dp) => ({ player_id: dp.player_id, position: this.positions()[dp.player_id] || null }));
  }

  async doPreview(d: Duel): Promise<void> {
    try {
      const r = await this.sb.rpc<{ results: AllocationRow[] }>('admin_finish_duel', { p_duel_id: d.id, p_results: this.payload(d), p_dry_run: true });
      this.preview.set(r.results);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async finish(d: Duel): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Finalizar duelo', message: 'Se asignarán los puntos del resumen y el duelo pasará al historial.' }))) return;
    this.busy.set(true);
    try {
      await this.sb.rpc('admin_finish_duel', { p_duel_id: d.id, p_results: this.payload(d), p_dry_run: false });
      this.toast.points('Duelo finalizado y puntos asignados');
      this.openId.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async cancel(d: Duel): Promise<void> {
    const reason = await this.confirm.prompt({ title: 'Cancelar duelo', message: 'No se asignarán puntos y no contará para el límite.', danger: true, confirmText: 'Cancelar duelo', prompt: { label: 'Motivo (opcional)' } });
    if (reason === null) return;
    try {
      await this.sb.rpc('admin_cancel_duel', { p_duel_id: d.id, p_reason: reason });
      this.toast.success('Duelo cancelado');
      this.openId.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async voidDuel(d: Duel): Promise<void> {
    const reason = await this.confirm.prompt({
      title: 'Anular duelo finalizado',
      message: 'Se generarán movimientos compensatorios que restan los puntos concedidos. Quedará constancia en el historial.',
      danger: true, confirmText: 'Anular', prompt: { label: 'Motivo', required: true },
    });
    if (!reason) return;
    try {
      await this.sb.rpc('admin_void_duel', { p_duel_id: d.id, p_reason: reason });
      this.toast.success('Duelo anulado');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async toggleGame(g: DuelGame): Promise<void> {
    try {
      await this.sb.q(this.sb.client.from('duel_games').update({ active: !g.active }).eq('id', g.id).select('id'));
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async addGame(): Promise<void> {
    try {
      await this.sb.q(this.sb.client.from('duel_games').insert({ name: this.newGame().trim(), sort_order: this.games().length + 1 }).select('id'));
      this.newGame.set('');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }
}
