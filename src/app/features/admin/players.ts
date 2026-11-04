import { Component, computed, inject, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { MISSION_STATUS_LABELS, Mission, Player, PlayerSession } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { QrCodeView } from '../../shared/qr-code';
import { Empty, Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';

interface PlayerDetail {
  player: Player;
  code: string | null;
  sessions: PlayerSession[];
  missions: Mission[];
}

@Component({
  selector: 'app-admin-players',
  imports: [FormsModule, DatePipe, Spinner, Empty, QrCodeView],
  template: `
    <div class="mb-4 flex items-end justify-between gap-2">
      <h1 class="title-xl">Participantes</h1>
      <span class="text-sm text-slate-400">{{ store.players().length }} en total</span>
    </div>

    <form class="card mb-4 flex flex-col gap-2 sm:flex-row" (ngSubmit)="add()">
      <input class="input flex-1" name="newName" [(ngModel)]="newName" placeholder="Nombre del participante" maxlength="40" />
      <select class="input sm:w-48" name="newTeam" [(ngModel)]="newTeam">
        <option value="">Sin equipo</option>
        @for (t of store.teams(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
      </select>
      <button class="btn-primary" type="submit" [disabled]="!newName().trim() || busy()">➕ Añadir</button>
    </form>

    <div class="mb-3 flex flex-wrap gap-2">
      <input class="input min-w-0 flex-1" placeholder="🔍 Buscar…" [ngModel]="search()" (ngModelChange)="search.set($event)" name="search" />
      <select class="input w-auto" [ngModel]="filterTeam()" (ngModelChange)="filterTeam.set($event)" name="filterTeam">
        <option value="">Todos</option>
        <option value="none">Sin equipo</option>
        @for (t of store.teams(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
      </select>
      @if (unassignedCount()) {
        <button class="btn-secondary" (click)="autoAssign()">🎲 Repartir {{ unassignedCount() }} sin equipo</button>
      }
    </div>

    @if (!store.loaded()) {
      <app-spinner />
    } @else {
      <ul class="flex flex-col gap-2">
        @for (p of filtered(); track p.id) {
          <li class="card-tight">
            <div class="flex flex-wrap items-center gap-2">
              <button class="flex min-w-0 flex-1 items-center gap-2 text-left" (click)="open(p)">
                <span class="grid size-9 shrink-0 place-items-center rounded-full font-bold text-ink-950"
                      [style.background]="store.teamById().get(p.team_id ?? '')?.color ?? '#475569'">{{ p.name.charAt(0).toUpperCase() }}</span>
                <span class="truncate font-semibold">{{ p.name }}</span>
              </button>
              <select class="input w-40 min-h-9 py-1.5 text-sm" [ngModel]="p.team_id ?? ''" (ngModelChange)="setTeam(p, $event)" [name]="'team-' + p.id">
                <option value="">Sin equipo</option>
                @for (t of store.teams(); track t.id) { <option [value]="t.id">{{ t.name }}</option> }
              </select>
            </div>

            @if (detail()?.player?.id === p.id) {
              @let d = detail()!;
              <div class="mt-3 grid gap-4 border-t border-white/5 pt-3 sm:grid-cols-2">
                <div class="flex flex-col gap-3">
                  <div class="flex gap-2">
                    <input class="input min-h-9 flex-1 py-1.5" [(ngModel)]="editName" name="editName" maxlength="40" />
                    <button class="btn-secondary btn-sm" (click)="rename(p)" [disabled]="editName().trim() === p.name">Renombrar</button>
                  </div>
                  <div>
                    <p class="label">Sesión</p>
                    @if (activeSession(d); as s) {
                      <p class="text-sm text-emerald-300">● Conectado desde {{ s.created_at | date: 'HH:mm' }} ({{ s.method === 'invite' ? 'QR general' : 'código personal' }})</p>
                      <p class="truncate text-xs text-slate-500">Última actividad {{ s.last_seen_at | date: 'HH:mm' }} · {{ s.user_agent }}</p>
                    } @else {
                      <p class="text-sm text-slate-400">○ Sin sesión activa</p>
                    }
                    <button class="btn-secondary btn-sm mt-2" (click)="resetAccess(p)">🔄 Cerrar sesión y generar nuevo QR</button>
                  </div>
                  <div>
                    <p class="label">Misiones ({{ d.missions.length }})</p>
                    @for (m of d.missions; track m.id) {
                      <p class="text-sm"><span class="text-slate-400">{{ missionLabels[m.status] }} ·</span> {{ m.description }}</p>
                    } @empty { <p class="text-sm text-slate-500">Sin misiones asignadas</p> }
                  </div>
                  <button class="btn-ghost btn-sm self-start text-rose-300" (click)="remove(p)">🗑️ Eliminar participante</button>
                </div>
                <div class="flex flex-col items-center gap-2 rounded-xl bg-ink-900 p-3">
                  <p class="label">QR personal de acceso</p>
                  @if (d.code) {
                    <app-qr [text]="personalUrl(d.code)" [size]="180" />
                    <p class="text-center text-xs text-slate-500">Sirve una sola vez para entrar como <b>{{ p.name }}</b> (p. ej. si cambia de móvil). Tras usarlo se genera otro.</p>
                  }
                </div>
              </div>
            }
          </li>
        } @empty {
          <app-empty icon="👥" title="No hay participantes" text="Añádelos aquí o comparte el QR de invitación (Configuración)." />
        }
      </ul>
    }
  `,
})
export class AdminPlayers {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly missionLabels = MISSION_STATUS_LABELS;

  protected readonly newName = signal('');
  protected readonly newTeam = signal('');
  protected readonly search = signal('');
  protected readonly filterTeam = signal('');
  protected readonly busy = signal(false);
  protected readonly detail = signal<PlayerDetail | null>(null);
  protected readonly editName = signal('');

  protected readonly filtered = computed(() => {
    const q = this.search().trim().toLowerCase();
    const f = this.filterTeam();
    return this.store.players().filter(
      (p) => (!q || p.name.toLowerCase().includes(q)) && (!f || (f === 'none' ? !p.team_id : p.team_id === f)),
    );
  });
  protected readonly unassignedCount = computed(() => this.store.players().filter((p) => !p.team_id).length);

  async add(): Promise<void> {
    this.busy.set(true);
    try {
      await this.sb.rpc('admin_create_player', { p_name: this.newName().trim(), p_team_id: this.newTeam() || null });
      this.toast.success(`${this.newName().trim()} añadido`);
      this.newName.set('');
      await this.store.loadPlayers();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.busy.set(false);
    }
  }

  async setTeam(p: Player, teamId: string): Promise<void> {
    const team = this.store.teamById().get(teamId);
    if (p.team_id) {
      const ok = await this.confirm.ask({
        title: 'Cambiar de equipo',
        message: `${p.name} pasará a ${team?.name ?? 'quedar sin equipo'}. Los puntos ya conseguidos se quedan en su equipo anterior.`,
      });
      if (!ok) { await this.store.loadPlayers(); return; }
    }
    try {
      await this.sb.q(this.sb.client.from('players').update({ team_id: teamId || null }).eq('id', p.id).select('id'));
      this.toast.success(`${p.name} → ${team?.name ?? 'sin equipo'}`);
      await this.store.loadPlayers();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async autoAssign(): Promise<void> {
    const teams = this.store.teams();
    if (!teams.length) return;
    const ok = await this.confirm.ask({ title: 'Reparto automático', message: `Se repartirán ${this.unassignedCount()} jugadores entre los equipos con menos integrantes.` });
    if (!ok) return;
    const counts = new Map(teams.map((t) => [t.id, this.store.players().filter((p) => p.team_id === t.id).length]));
    const unassigned = [...this.store.players().filter((p) => !p.team_id)].sort(() => Math.random() - 0.5);
    try {
      for (const p of unassigned) {
        const target = [...counts.entries()].sort((a, b) => a[1] - b[1])[0][0];
        await this.sb.q(this.sb.client.from('players').update({ team_id: target }).eq('id', p.id).select('id'));
        counts.set(target, (counts.get(target) ?? 0) + 1);
      }
      this.toast.success('Jugadores repartidos');
    } catch (e) {
      this.toast.error(e);
    }
    await this.store.loadPlayers();
  }

  async open(p: Player): Promise<void> {
    if (this.detail()?.player.id === p.id) { this.detail.set(null); return; }
    this.editName.set(p.name);
    try {
      const [code, sessions, missions] = await Promise.all([
        this.sb.client.from('player_access_codes').select('code').eq('player_id', p.id).maybeSingle(),
        this.sb.q<PlayerSession[]>(this.sb.client.from('player_sessions').select('*').eq('player_id', p.id).order('created_at', { ascending: false })),
        this.sb.q<Mission[]>(this.sb.client.from('missions').select('*').eq('player_id', p.id).order('assigned_at')),
      ]);
      this.detail.set({ player: p, code: (code.data?.code as string) ?? null, sessions, missions });
    } catch (e) {
      this.toast.error(e);
    }
  }

  activeSession(d: PlayerDetail): PlayerSession | undefined {
    return d.sessions.find((s) => !s.revoked_at);
  }

  personalUrl(code: string): string {
    return `${location.origin}/?p=${code}`;
  }

  async rename(p: Player): Promise<void> {
    try {
      await this.sb.q(this.sb.client.from('players').update({ name: this.editName().trim() }).eq('id', p.id).select('id'));
      this.toast.success('Nombre actualizado');
      await this.store.loadPlayers();
      this.detail.update((d) => (d ? { ...d, player: { ...d.player, name: this.editName().trim() } } : d));
    } catch (e) {
      this.toast.error(e);
    }
  }

  async resetAccess(p: Player): Promise<void> {
    const ok = await this.confirm.ask({
      title: 'Resolver incidencia de acceso',
      message: `Se cerrará la sesión actual de ${p.name} y se generará un QR personal nuevo para que vuelva a entrar.`,
      confirmText: 'Generar nuevo QR',
    });
    if (!ok) return;
    try {
      await this.sb.rpc('admin_reset_player_access', { p_player_id: p.id });
      this.toast.success('Sesión cerrada. Enséñale el nuevo QR.');
      this.detail.set(null);
      await this.open(p);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async remove(p: Player): Promise<void> {
    const ok = await this.confirm.ask({
      title: `¿Eliminar a ${p.name}?`,
      message: 'Solo es posible si no ha participado en duelos, carreras ni tiene misiones o puntos.',
      danger: true,
      confirmText: 'Eliminar',
    });
    if (!ok) return;
    try {
      await this.sb.q(this.sb.client.from('players').delete().eq('id', p.id).select('id'));
      this.toast.success('Participante eliminado');
      this.detail.set(null);
      await this.store.loadPlayers();
    } catch (e) {
      this.toast.error(e);
    }
  }
}
