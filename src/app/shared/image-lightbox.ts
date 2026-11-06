import { Component, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';

/** Imagen que se amplía a pantalla completa al pulsarla. */
@Component({
  selector: 'app-image-lightbox',
  imports: [MatIcon],
  host: { '(document:keydown.escape)': 'open.set(false)' },
  template: `
    <button type="button" class="group relative block w-full overflow-hidden rounded-xl border border-white/10 bg-black"
            (click)="open.set(true)" [attr.aria-label]="'Ampliar: ' + alt()">
      <img [src]="src()" [alt]="alt()" class="w-full object-contain" [class]="compact() ? 'h-14' : 'max-h-80'" loading="lazy" />
      @if (!compact()) {
        <span class="absolute bottom-2 right-2 grid size-9 place-items-center rounded-full bg-black/60 text-white">
          <mat-icon>zoom_in</mat-icon>
        </span>
      }
    </button>
    @if (open()) {
      <div class="fixed inset-0 z-[80] flex items-center justify-center bg-black/95 p-2" (click)="open.set(false)" role="dialog" aria-modal="true" [attr.aria-label]="alt()">
        <img [src]="src()" [alt]="alt()" class="max-h-full max-w-full object-contain" />
        <button type="button" class="absolute right-3 top-[max(0.75rem,env(safe-area-inset-top))] grid size-11 place-items-center rounded-full bg-white/10 text-white"
                aria-label="Cerrar" (click)="open.set(false)">
          <mat-icon>close</mat-icon>
        </button>
      </div>
    }
  `,
})
export class ImageLightbox {
  readonly src = input.required<string>();
  readonly alt = input('Imagen');
  /** Miniatura pequeña, sin icono de zoom */
  readonly compact = input(false);
  protected readonly open = signal(false);
}
