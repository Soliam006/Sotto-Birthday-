import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { MatIcon } from '@angular/material/icon';
import { VersionedDraft } from './versioned-draft';

/** Pie común de las selecciones editables: aviso de cambios ajenos, estado y Guardar/Descartar. */
@Component({
  selector: 'app-draft-footer',
  imports: [MatIcon, DatePipe],
  template: `
    @let d = draft();
    @if (d.remoteChanged()) {
      <div class="mt-3 flex items-center gap-2 rounded-xl bg-sky-500/10 p-2 text-xs text-sky-200">
        <mat-icon class="icon-sm">sync</mat-icon>
        <span class="flex-1">{{ updatedBy() }} ha guardado otra versión.</span>
        <button type="button" class="btn-ghost btn-sm" (click)="d.discard()">Ver la nueva</button>
      </div>
    }
    <div class="mt-3 flex items-center gap-2">
      <p class="min-w-0 flex-1 text-[11px] text-slate-500">
        @if (d.dirty()) { <span class="text-amber-300">Cambios sin guardar</span> }
        @else if (updatedBy()) { Guardado por {{ updatedBy() }} · {{ updatedAt() | date: 'HH:mm' }} }
        @else { Aún no se ha guardado }
      </p>
      @if (d.dirty()) { <button type="button" class="btn-ghost btn-sm" (click)="d.discard()" [disabled]="d.busy()">Descartar</button> }
      <button type="button" class="btn-primary btn-sm" (click)="save.emit()" [disabled]="!d.dirty() || !valid() || d.busy() || !enabled()">
        <mat-icon>save</mat-icon> {{ d.busy() ? 'Guardando…' : 'Guardar' }}
      </button>
    </div>
  `,
})
export class DraftFooter {
  readonly draft = input.required<VersionedDraft>();
  readonly updatedBy = input<string | null>(null);
  readonly updatedAt = input<string | null>(null);
  /** El borrador cumple las reglas (si no, Guardar queda desactivado) */
  readonly valid = input(true);
  /** Se permite editar/guardar */
  readonly enabled = input(true);
  readonly save = output<void>();
}
