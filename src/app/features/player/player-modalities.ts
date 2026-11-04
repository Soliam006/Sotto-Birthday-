import { Component, computed, inject } from '@angular/core';
import { RouterLink } from '@angular/router';
import { CHALLENGE_ICONS, Challenge } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { Countdown } from '../../shared/countdown';
import { ErrorBox, Spinner, StatusBadge } from '../../shared/ui';
import { PlayerStore } from './player-store';

@Component({
  selector: 'app-player-modalities',
  imports: [RouterLink, StatusBadge, Spinner, ErrorBox, Countdown],
  template: `
    <h1 class="title-lg mb-4">Modalidades</h1>
    @if (store.modalities(); as m) {
      <div class="flex flex-col gap-4">
        @for (c of m.challenges; track c.id; let i = $index) {
          <article [id]="c.kind" class="card animate-rise scroll-mt-20 overflow-hidden p-0" [style.animation-delay.ms]="i * 60">
            <header class="flex items-start gap-3 border-b border-white/5 bg-gradient-to-r from-white/5 to-transparent p-4">
              <span class="grid size-12 shrink-0 place-items-center rounded-2xl bg-ink-700 text-2xl">{{ icons[c.kind] }}</span>
              <div class="min-w-0 flex-1">
                <p class="text-[11px] uppercase tracking-widest text-slate-400">{{ c.tagline }}</p>
                <h2 class="font-display text-2xl leading-tight">{{ c.name }}</h2>
              </div>
              <app-status-badge [status]="c.status" />
            </header>
            <div class="flex flex-col gap-3 p-4">
              <p class="text-sm text-slate-300">{{ c.description }}</p>

              @switch (c.kind) {
                @case ('crash') {
                  @if (m.crash.my_slots.length) {
                    <p class="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
                      🏁 Corres en la carrera <b>{{ m.crash.my_slots.join(' y ') }}</b>. ¡Prepárate!
                    </p>
                  }
                  @if (m.crash.races.length) {
                    <ul class="grid gap-1.5 text-sm">
                      @for (r of m.crash.races; track r.race_number) {
                        <li class="flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2">
                          <span>{{ r.is_training ? '🧪 Entrenamiento' : 'Carrera ' + r.race_number }} · <span class="text-slate-400">{{ r.track }}</span></span>
                          <span class="text-xs" [class]="r.status === 'finished' ? 'text-amber-300' : r.status === 'in_progress' ? 'text-emerald-300' : 'text-slate-500'">
                            {{ r.status === 'finished' ? 'Terminada' : r.status === 'in_progress' ? 'En pista' : 'Pendiente' }}
                          </span>
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('overcooked') {
                  <dl class="grid grid-cols-2 gap-2 text-sm">
                    <div class="rounded-lg bg-ink-800 p-2"><dt class="text-xs text-slate-400">Nivel</dt><dd class="font-semibold">{{ cfg(c, 'level') || 'Por anunciar' }}</dd></div>
                    <div class="rounded-lg bg-ink-800 p-2"><dt class="text-xs text-slate-400">Cocineros por equipo</dt><dd class="font-semibold">{{ cfg(c, 'players_per_team') || 'Libre' }}</dd></div>
                    @if (cfg(c, 'conditions')) {
                      <div class="col-span-2 rounded-lg bg-ink-800 p-2"><dt class="text-xs text-slate-400">Condiciones</dt><dd>{{ cfg(c, 'conditions') }}</dd></div>
                    }
                  </dl>
                }
                @case ('duels') {
                  <div class="rounded-xl bg-ink-800 p-3 text-sm">
                    <p class="mb-2 text-xs uppercase tracking-wider text-slate-400">Juegos puntuables</p>
                    <div class="flex flex-wrap gap-1.5">
                      @for (g of m.duels.games; track g) { <span class="chip bg-white/10">♟️ {{ g }}</span> }
                    </div>
                    <p class="mt-3">Has jugado <b>{{ m.duels.my_count }}</b> de <b>{{ m.duels.limit }}</b> duelos puntuables.</p>
                  </div>
                  <p class="rounded-xl bg-sky-500/10 p-3 text-sm text-sky-200">📣 ¿Quieres retar a alguien? Avisad al juez <b>antes</b> de empezar para que registre el duelo.</p>
                }
                @case ('missions') {
                  <a routerLink="/player/missions" class="btn-secondary">🕵️ Ver mis misiones</a>
                }
                @case ('spaghetti') {
                  @if (m.spaghetti.timer_status !== 'idle') {
                    <div class="rounded-2xl bg-ink-800 p-4">
                      <app-countdown [status]="m.spaghetti.timer_status" [endsAt]="m.spaghetti.ends_at"
                        [pausedMs]="m.spaghetti.paused_remaining_ms" [durationSeconds]="m.spaghetti.duration_seconds" size="lg" />
                    </div>
                  }
                  @if (m.spaghetti.reference_image_path) {
                    <figure>
                      <img [src]="imageUrl(m.spaghetti.reference_image_path)" alt="Estructura de referencia"
                           class="w-full rounded-xl border border-white/10 bg-black object-contain" loading="lazy" />
                      <figcaption class="mt-1 text-center text-xs text-slate-400">Estructura que debéis reproducir</figcaption>
                    </figure>
                  } @else {
                    <p class="rounded-xl bg-ink-800 p-3 text-center text-sm text-slate-400">🖼️ La imagen de referencia se mostrará al comenzar la prueba.</p>
                  }
                }
              }

              <details class="group rounded-xl bg-ink-800/70 p-3">
                <summary class="cursor-pointer list-none text-sm font-semibold text-slate-200">📜 Reglas <span class="float-right transition group-open:rotate-180">⌄</span></summary>
                <p class="mt-2 whitespace-pre-line text-sm text-slate-300">{{ c.rules }}</p>
              </details>
            </div>
          </article>
        }
      </div>
    } @else if (store.error()) {
      <app-error-box [message]="store.error()" />
    } @else {
      <app-spinner />
    }
  `,
})
export class PlayerModalitiesPage {
  protected readonly store = inject(PlayerStore);
  private readonly sb = inject(SupabaseService);
  protected readonly icons = CHALLENGE_ICONS;
  protected readonly loaded = computed(() => !!this.store.modalities());

  cfg(c: Challenge, key: string): string {
    const v = c.config[key];
    return v == null ? '' : String(v);
  }
  imageUrl(path: string): string {
    return this.sb.publicUrl('references', path);
  }
}
