import { Component, DestroyRef, computed, inject, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { formatMs, remainingMs } from '../core/clock';

/** Cronómetro calculado a partir de la hora de fin almacenada en servidor. */
@Component({
  selector: 'app-countdown',
  imports: [MatIcon],
  template: `
    <div class="flex flex-col items-center">
      <span class="font-display tabular-nums leading-none" [class]="sizeClass()"
            [class.text-rose-400]="ms() > 0 && ms() < 60000" [class.animate-pulse]="ms() > 0 && ms() < 60000">
        {{ text() }}
      </span>
      @if (status() === 'paused') { <span class="chip mt-1 bg-sky-500/20 text-sky-200"><mat-icon>pause</mat-icon> En pausa</span> }
      @if (status() === 'finished' || (status() === 'running' && ms() === 0)) {
        <span class="chip mt-1 bg-rose-500/20 text-rose-200"><mat-icon>alarm</mat-icon> ¡Tiempo!</span>
      }
    </div>
  `,
})
export class Countdown {
  readonly status = input.required<string>();
  readonly endsAt = input<string | null>(null);
  readonly pausedMs = input<number | null>(null);
  readonly durationSeconds = input<number>(1800);
  readonly size = input<'md' | 'lg' | 'xl'>('lg');

  private readonly tick = signal(0);
  readonly ms = computed(() => {
    this.tick();
    const st = this.status();
    if (st === 'idle' || st === 'cancelled') return this.durationSeconds() * 1000;
    return remainingMs({ status: st, ends_at: this.endsAt(), paused_remaining_ms: this.pausedMs() });
  });
  readonly text = computed(() => formatMs(this.ms()));
  readonly sizeClass = computed(() => ({ md: 'text-4xl', lg: 'text-7xl', xl: 'text-[10rem]' })[this.size()]);

  constructor() {
    const id = setInterval(() => this.tick.update((v) => v + 1), 250);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }
}
