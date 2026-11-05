import { Component, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ToastService } from '../core/toast.service';

@Component({
  selector: 'app-toast-host',
  imports: [MatIcon],
  template: `
    <div class="pointer-events-none fixed inset-x-0 top-0 z-[60] flex flex-col items-center gap-2 p-3 pt-[max(0.75rem,env(safe-area-inset-top))]"
         aria-live="polite">
      @for (t of toasts.toasts(); track t.id) {
        <button type="button" (click)="toasts.dismiss(t.id)"
          class="pointer-events-auto animate-pop flex w-full max-w-md items-start gap-3 rounded-2xl border px-4 py-3 text-left text-sm font-medium shadow-2xl shadow-black/50 backdrop-blur"
          [class]="cls(t.kind)">
          @if (t.kind === 'points') { <span class="text-lg leading-none">🏆</span> } @else { <mat-icon class="icon-md icon-fill">{{ icon(t.kind) }}</mat-icon> }
          <span class="flex-1">{{ t.text }}</span>
        </button>
      }
    </div>
  `,
})
export class ToastHost {
  protected readonly toasts = inject(ToastService);
  icon(k: string): string {
    return ({ success: 'check_circle', error: 'warning', info: 'info' } as Record<string, string>)[k] ?? 'info';
  }
  cls(k: string): string {
    return ({
      success: 'border-emerald-400/30 bg-emerald-950/90 text-emerald-100',
      error: 'border-rose-400/40 bg-rose-950/95 text-rose-100',
      info: 'border-sky-400/30 bg-sky-950/90 text-sky-100',
      points: 'border-amber-300/40 bg-amber-950/95 text-amber-100',
    } as Record<string, string>)[k];
  }
}
