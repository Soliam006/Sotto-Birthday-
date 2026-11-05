import { Component, DestroyRef, OnInit, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { MISSION_STATUS_LABELS, Mission, MissionDiscovery } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { Empty, Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';
import { ChallengeControls } from './challenge-controls';

const IDEAS = [
  'Conseguir que alguien diga la frase «¡Qué fuerte!»',
  'Chocar los cinco con tres personas diferentes',
  'Conseguir que alguien te cuente una anécdota de su infancia',
  'Conseguir que alguien cante un estribillo',
  'Conseguir que alguien te pregunte la hora',
  'Convencer a alguien para que participe en un duelo',
  'Conseguir que alguien te dé las gracias',
  'Hacerte una foto con tres personas de otros equipos',
];

@Component({
  selector: 'app-admin-missions',
  imports: [MatIcon, FormsModule, DatePipe, Spinner, Empty, ChallengeControls],
  template: `
    <app-challenge-controls kind="missions" />

    @if (loading()) { <app-spinner /> } @else {
      <!-- Pendientes -->
      <section class="mb-6">
        <h2 class="section-title"><mat-icon>hourglass_top</mat-icon> Pendientes de validar ({{ claimed().length }})</h2>
        <div class="flex flex-col gap-3">
          @for (m of claimed(); track m.id) {
            <article class="card border-amber-400/30">
              <div class="mb-1 flex items-center gap-2 text-sm">
                <span class="size-3 rounded-full" [style.background]="store.teamOf(m.player_id)?.color"></span>
                <b>{{ playerName(m.player_id) }}</b><span class="text-slate-500">· {{ m.claimed_at | date: 'HH:mm' }}</span>
                <span class="ml-auto font-display text-xl text-amber-300">+{{ m.reward }}</span>
              </div>
              <p class="font-medium">{{ m.description }}</p>
              <p class="mt-2 rounded-lg bg-white/5 p-2 text-sm text-slate-300"><mat-icon>chat_bubble</mat-icon> {{ m.claim_note }}</p>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button class="btn-danger" (click)="review(m, false)"><mat-icon>close</mat-icon> Rechazar</button>
                <button class="btn-success" (click)="review(m, true)"><mat-icon>check</mat-icon> Validar</button>
              </div>
            </article>
          } @empty { <p class="text-sm text-slate-500">No hay misiones pendientes.</p> }
        </div>
      </section>

      <section class="mb-6">
        <h2 class="section-title"><mat-icon>target</mat-icon> Acusaciones pendientes ({{ pendingDiscoveries().length }})</h2>
        <div class="flex flex-col gap-3">
          @for (d of pendingDiscoveries(); track d.id) {
            <article class="card border-violet-400/30">
              <p class="text-sm"><b>{{ playerName(d.accuser_player_id) }}</b> <span class="text-slate-400">({{ store.teamOf(d.accuser_player_id)?.name }})</span> acusa a
                <b>{{ playerName(d.accused_player_id) }}</b> <span class="text-slate-400">({{ store.teamOf(d.accused_player_id)?.name }})</span></p>
              <p class="mt-2 rounded-lg bg-white/5 p-2 text-sm"><mat-icon>record_voice_over</mat-icon> «{{ d.guess }}»</p>
              <p class="label mt-3">Misiones de {{ playerName(d.accused_player_id) }}</p>
              <div class="flex flex-col gap-1.5">
                @for (m of missionsOf(d.accused_player_id); track m.id) {
                  <label class="flex items-start gap-2 rounded-lg bg-ink-800 p-2 text-sm" [class.opacity-50]="!discoverable(m)">
                    <input type="radio" [name]="'disc-' + d.id" [value]="m.id" [disabled]="!discoverable(m)"
                           [checked]="discoveryPick()[d.id] === m.id" (change)="pick(d.id, m.id)" class="mt-1" />
                    <span class="flex-1">{{ m.description }} <span class="text-xs text-slate-500">({{ labels[m.status] }})</span></span>
                  </label>
                } @empty { <p class="text-sm text-slate-500">No tiene misiones asignadas.</p> }
              </div>
              <div class="mt-3 grid grid-cols-2 gap-2">
                <button class="btn-secondary" (click)="resolve(d, false)"><mat-icon>cancel</mat-icon> Incorrecta</button>
                <button class="btn-success" [disabled]="!discoveryPick()[d.id]" (click)="resolve(d, true)"><mat-icon>target</mat-icon> ¡Acierto! +5</button>
              </div>
            </article>
          } @empty { <p class="text-sm text-slate-500">No hay acusaciones pendientes.</p> }
        </div>
      </section>

      <!-- Crear -->
      <section class="card mb-6">
        <h2 class="section-title"><mat-icon>add</mat-icon> Asignar misión</h2>
        <form class="grid gap-3" (ngSubmit)="create()">
          <select class="input" name="player" [(ngModel)]="newPlayer">
            <option value="">Selecciona un jugador…</option>
            @for (p of store.players(); track p.id) {
              <option [value]="p.id">{{ p.name }} ({{ countOf(p.id) }}/{{ limit() }})</option>
            }
          </select>
          <textarea class="input min-h-20" name="desc" [(ngModel)]="newDesc" maxlength="500" placeholder="Descripción de la misión secreta"></textarea>
          <div class="flex flex-wrap gap-1.5">
            @for (i of ideas; track i) { <button type="button" class="chip bg-white/5 text-slate-300 hover:bg-white/10" (click)="newDesc.set(i)"><mat-icon>lightbulb</mat-icon> {{ i }}</button> }
          </div>
          <div class="flex items-center gap-2">
            <label class="label mb-0" for="reward">Recompensa</label>
            <input id="reward" type="number" min="0" max="100" class="input w-24" name="reward" [(ngModel)]="newReward" />
            <button class="btn-primary flex-1" type="submit" [disabled]="!newPlayer() || newDesc().trim().length < 3">Asignar</button>
          </div>
        </form>
      </section>

      <!-- Todas -->
      <section class="mb-6">
        <h2 class="section-title"><mat-icon>list_alt</mat-icon> Todas las misiones ({{ missions().length }})
          <button class="btn-secondary btn-sm font-sans" (click)="toggleReveal()"><mat-icon>{{ store.settings()?.missions_revealed ? 'visibility_off' : 'campaign' }}</mat-icon>
            {{ store.settings()?.missions_revealed ? 'Ocultar a jugadores' : 'Revelar a todos' }}</button>
        </h2>
        <div class="flex flex-col gap-2">
          @for (m of missions(); track m.id) {
            <article class="card-tight text-sm">
              <div class="flex items-center gap-2">
                <span class="size-3 rounded-full" [style.background]="store.teamOf(m.player_id)?.color"></span>
                <b>{{ playerName(m.player_id) }}</b>
                <span class="ml-auto chip bg-white/5">{{ labels[m.status] }}</span>
              </div>
              @if (editing() === m.id) {
                <div class="mt-2 flex flex-col gap-2">
                  <textarea class="input min-h-16" [(ngModel)]="editDesc" name="ed"></textarea>
                  <div class="flex gap-2"><input type="number" class="input w-24" [(ngModel)]="editReward" name="er" />
                    <button class="btn-ghost btn-sm" (click)="editing.set(null)">Cancelar</button>
                    <button class="btn-primary btn-sm flex-1" (click)="saveEdit(m)">Guardar</button></div>
                </div>
              } @else {
                <p class="mt-1">{{ m.description }} <span class="text-amber-300">+{{ m.reward }}</span></p>
                @if (m.status !== 'validated' && m.status !== 'discovered') {
                  <div class="mt-1 flex gap-1">
                    <button class="btn-ghost btn-sm" (click)="startEdit(m)"><mat-icon>edit</mat-icon> Editar</button>
                    <button class="btn-ghost btn-sm text-rose-300" (click)="remove(m)"><mat-icon>delete</mat-icon> Eliminar</button>
                  </div>
                }
              }
            </article>
          } @empty { <app-empty icon="mystery" title="Sin misiones" text="Asigna misiones secretas a los jugadores." /> }
        </div>
      </section>

      @if (resolvedDiscoveries().length) {
        <section>
          <h2 class="section-title"><mat-icon>history</mat-icon> Acusaciones resueltas</h2>
          @for (d of resolvedDiscoveries(); track d.id) {
            <p class="mb-1 text-sm text-slate-400"><mat-icon [class]="d.status === 'correct' ? 'text-emerald-300' : 'text-rose-300'">{{ d.status === 'correct' ? 'target' : 'cancel' }}</mat-icon> {{ playerName(d.accuser_player_id) }} <mat-icon>arrow_forward</mat-icon> {{ playerName(d.accused_player_id) }}: «{{ d.guess }}»</p>
          }
        </section>
      }
    }
  `,
})
export class AdminMissions implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);
  protected readonly labels = MISSION_STATUS_LABELS;
  protected readonly ideas = IDEAS;

  protected readonly loading = signal(true);
  protected readonly missions = signal<Mission[]>([]);
  protected readonly discoveries = signal<MissionDiscovery[]>([]);
  protected readonly discoveryPick = signal<Record<string, string>>({});
  protected readonly newPlayer = signal('');
  protected readonly newDesc = signal('');
  protected readonly newReward = signal(5);
  protected readonly editing = signal<string | null>(null);
  protected readonly editDesc = signal('');
  protected readonly editReward = signal(5);

  protected readonly claimed = computed(() => this.missions().filter((m) => m.status === 'claimed'));
  protected readonly pendingDiscoveries = computed(() => this.discoveries().filter((d) => d.status === 'pending'));
  protected readonly resolvedDiscoveries = computed(() => this.discoveries().filter((d) => d.status !== 'pending'));
  protected readonly limit = computed(() => Number(this.store.challenge('missions')?.config['limit_per_player'] ?? 3));

  ngOnInit(): void {
    this.newReward.set(Number(this.store.challenge('missions')?.config['reward_default'] ?? 5));
    void this.load();
    this.live.watch(['missions'], () => void this.load(), this.destroyRef);
  }

  async load(): Promise<void> {
    try {
      const [m, d] = await Promise.all([
        this.sb.q<Mission[]>(this.sb.client.from('missions').select('*').order('assigned_at', { ascending: false })),
        this.sb.q<MissionDiscovery[]>(this.sb.client.from('mission_discoveries').select('*').order('created_at')),
      ]);
      this.missions.set(m);
      this.discoveries.set(d);
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.loading.set(false);
    }
  }

  playerName(id: string): string {
    return this.store.playerById().get(id)?.name ?? '—';
  }
  missionsOf(playerId: string): Mission[] {
    return this.missions().filter((m) => m.player_id === playerId);
  }
  countOf(playerId: string): number {
    return this.missions().filter((m) => m.player_id === playerId && m.status !== 'discovered').length;
  }
  discoverable(m: Mission): boolean {
    return m.status !== 'validated' && m.status !== 'discovered';
  }
  pick(discoveryId: string, missionId: string): void {
    this.discoveryPick.update((p) => ({ ...p, [discoveryId]: missionId }));
  }

  async review(m: Mission, approve: boolean): Promise<void> {
    let note: string | null = '';
    if (!approve) {
      note = await this.confirm.prompt({ title: 'Rechazar misión', message: 'El jugador podrá volver a intentarlo.', danger: true, confirmText: 'Rechazar', prompt: { label: 'Motivo para el jugador (opcional)' } });
      if (note === null) return;
    } else if (!(await this.confirm.ask({ title: 'Validar misión', message: `+${m.reward} puntos para ${this.store.teamOf(m.player_id)?.name}.` }))) {
      return;
    }
    try {
      await this.sb.rpc('admin_review_mission', { p_mission_id: m.id, p_approve: approve, p_note: note });
      approve ? this.toast.points(`Misión validada: +${m.reward}`) : this.toast.success('Misión rechazada');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async resolve(d: MissionDiscovery, correct: boolean): Promise<void> {
    const ok = await this.confirm.ask({
      title: correct ? 'Acusación correcta' : 'Acusación incorrecta',
      message: correct ? `La misión quedará descubierta y ${this.store.teamOf(d.accuser_player_id)?.name} suma 5 puntos.` : 'No se otorgan puntos ni penalización.',
    });
    if (!ok) return;
    try {
      await this.sb.rpc('admin_resolve_discovery', { p_discovery_id: d.id, p_correct: correct, p_mission_id: correct ? this.discoveryPick()[d.id] : null, p_note: null });
      correct ? this.toast.points('¡Misión descubierta! +5') : this.toast.success('Acusación resuelta');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async create(): Promise<void> {
    try {
      await this.sb.rpc('admin_create_mission', { p_player_id: this.newPlayer(), p_description: this.newDesc().trim(), p_reward: Number(this.newReward()) });
      this.toast.success(`Misión asignada a ${this.playerName(this.newPlayer())}`);
      this.newDesc.set('');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  startEdit(m: Mission): void {
    this.editing.set(m.id);
    this.editDesc.set(m.description);
    this.editReward.set(m.reward);
  }
  async saveEdit(m: Mission): Promise<void> {
    try {
      await this.sb.rpc('admin_update_mission', { p_mission_id: m.id, p_description: this.editDesc().trim(), p_reward: Number(this.editReward()) });
      this.editing.set(null);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }
  async remove(m: Mission): Promise<void> {
    if (!(await this.confirm.ask({ title: '¿Eliminar misión?', message: m.description, danger: true, confirmText: 'Eliminar' }))) return;
    try {
      await this.sb.rpc('admin_delete_mission', { p_mission_id: m.id });
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async toggleReveal(): Promise<void> {
    const next = !this.store.settings()?.missions_revealed;
    if (!(await this.confirm.ask({ title: next ? 'Revelar misiones' : 'Ocultar misiones', message: next ? 'Todos los jugadores podrán ver las misiones de todos.' : 'Las misiones volverán a ser privadas.' }))) return;
    try {
      await this.sb.q(this.sb.client.from('competition_settings').update({ missions_revealed: next }).eq('id', 1).select('id'));
      await this.store.loadSettings();
    } catch (e) {
      this.toast.error(e);
    }
  }
}
