import { Component, DestroyRef, effect, inject, input, signal, untracked } from '@angular/core';

/** Número que anima su cambio (cuenta progresiva). */
@Component({
  selector: 'app-animated-number',
  template: `{{ display() }}`,
})
export class AnimatedNumber {
  readonly value = input.required<number>();
  readonly duration = input(1200);
  protected readonly display = signal(0);
  private raf = 0;

  constructor() {
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.raf));
    effect(() => {
      const target = this.value();
      const from = untracked(() => this.display());
      const dur = this.duration();
      cancelAnimationFrame(this.raf);
      const start = performance.now();
      const step = (t: number) => {
        const p = Math.min(1, (t - start) / dur);
        const eased = 1 - Math.pow(1 - p, 3);
        this.display.set(Math.round(from + (target - from) * eased));
        if (p < 1) this.raf = requestAnimationFrame(step);
      };
      this.raf = requestAnimationFrame(step);
    });
  }
}
