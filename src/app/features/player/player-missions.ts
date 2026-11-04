import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { MISSION_STATUS_LABELS, Mission, MissionDiscovery, MissionStatus, Player, Team } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Empty, ErrorBox, Spinner, TeamDot } from '../../shared/ui';
import { PlayerStore } from './player-store';

interface RevealedMission { player: string; team: string; color: string; description: string; status: MissionStatus }

@Component({
  selector: 'app-player-missions',
  imports: [FormsModule, Spinner, Empty, ErrorBox, TeamDot],
  template: `
    <h1 class="title-lg mb-1">Mis misiones</h1>
    <p class="mb-4 text-sm text-slate-400">🤐 Son secretas: solo tú y el juez podéis verlas.</p>

    @if (loading()) {
      <app-spinner />
    } @else if (error()) {
      <app-error-box [message]="error()"><button class="btn-secondary btn-sm" (click)="load()">Reintentar</button></app-error-box>
    } @else {
      <section class="mb-6 flex flex-col gap-3">
        @for (m of missions(); track m.id; let i = $index) {
          <article class="card animate-rise" [style.animation-delay.ms]="i * 60"
                   [class.opacity-60]="m.status === 'discovered'">
            <div class="mb-2 flex items-center justify-between gap-2">
              <span class="chip" [class]="statusClass(m.status)">{{ labels[m.status] }}</span>
              <span class="font-display text-xl text-amber-300">+{{ m.reward }} pts</span>
            </div>
            <p class="text-base font-medium">{{ m.description }}</p>
            @if (m.claim_note && m.status !== 'assigned') {
              <p class="mt-2 rounded-lg bg-white/5 p-2 text-xs text-slate-400">Tu explicación: {{ m.claim_note }}</p>
            }
            @if (m.judge_note) { <p class="mt-2 rounded-lg bg-violet-500/10 p-2 text-xs text-violet-200">Juez: {{ m.judge_note }}</p> }
            @if (m.status === 'assigned' || m.status === 'rejected') {
              @if (claiming() === m.id) {
                <form class="mt-3 flex flex-col gap-2" (ngSubmit)="claim(m)">
                  <label class="label" [for]="'note-' + m.id">¿Cómo la has conseguido?</label>
                  <textarea [id]="'note-' + m.id" name="note" class="input min-h-20" maxlength="500" [(ngModel)]="note"
                            placeholder="Ej.: Conseguí que Marta cantara en la cocina"></textarea>
                  <div class="flex gap-2">
                    <button type="button" class="btn-ghost flex-1" (click)="claiming.set(null)">Cancelar</button>
                    <button type="submit" class="btn-success flex-1" [disabled]="note().trim().length < 3 || busy()">Enviar al juez</button>
                  </div>
                </form>
              } @else {
                <button class="btn-primary mt-3 w-full" (click)="claiming.set(m.id); note.set('')">✅ ¡La he completado!</button>
              }
            }
          </article>
        } @empty {
          <app-empty icon="🕵️" title="Aún no tienes misiones" text="El juez te asignará tus misiones secretas. ¡Atento!" />
        }
      </section>

      <section class="mb-6">
        <h2 class="section-title">🔎 Desenmascarar a alguien</h2>
        <form class="card flex flex-col gap-3" (ngSubmit)="accuse()">
          <p class="text-sm text-slate-300">¿Crees que un rival está cumpliendo una misión? Si aciertas, tu equipo gana <b>5 puntos</b>. Fallar no penaliza.</p>
          <div>
            <label class="label" for="accused">Sospechoso</label>
            <select id="accused" name="accused" class="input" [(ngModel)]="accused">
              <option value="">Elige un jugador…</option>
              @for (p of rivals(); track p.id) { <option [value]="p.id">{{ p.name }} · {{ teamName(p.team_id) }}</option> }
            </select>
          </div>
          <div>
            <label class="label" for="guess">¿Qué misión crees que está haciendo?</label>
            <textarea id="guess" name="guess" class="input min-h-20" maxlength="500" [(ngModel)]="guess"
                      placeholder="Ej.: Intenta que alguien cuente una anécdota"></textarea>
          </div>
          <button type="submit" class="btn-secondary" [disabled]="!accused() || guess().trim().length < 3 || busy()">🎯 Enviar acusación</button>
        </form>
        @if (discoveries().length) {
          <ul class="mt-3 flex flex-col gap-2">
            @for (d of discoveries(); track d.id) {
              <li class="card-tight flex items-start gap-3 text-sm">
                <span class="text-lg">{{ d.status === 'correct' ? '🎯' : d.status === 'incorrect' ? '❌' : '⏳' }}</span>
                <div class="min-w-0 flex-1">
                  <p class="font-semibold">{{ playerName(d.accused_player_id) }}</p>
                  <p class="text-slate-400">{{ d.guess }}</p>
                  @if (d.judge_note) { <p class="mt-1 text-xs text-violet-200">Juez: {{ d.judge_note }}</p> }
                </div>
                <span class="text-xs text-slate-400">{{ d.status === 'correct' ? '¡Acierto! +5' : d.status === 'incorrect' ? 'Fallo' : 'Pendiente' }}</span>
              </li>
            }
          </ul>
        }
      </section>

      @if (revealed(); as rv) {
        <section class="mb-6">
          <h2 class="section-title">📜 Todas las misiones (reveladas)</h2>
          <ul class="flex flex-col gap-2">
            @for (r of rv; track $index) {
              <li class="card-tight text-sm">
                <div class="mb-1 flex items-center justify-between"><app-team-dot [color]="r.color" [name]="r.player" />
                  <span class="text-xs text-slate-400">{{ labels[r.status] }}</span></div>
                <p class="text-slate-300">{{ r.description }}</p>
              </li>
            }
          </ul>
        </section>
      }
    }
  `,
})
export class PlayerMissions implements OnInit {
  private readonly sb = inject(SupabaseService);
  private readonly live = inject(LiveService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly store = inject(PlayerStore);
  protected readonly labels = MISSION_STATUS_LABELS;

  protected readonly loading = signal(true);
  protected readonly error = signal('');
  protected readonly busy = signal(false);
  protected readonly missions = signal<Mission[]>([]);
  protected readonly discoveries = signal<MissionDiscovery[]>([]);
  protected readonly players = signal<Player[]>([]);
  protected readonly teams = signal<Team[]>([]);
  protected readonly revealed = signal<RevealedMission[] | null>(null);
  protected readonly claiming = signal<string | null>(null);
  protected readonly note = signal('');
  protected readonly accused = signal('');
  protected readonly guess = signal('');

  protected readonly rivals = computed(() => {
    const myTeam = this.store.team()?.id;
    return this.players().filter((p) => p.team_id && p.team_id !== myTeam);
  });

  ngOnInit(): void {
    void this.load();
    this.live.watch(['missions', 'players', 'settings'], () => void this.load(false), this.destroyRef);
  }

  async load(showSpinner = true): Promise<void> {
    if (showSpinner) this.loading.set(true);
    try {
      const prev = this.missions();
      // RLS garantiza que solo se devuelven las misiones propias
      const [missions, discoveries, players, teams, revealed] = await Promise.all([
        this.sb.q<Mission[]>(this.sb.client.from('missions').select('*').order('assigned_at')),
        this.sb.q<MissionDiscovery[]>(this.sb.client.from('mission_discoveries').select('*').order('created_at', { ascending: false })),
        this.sb.q<Player[]>(this.sb.client.from('players').select('id, name, team_id, created_at').order('name')),
        this.sb.q<Team[]>(this.sb.client.from('teams').select('id, name, color, sort_order')),
        this.sb.rpc<RevealedMission[] | null>('get_revealed_missions'),
      ]);
      if (!showSpinner) this.notify(prev, missions);
      this.missions.set(missions);
      this.discoveries.set(discoveries);
      this.players.set(players);
      this.teams.set(teams);
      this.revealed.set(revealed);
      this.error.set('');
    } catch (e) {
      this.error.set((e as Error).message);
    } finally {
      this.loading.set(false);
    }
  }

  private notify(prev: Mission[], next: Mission[]): void {
    for (const m of next) {
      const old = prev.find((x) => x.id === m.id);
      if (!old) { this.toast.info('🕵️ ¡Tienes una nueva misión secreta!'); continue; }
      if (old.status !== m.status) {
        if (m.status === 'validated') this.toast.points(`¡Misión validada! +${m.reward} para tu equipo`);
        if (m.status === 'rejected') this.toast.info('El juez ha rechazado tu misión. Puedes volver a intentarlo.');
        if (m.status === 'discovered') this.toast.info('😱 ¡Te han descubierto una misión!');
      }
    }
  }

  async claim(m: Mission): Promise<void> {
    this.busy.set(true);
    try {
      await this.sb.rpc('claim_mission', { p_mission_id: m.id, p_note: this.note().trim() });
      this.toast.success('Enviada al juez. ¡Pendiente de validación!');
      this.claiming.set(null);
      await this.load(false);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async accuse(): Promise<void> {
    const ok = await this.confirm.ask({
      title: '¿Enviar acusación?',
      message: `Acusas a ${this.playerName(this.accused())} de estar haciendo: «${this.guess().trim()}».`,
      confirmText: 'Acusar',
    });
    if (!ok) return;
    this.busy.set(true);
    try {
      await this.sb.rpc('accuse_player', { p_accused_id: this.accused(), p_guess: this.guess().trim() });
      this.toast.success('Acusación enviada. El juez la revisará.');
      this.accused.set('');
      this.guess.set('');
      await this.load(false);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  playerName(id: string): string {
    return this.players().find((p) => p.id === id)?.name ?? '—';
  }
  teamName(id: string | null): string {
    return this.teams().find((t) => t.id === id)?.name ?? '';
  }
  statusClass(s: string): string {
    return ({
      assigned: 'bg-sky-500/15 text-sky-300',
      claimed: 'bg-amber-500/15 text-amber-300',
      validated: 'bg-emerald-500/15 text-emerald-300',
      rejected: 'bg-rose-500/15 text-rose-300',
      discovered: 'bg-slate-500/20 text-slate-300',
    } as Record<string, string>)[s];
  }
}
