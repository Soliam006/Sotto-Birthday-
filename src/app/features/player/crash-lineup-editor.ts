import { Component, computed, inject, input, output } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatIcon } from '@angular/material/icon';
import { PlayerModalities } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { DraftFooter } from '../../shared/draft-footer';
import { VersionedDraft } from '../../shared/versioned-draft';

export interface Member { id: string; name: string }

/**
 * Orden de pilotos del equipo del jugador para Crash Team Racing.
 * - Se edita en local (arrastrar o elegir en el desplegable) y se envía al
 *   pulsar «Guardar», con control de versión (ver VersionedDraft).
 * - Las carreras en pista o ya disputadas quedan bloqueadas.
 */
@Component({
  selector: 'app-crash-lineup-editor',
  imports: [MatIcon, FormsModule, CdkDropList, CdkDrag, CdkDragHandle, DraftFooter],
  template: `
    <section class="rounded-2xl border border-white/10 bg-ink-800/70 p-3">
      <div class="mb-1 flex items-center gap-2">
        <mat-icon class="text-amber-300">format_list_numbered</mat-icon>
        <h3 class="font-semibold">Orden de pilotos de tu equipo</h3>
      </div>
      <p class="mb-3 text-xs text-slate-400">
        Poneos de acuerdo: el piloto 1 corre la carrera 1, y así sucesivamente.
        Arrastra <mat-icon class="icon-xs">drag_indicator</mat-icon> para reordenar o elige en el desplegable.
        Los cambios no se envían hasta pulsar «Guardar».
      </p>

      <ol cdkDropList [cdkDropListSortPredicate]="canDropAt" (cdkDropListDropped)="drop($event)" class="flex flex-col gap-1.5">
        @for (slot of state.draft(); track $index; let i = $index) {
          <li cdkDrag [cdkDragDisabled]="locked()[i] || !crash().can_edit_lineup" cdkDragLockAxis="y"
              class="flex items-center gap-2 rounded-xl border bg-ink-900 px-2 py-1.5"
              [class]="slot === me() ? 'border-amber-400/50' : 'border-white/5'">
            @if (locked()[i] || !crash().can_edit_lineup) {
              <mat-icon class="text-slate-600" [attr.aria-label]="'Carrera ' + (i + 1) + ' bloqueada'">lock</mat-icon>
            } @else {
              <button type="button" cdkDragHandle class="grid size-8 shrink-0 cursor-grab touch-none place-items-center rounded-lg text-slate-400 active:cursor-grabbing"
                      [attr.aria-label]="'Arrastrar carrera ' + (i + 1)">
                <mat-icon>drag_indicator</mat-icon>
              </button>
            }
            <div class="w-20 shrink-0 leading-tight">
              <p class="text-sm font-semibold">Carrera {{ i + 1 }}</p>
              <p class="truncate text-[11px] text-slate-500">{{ trackOf(i) }}</p>
            </div>
            <select class="input min-h-9 flex-1 py-1.5 text-sm" [ngModel]="slot" (ngModelChange)="choose(i, $event)"
                    [disabled]="locked()[i] || !crash().can_edit_lineup" [attr.aria-label]="'Piloto de la carrera ' + (i + 1)">
              <option value="">— Elige piloto —</option>
              @for (m of members(); track m.id) { <option [value]="m.id">{{ m.name }}{{ m.id === me() ? ' (tú)' : '' }}</option> }
            </select>
          </li>
        }
      </ol>

      @if (validation(); as v) { <p class="mt-2 text-xs text-amber-300">{{ v }}</p> }

      <app-draft-footer [draft]="state" [updatedBy]="crash().lineup_updated_by" [updatedAt]="crash().lineup_updated_at"
                        [valid]="!validation()" [enabled]="crash().can_edit_lineup" (save)="save()" />
    </section>
  `,
})
export class CrashLineupEditor {
  readonly crash = input.required<PlayerModalities['crash']>();
  readonly members = input.required<Member[]>();
  readonly me = input<string | null | undefined>(null);
  /** Pide al padre que recargue los datos del servidor */
  readonly reload = output<void>();

  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  /** player_id por carrera ('' = sin elegir) */
  protected readonly serverDraft = computed(() => {
    const c = this.crash();
    return Array.from({ length: c.race_count }, (_, i) => c.lineup.find((l) => l.slot === i + 1)?.player_id ?? '');
  });
  protected readonly state = new VersionedDraft(() => ({ ids: this.serverDraft(), version: this.crash().lineup_version }), true);

  /** Carreras en pista o disputadas: su piloto no se puede cambiar */
  protected readonly locked = computed(() =>
    Array.from({ length: this.crash().race_count }, (_, i) => {
      const r = this.crash().races.find((x) => !x.is_training && x.race_number === i + 1);
      return r?.status === 'finished' || r?.status === 'in_progress';
    }),
  );
  protected readonly validation = computed(() => {
    const d = this.state.draft();
    if (d.some((x) => !x)) return 'Elige un piloto para cada carrera.';
    if (this.members().length >= d.length && new Set(d).size !== d.length) return 'Cada carrera debe tener un piloto distinto.';
    return '';
  });

  /** Solo se puede soltar en posiciones no bloqueadas */
  protected readonly canDropAt = (index: number): boolean => !this.locked()[index];

  trackOf(i: number): string {
    return this.crash().races.find((r) => !r.is_training && r.race_number === i + 1)?.track ?? '';
  }

  drop(e: CdkDragDrop<unknown>): void {
    if (e.previousIndex === e.currentIndex) return;
    const [from, to] = [Math.min(e.previousIndex, e.currentIndex), Math.max(e.previousIndex, e.currentIndex)];
    // Al insertar se desplazan las posiciones intermedias: ninguna puede estar bloqueada
    if (this.locked().slice(from, to + 1).some(Boolean)) {
      this.toast.info('No se puede mover por encima de una carrera en pista o ya disputada.');
      return;
    }
    const next = [...this.state.draft()];
    moveItemInArray(next, e.previousIndex, e.currentIndex);
    this.state.set(next);
  }

  /** Elegir un piloto que ya está en otra carrera intercambia ambos puestos */
  choose(i: number, playerId: string): void {
    const next = [...this.state.draft()];
    const other = next.findIndex((x, j) => j !== i && x === playerId && !!playerId);
    if (other >= 0 && this.members().length >= next.length && !this.locked()[other]) next[other] = next[i];
    next[i] = playerId;
    this.state.set(next);
  }

  save(): Promise<void> {
    return this.state.save(
      async (ids, version) =>
        (await this.sb.rpc<{ version: number }>('player_crash_set_lineup', { p_player_ids: ids, p_expected_version: version })).version,
      { toast: this.toast, successMessage: 'Orden guardado. ¡Tu equipo ya lo ve!', reload: () => this.reload.emit() },
    );
  }
}
