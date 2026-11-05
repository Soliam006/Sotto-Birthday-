import { Component, computed, inject, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { CHALLENGE_ICONS, ChallengeKind, ChallengeStatus } from '../../core/models';
import { ConfirmService } from '../../core/confirm.service';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { StatusBadge } from '../../shared/ui';
import { AdminStore } from './admin-store';

/** Cabecera de modalidad con el control de estado (pendiente → preparación → en curso → finalizada). */
@Component({
  selector: 'app-challenge-controls',
  imports: [MatIcon, StatusBadge],
  template: `
    @if (challenge(); as c) {
      <header class="mb-4">
        <div class="flex items-start gap-3">
          <span class="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink-700 text-amber-300"><mat-icon class="icon-md">{{ icons[c.kind] }}</mat-icon></span>
          <div class="min-w-0 flex-1">
            <p class="text-[11px] uppercase tracking-widest text-slate-400">{{ c.tagline }}</p>
            <h1 class="font-display text-3xl leading-none sm:text-4xl">{{ c.name }}</h1>
          </div>
          <app-status-badge [status]="c.status" />
        </div>
        <div class="mt-3 flex flex-wrap gap-2">
          @if (c.status === 'pending') {
            <button class="btn-secondary btn-sm" (click)="set('preparing')"><mat-icon>build</mat-icon> Pasar a preparación</button>
          }
          @if (c.status === 'pending' || c.status === 'preparing') {
            <button class="btn-success btn-sm" (click)="set('in_progress')"><mat-icon>play_arrow</mat-icon> Iniciar modalidad</button>
          }
          @if (c.status === 'in_progress') {
            <button class="btn-primary btn-sm" (click)="set('finished')"><mat-icon>sports_score</mat-icon> Finalizar modalidad</button>
            <button class="btn-ghost btn-sm" (click)="set('preparing')"><mat-icon>pause</mat-icon> Detener (volver a preparación)</button>
          }
          @if (c.status === 'finished') {
            <button class="btn-ghost btn-sm" (click)="set('in_progress')"><mat-icon>undo</mat-icon> Reabrir</button>
          }
        </div>
      </header>
    }
  `,
})
export class ChallengeControls {
  readonly kind = input.required<ChallengeKind>();
  private readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected readonly icons = CHALLENGE_ICONS;
  protected readonly challenge = computed(() => this.store.challenge(this.kind()));

  async set(status: ChallengeStatus): Promise<void> {
    const c = this.challenge();
    if (!c) return;
    const texts: Record<ChallengeStatus, [string, string]> = {
      pending: ['Volver a pendiente', ''],
      preparing: ['Pasar a preparación', 'Los jugadores verán que la prueba se está preparando.'],
      in_progress: ['Iniciar modalidad', 'La modalidad pasará a EN CURSO y se podrán registrar resultados oficiales.'],
      finished: ['Finalizar modalidad', 'Se comprobará que todos los resultados oficiales están registrados.'],
    };
    const ok = await this.confirm.ask({ title: `${texts[status][0]}: ${c.name}`, message: texts[status][1] });
    if (!ok) return;
    try {
      await this.sb.rpc('admin_set_challenge_status', { p_challenge_id: c.id, p_status: status });
      this.toast.success(`${c.name}: ${texts[status][0].toLowerCase()}`);
      await this.store.loadChallenges();
    } catch (e) {
      this.toast.error(e);
    }
  }
}
