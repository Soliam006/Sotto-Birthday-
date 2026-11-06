import { Component, DestroyRef, computed, inject, input, output, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { elapsedMs, formatClock, formatMs } from '../../core/clock';
import { PlayerModalities, SpaghettiHint } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ImageLightbox } from '../../shared/image-lightbox';

interface HintRow {
  hint: SpaghettiHint;
  /** ms hasta la apertura (null = cronómetro sin iniciar) */
  msLeft: number | null;
}

/**
 * Pistas de Spaghetti para los jugadores: un desplegable por pista.
 * Las bloqueadas muestran candado y cuenta atrás (calculada con el reloj del
 * servidor); al llegar su hora se piden de nuevo los datos, porque la imagen
 * solo la entrega el servidor cuando la pista está abierta.
 */
@Component({
  selector: 'app-spaghetti-hints',
  imports: [MatIcon, ImageLightbox],
  template: `
    <section>
      <div class="mb-2 flex items-center gap-2">
        <mat-icon class="text-amber-300">tips_and_updates</mat-icon>
        <h3 class="flex-1 font-semibold">Pistas</h3>
        <span class="chip bg-white/5 text-slate-300">{{ openCount() }} / {{ rows().length }} abiertas</span>
      </div>
      <ul class="flex flex-col gap-2">
        @for (r of rows(); track r.hint.number) {
          @let h = r.hint;
          @if (h.is_open) {
            @let expanded = opened().has(h.number);
            <li class="overflow-hidden rounded-xl border border-amber-400/40 bg-amber-400/5">
              <button type="button" class="flex w-full items-center gap-2 px-3 py-2.5 text-left" (click)="toggle(h.number)"
                      [attr.aria-expanded]="expanded">
                <mat-icon class="text-amber-300">lock_open</mat-icon>
                <span class="min-w-0 flex-1">
                  <span class="block font-semibold">Pista {{ h.number }}</span>
                  @if (h.title) { <span class="block truncate text-xs text-slate-300">{{ h.title }}</span> }
                </span>
                <mat-icon class="text-slate-400 transition-transform" [class.rotate-180]="expanded">expand_more</mat-icon>
              </button>
              @if (expanded && h.image_path) {
                <div class="animate-rise px-3 pb-3">
                  <app-image-lightbox [src]="imageUrl(h.image_path)" [alt]="'Pista ' + h.number + (h.title ? ': ' + h.title : '')" />
                </div>
              }
            </li>
          } @else {
            <li class="flex items-center gap-2 rounded-xl border border-dashed border-white/10 bg-ink-900/60 px-3 py-2.5 text-slate-500"
                [attr.aria-label]="'Pista ' + h.number + ' bloqueada'">
              <mat-icon>lock</mat-icon>
              <span class="flex-1 font-semibold">Pista {{ h.number }}</span>
              <span class="text-right text-xs tabular-nums">
                @if (r.msLeft === null) {
                  Se abrirá al minuto {{ clock(h.open_at_seconds) }}
                } @else {
                  {{ paused() ? 'En pausa · ' : '' }}Se abre en <b class="text-slate-300">{{ fmt(r.msLeft) }}</b>
                }
              </span>
            </li>
          }
        }
      </ul>
    </section>
  `,
})
export class SpaghettiHints {
  readonly spaghetti = input.required<PlayerModalities['spaghetti']>();
  /** Pide recargar los datos (al llegar la hora de una pista) */
  readonly reload = output<void>();

  private readonly sb = inject(SupabaseService);
  private readonly tick = signal(0);
  protected readonly opened = signal<ReadonlySet<number>>(new Set());
  /** Última vez que se pidió al servidor la apertura de cada pista (evita peticiones repetidas) */
  private readonly requested = new Map<number, number>();

  protected readonly paused = computed(() => this.spaghetti().timer_status === 'paused');
  protected readonly openCount = computed(() => this.spaghetti().hints.filter((h) => h.is_open).length);
  protected readonly rows = computed<HintRow[]>(() => {
    this.tick();
    const sp = this.spaghetti();
    const elapsed = elapsedMs(sp);
    return sp.hints.map((hint) => ({
      hint,
      msLeft: hint.is_open || elapsed === null ? null : Math.max(0, hint.open_at_seconds * 1000 - elapsed),
    }));
  });

  constructor() {
    const id = setInterval(() => {
      this.tick.update((v) => v + 1);
      this.checkUnlocks();
    }, 500);
    inject(DestroyRef).onDestroy(() => clearInterval(id));
  }

  /** Al llegar la hora de una pista bloqueada, se recargan los datos (con margen por el reloj) */
  private checkUnlocks(): void {
    const sp = this.spaghetti();
    if (sp.timer_status !== 'running') return;
    const elapsed = elapsedMs(sp);
    if (elapsed === null) return;
    for (const h of sp.hints) {
      const last = this.requested.get(h.number) ?? 0;
      if (!h.is_open && elapsed >= h.open_at_seconds * 1000 + 400 && Date.now() - last > 3000) {
        this.requested.set(h.number, Date.now());
        this.reload.emit();
        return;
      }
    }
  }

  toggle(n: number): void {
    this.opened.update((s) => {
      const next = new Set(s);
      if (next.has(n)) next.delete(n);
      else next.add(n);
      return next;
    });
  }

  imageUrl(path: string): string {
    return this.sb.publicUrl('references', path);
  }
  fmt(ms: number): string {
    return formatMs(ms);
  }
  clock(seconds: number): string {
    return formatClock(seconds);
  }
}
