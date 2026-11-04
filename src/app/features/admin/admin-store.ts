import { Injectable, computed, inject, signal } from '@angular/core';
import { LiveService } from '../../core/live.service';
import { Challenge, ChallengeKind, CompetitionSettings, Player, StandingRow, Team } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';

interface Pending { missions: number; discoveries: number }

/** Catálogos compartidos del panel del juez, sincronizados en directo. */
@Injectable({ providedIn: 'root' })
export class AdminStore {
  private readonly sb = inject(SupabaseService);
  private readonly live = inject(LiveService);
  private readonly toast = inject(ToastService);

  readonly teams = signal<Team[]>([]);
  readonly players = signal<Player[]>([]);
  readonly challenges = signal<Challenge[]>([]);
  readonly settings = signal<CompetitionSettings | null>(null);
  readonly standings = signal<StandingRow[]>([]);
  readonly lastUpdate = signal<string | null>(null);
  readonly pending = signal<Pending>({ missions: 0, discoveries: 0 });
  readonly loaded = signal(false);
  readonly error = signal('');

  readonly teamById = computed(() => new Map(this.teams().map((t) => [t.id, t])));
  readonly playerById = computed(() => new Map(this.players().map((p) => [p.id, p])));

  private subs: (() => void)[] = [];

  start(): void {
    if (this.subs.length) return;
    void this.reloadAll();
    const safe = (fn: () => Promise<void>) => () => void fn().catch((e) => this.error.set((e as Error).message));
    this.subs = [
      this.live.watch(['teams'], safe(() => this.loadTeams())),
      this.live.watch(['players'], safe(() => this.loadPlayers())),
      this.live.watch(['challenges'], safe(() => this.loadChallenges())),
      this.live.watch(['settings'], safe(() => this.loadSettings())),
      this.live.watch(['scores', 'teams'], safe(() => this.loadStandings())),
      this.live.watch(['missions'], safe(() => this.loadPending(true))),
    ];
  }

  stop(): void {
    this.subs.forEach((off) => off());
    this.subs = [];
  }

  async reloadAll(): Promise<void> {
    try {
      await Promise.all([this.loadTeams(), this.loadPlayers(), this.loadChallenges(), this.loadSettings(), this.loadStandings(), this.loadPending(false)]);
      this.error.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loaded.set(true);
    }
  }

  challenge(kind: ChallengeKind): Challenge | undefined {
    return this.challenges().find((c) => c.kind === kind);
  }
  teamOf(playerId: string | null | undefined): Team | undefined {
    const p = playerId ? this.playerById().get(playerId) : undefined;
    return p?.team_id ? this.teamById().get(p.team_id) : undefined;
  }

  async loadTeams(): Promise<void> {
    this.teams.set(await this.sb.q<Team[]>(this.sb.client.from('teams').select('id, name, color, sort_order').order('sort_order').order('name')));
  }
  async loadPlayers(): Promise<void> {
    this.players.set(await this.sb.q<Player[]>(this.sb.client.from('players').select('id, name, team_id, created_at').order('name')));
  }
  async loadChallenges(): Promise<void> {
    this.challenges.set(await this.sb.q<Challenge[]>(this.sb.client.from('challenges').select('*').order('sort_order')));
  }
  async loadSettings(): Promise<void> {
    this.settings.set(await this.sb.q<CompetitionSettings>(this.sb.client.from('competition_settings').select('*').eq('id', 1).single()));
  }
  async loadStandings(): Promise<void> {
    const r = await this.sb.rpc<{ teams: StandingRow[]; last_update: string | null }>('admin_get_standings');
    this.standings.set(r.teams);
    this.lastUpdate.set(r.last_update);
  }
  async loadPending(notify: boolean): Promise<void> {
    const [m, d] = await Promise.all([
      this.sb.client.from('missions').select('id', { count: 'exact', head: true }).eq('status', 'claimed'),
      this.sb.client.from('mission_discoveries').select('id', { count: 'exact', head: true }).eq('status', 'pending'),
    ]);
    const next = { missions: m.count ?? 0, discoveries: d.count ?? 0 };
    const prev = this.pending();
    if (notify && next.missions > prev.missions) this.toast.info('🕵️ Nueva misión pendiente de validar');
    if (notify && next.discoveries > prev.discoveries) this.toast.info('🎯 Nueva acusación pendiente de revisar');
    this.pending.set(next);
  }
}
