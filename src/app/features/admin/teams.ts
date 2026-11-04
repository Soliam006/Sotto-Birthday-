import { Component, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { Team } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { AdminStore } from './admin-store';

const PALETTE = ['#EF4444', '#3B82F6', '#22C55E', '#F97316', '#A855F7', '#EAB308', '#EC4899', '#14B8A6'];

@Component({
  selector: 'app-admin-teams',
  imports: [FormsModule],
  template: `
    <div class="mb-4 flex items-end justify-between">
      <h1 class="title-xl">Equipos</h1>
      <span class="text-sm text-slate-400">{{ store.teams().length }} / 6</span>
    </div>
    @if (store.teams().length < 2) {
      <p class="mb-3 rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">Necesitas al menos 2 equipos para competir.</p>
    }

    <div class="grid gap-3 sm:grid-cols-2">
      @for (t of store.teams(); track t.id) {
        <article class="card relative overflow-hidden">
          <div class="absolute inset-x-0 top-0 h-1.5" [style.background]="t.color"></div>
          @if (editing() === t.id) {
            <form class="flex flex-col gap-3" (ngSubmit)="save(t)">
              <input class="input" name="name" [(ngModel)]="editName" maxlength="40" />
              <div class="flex flex-wrap items-center gap-2">
                @for (c of palette; track c) {
                  <button type="button" class="size-8 rounded-full ring-offset-2 ring-offset-ink-850" [style.background]="c"
                          [class.ring-2]="editColor().toUpperCase() === c" (click)="editColor.set(c)" [attr.aria-label]="'Color ' + c"></button>
                }
                <input type="color" class="size-8 cursor-pointer rounded-full bg-transparent" name="color" [(ngModel)]="editColor" />
              </div>
              <div class="flex gap-2">
                <button type="button" class="btn-ghost flex-1" (click)="editing.set(null)">Cancelar</button>
                <button type="submit" class="btn-primary flex-1">Guardar</button>
              </div>
            </form>
          } @else {
            <div class="flex items-center gap-3">
              <span class="size-12 rounded-2xl" [style.background]="t.color" [style.box-shadow]="'0 0 20px ' + t.color + '88'"></span>
              <div class="min-w-0 flex-1">
                <h2 class="font-display truncate text-2xl">{{ t.name }}</h2>
                <p class="text-xs text-slate-400">{{ members(t.id).length }} integrantes · {{ points(t.id) }} pts</p>
              </div>
              <button class="btn-ghost btn-sm" (click)="edit(t)">✏️</button>
              <button class="btn-ghost btn-sm" (click)="remove(t)" aria-label="Eliminar">🗑️</button>
            </div>
            <p class="mt-3 text-sm text-slate-300">{{ members(t.id).join(', ') || 'Sin integrantes todavía' }}</p>
          }
        </article>
      }
    </div>

    @if (store.teams().length < 6) {
      <form class="card mt-4 flex flex-col gap-3" (ngSubmit)="add()">
        <h2 class="title-md">Nuevo equipo</h2>
        <input class="input" name="newName" [(ngModel)]="newName" placeholder="Nombre del equipo" maxlength="40" />
        <div class="flex flex-wrap items-center gap-2">
          @for (c of freeColors(); track c) {
            <button type="button" class="size-8 rounded-full ring-white ring-offset-2 ring-offset-ink-850" [style.background]="c"
                    [class.ring-2]="newColor() === c" (click)="newColor.set(c)" [attr.aria-label]="'Color ' + c"></button>
          }
          <input type="color" class="size-8 cursor-pointer rounded-full bg-transparent" name="newColor" [(ngModel)]="newColor" />
        </div>
        <button type="submit" class="btn-primary" [disabled]="!newName().trim()">➕ Crear equipo</button>
      </form>
    }
  `,
})
export class AdminTeams {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly palette = PALETTE;
  protected readonly editing = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editColor = signal('#000000');
  protected readonly newName = signal('');
  protected readonly newColor = signal('#A855F7');
  protected readonly freeColors = computed(() => {
    const used = new Set(this.store.teams().map((t) => t.color.toUpperCase()));
    return PALETTE.filter((c) => !used.has(c));
  });

  members(teamId: string): string[] {
    return this.store.players().filter((p) => p.team_id === teamId).map((p) => p.name);
  }
  points(teamId: string): number {
    return this.store.standings().find((s) => s.team_id === teamId)?.points ?? 0;
  }

  edit(t: Team): void {
    this.editing.set(t.id);
    this.editName.set(t.name);
    this.editColor.set(t.color);
  }

  async save(t: Team): Promise<void> {
    try {
      await this.sb.q(this.sb.client.from('teams').update({ name: this.editName().trim(), color: this.editColor().toUpperCase() }).eq('id', t.id).select('id'));
      this.toast.success('Equipo actualizado');
      this.editing.set(null);
      await this.store.loadTeams();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async add(): Promise<void> {
    try {
      const sort = Math.max(0, ...this.store.teams().map((t) => t.sort_order)) + 1;
      await this.sb.q(this.sb.client.from('teams').insert({ name: this.newName().trim(), color: this.newColor().toUpperCase(), sort_order: sort }).select('id'));
      this.toast.success('Equipo creado');
      this.newName.set('');
      this.newColor.set(this.freeColors()[1] ?? '#A855F7');
      await this.store.loadTeams();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async remove(t: Team): Promise<void> {
    const ok = await this.confirm.ask({
      title: `¿Eliminar ${t.name}?`,
      message: 'Sus integrantes quedarán sin equipo. No es posible si el equipo ya tiene puntos o resultados.',
      danger: true,
      confirmText: 'Eliminar',
    });
    if (!ok) return;
    try {
      await this.sb.q(this.sb.client.from('teams').delete().eq('id', t.id).select('id'));
      this.toast.success('Equipo eliminado');
      await Promise.all([this.store.loadTeams(), this.store.loadPlayers()]);
    } catch (e) {
      this.toast.error(e);
    }
  }
}
