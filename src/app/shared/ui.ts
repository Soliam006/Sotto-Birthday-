import { Component, computed, input } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ChallengeStatus, STATUS_LABELS } from '../core/models';

@Component({
  selector: 'app-spinner',
  template: `
    <div class="flex flex-col items-center justify-center gap-3 py-10 text-slate-400">
      <div class="size-9 animate-spin rounded-full border-4 border-white/10 border-t-amber-400"></div>
      @if (label()) { <p class="text-sm">{{ label() }}</p> }
    </div>
  `,
})
export class Spinner {
  readonly label = input<string>('Cargando…');
}

@Component({
  selector: 'app-empty',
  imports: [MatIcon],
  template: `
    <div class="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-white/10 px-4 py-8 text-center">
      <mat-icon class="icon-xl text-slate-500">{{ icon() }}</mat-icon>
      <p class="font-semibold text-slate-200">{{ title() }}</p>
      @if (text()) { <p class="max-w-sm text-sm text-slate-400">{{ text() }}</p> }
      <ng-content />
    </div>
  `,
})
export class Empty {
  /** Nombre del icono Material Symbols */
  readonly icon = input('inbox');
  readonly title = input.required<string>();
  readonly text = input<string>('');
}

@Component({
  selector: 'app-error-box',
  imports: [MatIcon],
  template: `
    <div class="flex flex-col items-center gap-3 rounded-2xl border border-rose-500/30 bg-rose-950/40 px-4 py-6 text-center">
      <mat-icon class="icon-lg text-rose-300">warning</mat-icon>
      <p class="text-sm text-rose-100">{{ message() }}</p>
      <ng-content />
    </div>
  `,
})
export class ErrorBox {
  readonly message = input.required<string>();
}

@Component({
  selector: 'app-status-badge',
  template: `<span class="chip" [class]="cls()">
    @if (status() === 'in_progress') { <span class="size-1.5 animate-pulse rounded-full bg-current"></span> }
    {{ label() }}</span>`,
})
export class StatusBadge {
  readonly status = input.required<ChallengeStatus>();
  readonly label = computed(() => STATUS_LABELS[this.status()]);
  readonly cls = computed(
    () =>
      ({
        pending: 'chip bg-slate-500/15 text-slate-300',
        preparing: 'chip bg-sky-500/15 text-sky-300',
        in_progress: 'chip bg-emerald-500/15 text-emerald-300',
        finished: 'chip bg-amber-500/15 text-amber-300',
      })[this.status()],
  );
}

@Component({
  selector: 'app-team-dot',
  template: `<span class="inline-flex min-w-0 items-center gap-2">
      <span class="size-3 shrink-0 rounded-full ring-2 ring-white/10" [style.background]="color() || '#64748b'"
            [style.box-shadow]="'0 0 10px ' + (color() || 'transparent')"></span>
      @if (name()) { <span class="truncate">{{ name() }}</span> }
    </span>`,
})
export class TeamDot {
  readonly color = input<string | null | undefined>('');
  readonly name = input<string | null | undefined>('');
}
