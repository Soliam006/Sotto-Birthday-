import { Component, effect, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../core/confirm.service';

@Component({
  selector: 'app-confirm-dialog',
  imports: [FormsModule],
  template: `
    @if (svc.current(); as c) {
      <div class="fixed inset-0 z-[70] flex items-end justify-center bg-black/70 p-3 backdrop-blur-sm sm:items-center"
           (click)="svc.close(false)">
        <div class="card animate-pop w-full max-w-md p-5" (click)="$event.stopPropagation()" role="dialog" aria-modal="true">
          <h2 class="title-md mb-2" [class.text-rose-300]="c.danger">{{ c.title }}</h2>
          @if (c.message) { <p class="mb-4 whitespace-pre-line text-sm text-slate-300">{{ c.message }}</p> }
          @if (c.prompt) {
            <label class="label" for="confirm-prompt">{{ c.prompt.label }}</label>
            <textarea id="confirm-prompt" class="input mb-4 min-h-20" [placeholder]="c.prompt.placeholder ?? ''"
                      [(ngModel)]="text" name="text"></textarea>
          }
          <div class="flex gap-2">
            <button type="button" class="btn-secondary flex-1" (click)="svc.close(false)">Cancelar</button>
            <button type="button" class="flex-1" [class]="c.danger ? 'btn-danger flex-1' : 'btn-primary flex-1'"
                    [disabled]="c.prompt?.required && text().trim().length < 3"
                    (click)="svc.close(c.prompt ? text().trim() : 'ok')">
              {{ c.confirmText ?? 'Confirmar' }}
            </button>
          </div>
        </div>
      </div>
    }
  `,
})
export class ConfirmDialog {
  protected readonly svc = inject(ConfirmService);
  protected readonly text = signal('');
  constructor() {
    effect(() => {
      if (this.svc.current()) this.text.set('');
    });
  }
}
