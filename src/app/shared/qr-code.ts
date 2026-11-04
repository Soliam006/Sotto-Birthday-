import { Component, effect, input, signal } from '@angular/core';
import QRCode from 'qrcode';

@Component({
  selector: 'app-qr',
  template: `
    <div class="flex flex-col items-center gap-2">
      @if (src()) {
        <img [src]="src()" [alt]="'Código QR: ' + text()" class="rounded-xl bg-white p-2" [style.width.px]="size()" [style.height.px]="size()" />
      }
      @if (showText()) { <code class="break-all text-center text-xs text-slate-400">{{ text() }}</code> }
    </div>
  `,
})
export class QrCodeView {
  readonly text = input.required<string>();
  readonly size = input(220);
  readonly showText = input(true);
  protected readonly src = signal('');
  constructor() {
    effect(() => {
      const t = this.text();
      QRCode.toDataURL(t, { margin: 1, width: this.size() * 2, errorCorrectionLevel: 'M' })
        .then((u) => this.src.set(u))
        .catch(() => this.src.set(''));
    });
  }
}
