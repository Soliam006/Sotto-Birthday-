import { Component, computed, effect, inject, input, output, signal, untracked } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatIcon } from '@angular/material/icon';
import { PlayerModalities } from '../../core/models';
import { AppError, CONFLICT_CODE, SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';

interface Member { id: string; name: string }

/**
 * Orden de pilotos del equipo del jugador para Crash Team Racing.
 * - Se edita en local (arrastrar o elegir en el desplegable): ninguna llamada
 *   al servidor hasta pulsar «Guardar».
 * - Al guardar se envía la versión sobre la que se editó. Si un compañero
 *   guardó antes, el servidor lo rechaza y se carga su orden.
 * - Las carreras en pista o ya disputadas quedan bloqueadas.
 */
@Component({
  selector: 'app-crash-lineup-editor',
  imports: [MatIcon, FormsModule, DatePipe, CdkDropList, CdkDrag, CdkDragHandle],
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

      @if (remoteChanged()) {
        <div class="mb-3 flex items-center gap-2 rounded-xl bg-sky-500/10 p-2 text-xs text-sky-200">
          <mat-icon class="icon-sm">sync</mat-icon>
          <span class="flex-1">{{ crash().lineup_updated_by }} ha guardado otro orden.</span>
          <button type="button" class="btn-ghost btn-sm" (click)="discard()">Ver el nuevo</button>
        </div>
      }

      <ol cdkDropList [cdkDropListSortPredicate]="canDropAt" (cdkDropListDropped)="drop($event)" class="flex flex-col gap-1.5">
        @for (slot of draft(); track $index; let i = $index) {
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

      <div class="mt-3 flex items-center gap-2">
        <p class="min-w-0 flex-1 text-[11px] text-slate-500">
          @if (dirty()) { <span class="text-amber-300">Cambios sin guardar</span> }
          @else if (crash().lineup_updated_by) { Guardado por {{ crash().lineup_updated_by }} · {{ crash().lineup_updated_at | date: 'HH:mm' }} }
          @else { Aún no hay orden guardado }
        </p>
        @if (dirty()) { <button type="button" class="btn-ghost btn-sm" (click)="discard()" [disabled]="busy()">Descartar</button> }
        <button type="button" class="btn-primary btn-sm" (click)="save()" [disabled]="!dirty() || !!validation() || busy() || !crash().can_edit_lineup">
          <mat-icon>save</mat-icon> {{ busy() ? 'Guardando…' : 'Guardar' }}
        </button>
      </div>
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
  protected readonly draft = signal<string[]>([]);
  /** Versión del servidor sobre la que se está editando */
  private readonly baseVersion = signal(0);
  protected readonly dirty = signal(false);
  protected readonly busy = signal(false);

  protected readonly serverDraft = computed(() => {
    const c = this.crash();
    return Array.from({ length: c.race_count }, (_, i) => c.lineup.find((l) => l.slot === i + 1)?.player_id ?? '');
  });
  /** Carreras en pista o disputadas: su piloto no se puede cambiar */
  protected readonly locked = computed(() =>
    Array.from({ length: this.crash().race_count }, (_, i) => {
      const r = this.crash().races.find((x) => !x.is_training && x.race_number === i + 1);
      return r?.status === 'finished' || r?.status === 'in_progress';
    }),
  );
  /** Un compañero guardó mientras yo tenía cambios sin guardar */
  protected readonly remoteChanged = computed(() => this.dirty() && this.crash().lineup_version !== this.baseVersion());
  protected readonly validation = computed(() => {
    const d = this.draft();
    if (d.some((x) => !x)) return 'Elige un piloto para cada carrera.';
    if (this.members().length >= d.length && new Set(d).size !== d.length) return 'Cada carrera debe tener un piloto distinto.';
    return '';
  });

  /** Solo se puede soltar en posiciones no bloqueadas */
  protected readonly canDropAt = (index: number): boolean => !this.locked()[index];

  constructor() {
    // Datos nuevos del servidor: si no hay cambios locales, se adoptan.
    effect(() => {
      const server = this.serverDraft();
      const version = this.crash().lineup_version;
      untracked(() => {
        if (!this.dirty()) {
          this.draft.set(server);
          this.baseVersion.set(version);
        }
      });
    });
  }

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
    const next = [...this.draft()];
    moveItemInArray(next, e.previousIndex, e.currentIndex);
    this.setDraft(next);
  }

  /** Elegir un piloto que ya está en otra carrera intercambia ambos puestos */
  choose(i: number, playerId: string): void {
    const next = [...this.draft()];
    const other = next.findIndex((x, j) => j !== i && x === playerId && !!playerId);
    if (other >= 0 && this.members().length >= next.length && !this.locked()[other]) next[other] = next[i];
    next[i] = playerId;
    this.setDraft(next);
  }

  private setDraft(next: string[]): void {
    this.draft.set(next);
    this.dirty.set(next.join() !== this.serverDraft().join() || this.crash().lineup_version !== this.baseVersion());
  }

  discard(): void {
    this.dirty.set(false);
    this.draft.set(this.serverDraft());
    this.baseVersion.set(this.crash().lineup_version);
  }

  async save(): Promise<void> {
    this.busy.set(true);
    try {
      const r = await this.sb.rpc<{ version: number }>('player_crash_set_lineup', {
        p_player_ids: this.draft(),
        p_expected_version: this.baseVersion(),
      });
      this.baseVersion.set(r.version);
      this.dirty.set(false);
      this.toast.success('Orden guardado. ¡Tu equipo ya lo ve!');
      this.reload.emit();
    } catch (e) {
      if (e instanceof AppError && e.code === CONFLICT_CODE) {
        this.toast.info(e.message);
        this.dirty.set(false); // al recargar se adopta el orden del compañero
        this.reload.emit();
      } else {
        this.toast.error(e);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
