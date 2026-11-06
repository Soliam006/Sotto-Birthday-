import { Component, Injector, OnInit, afterNextRender, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { ActivatedRoute, RouterLink } from '@angular/router';
import { CHALLENGE_ICONS, Challenge, ChallengeKind } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { Countdown } from '../../shared/countdown';
import { ErrorBox, Spinner, StatusBadge } from '../../shared/ui';
import { CrashLineupEditor } from './crash-lineup-editor';
import { OvercookedRosterEditor } from './overcooked-roster-editor';
import { SpaghettiHints } from './spaghetti-hints';
import { ImageLightbox } from '../../shared/image-lightbox';
import { PlayerStore } from './player-store';

@Component({
  selector: 'app-player-modalities',
  imports: [MatIcon, RouterLink, StatusBadge, Spinner, ErrorBox, Countdown, CrashLineupEditor, OvercookedRosterEditor, SpaghettiHints, ImageLightbox],
  template: `
    <h1 class="title-lg mb-1">Modalidades</h1>
    <p class="mb-4 text-sm text-slate-400">Pulsa una modalidad para ver sus reglas y la información para participar.</p>
    @if (store.modalities(); as m) {
      <div class="flex flex-col gap-3">
        @for (c of m.challenges; track c.id; let i = $index) {
          <article [id]="c.kind" class="card animate-rise scroll-mt-20 overflow-hidden p-0" [style.animation-delay.ms]="i * 60">
            @let open = isOpen(c.kind);
            <button type="button" (click)="toggle(c.kind)" [attr.aria-expanded]="open" [attr.aria-controls]="'body-' + c.kind"
                    class="flex w-full items-center gap-3 bg-gradient-to-r from-white/5 to-transparent px-3 py-3 text-left transition active:bg-white/5"
                    [class.border-b]="open" [class.border-white/5]="open">
              <span class="grid size-11 shrink-0 place-items-center rounded-2xl bg-ink-700 text-amber-300"><mat-icon class="icon-md">{{ icons[c.kind] }}</mat-icon></span>
              <span class="min-w-0 flex-1">
                <span class="block truncate text-[11px] uppercase tracking-widest text-slate-400">{{ c.tagline }}</span>
                <span class="font-display block truncate text-2xl leading-tight" [title]="c.name">{{ c.name }}</span>
                @if (c.kind === 'crash' && lineupMissing()) {
                  <span class="chip mt-1 bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">format_list_numbered</mat-icon> Falta el orden de pilotos</span>
                } @else if (c.kind === 'crash' && m.crash.my_slots.length) {
                  <span class="chip mt-1 bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">sports_score</mat-icon> Corres en la {{ m.crash.my_slots.join(' y ') }}</span>
                } @else if (c.kind === 'overcooked' && rosterMissing()) {
                  <span class="chip mt-1 bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">groups</mat-icon> Faltan cocineros por elegir</span>
                } @else if (c.kind === 'spaghetti' && spaghettiActive() && m.spaghetti.hints.length) {
                  <span class="chip mt-1 bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">tips_and_updates</mat-icon> Pistas: {{ openHints() }} / {{ m.spaghetti.hints.length }}</span>
                } @else if (c.kind === 'overcooked' && m.overcooked.i_play) {
                  <span class="chip mt-1 bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">skillet</mat-icon> Cocinas en la partida oficial</span>
                }
              </span>
              <span class="flex shrink-0 items-center gap-1">
                <app-status-badge [status]="c.status" />
                <mat-icon class="text-slate-400 transition-transform duration-200" [class.rotate-180]="open">expand_more</mat-icon>
              </span>
            </button>
            @if (open) {
            <div [id]="'body-' + c.kind" class="animate-rise flex flex-col gap-3 p-4">
              <p class="text-sm text-slate-300">{{ c.description }}</p>

              @switch (c.kind) {
                @case ('crash') {
                  @if (m.crash.my_slots.length) {
                    <p class="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200">
                      <mat-icon>sports_score</mat-icon> Corres en la carrera <b>{{ m.crash.my_slots.join(' y ') }}</b>. ¡Prepárate!
                    </p>
                  }
                  @if (m.crash.race_count > 0 && store.team()) {
                    <app-crash-lineup-editor [crash]="m.crash" [members]="store.team()!.members" [me]="store.state()?.player?.id"
                                             (reload)="store.loadModalities()" />
                  } @else if (!m.crash.race_count) {
                    <p class="rounded-xl bg-ink-800 p-3 text-sm text-slate-400">El juez aún no ha fijado el número de carreras. Cuando lo haga, podréis ordenar vuestros pilotos aquí.</p>
                  }
                  @if (m.crash.races.length) {
                    <ul class="grid gap-1.5 text-sm">
                      @for (r of m.crash.races; track r.race_number) {
                        <li class="flex items-center justify-between rounded-lg bg-ink-800 px-3 py-2">
                          <span>@if (r.is_training) { <mat-icon class="text-sky-300">science</mat-icon> Entrenamiento } @else { Carrera {{ r.race_number }}@if (r.track) { · <span class="text-slate-400">{{ r.track }}</span> } }</span>
                          <span class="text-xs" [class]="r.status === 'finished' ? 'text-amber-300' : r.status === 'in_progress' ? 'text-emerald-300' : 'text-slate-500'">
                            {{ r.status === 'finished' ? 'Terminada' : r.status === 'in_progress' ? 'En pista' : 'Pendiente' }}
                          </span>
                        </li>
                      }
                    </ul>
                  }
                }
                @case ('overcooked') {
                  @if (m.overcooked.i_play) {
                    <p class="rounded-xl bg-amber-500/10 p-3 text-sm text-amber-200"><mat-icon>skillet</mat-icon> Cocinas en la partida oficial de tu equipo. ¡Prepárate!</p>
                  }
                  <dl class="grid grid-cols-2 gap-2 text-sm">
                    <div class="rounded-lg bg-ink-800 p-2"><dt class="text-xs text-slate-400">Nivel</dt><dd class="font-semibold">{{ cfg(c, 'level') || 'Por anunciar' }}</dd></div>
                    <div class="rounded-lg bg-ink-800 p-2"><dt class="text-xs text-slate-400">Cocineros por equipo</dt><dd class="font-semibold">{{ cfg(c, 'players_per_team') || 'Por anunciar' }}</dd></div>
                    @if (cfg(c, 'conditions')) {
                      <div class="col-span-2 rounded-lg bg-ink-800 p-2"><dt class="text-xs text-slate-400">Condiciones</dt><dd>{{ cfg(c, 'conditions') }}</dd></div>
                    }
                  </dl>
                  @if (m.overcooked.required > 0 && store.team()) {
                    <app-overcooked-roster-editor [overcooked]="m.overcooked" [members]="store.team()!.members" [me]="store.state()?.player?.id"
                                                  (reload)="store.loadModalities()" />
                  } @else if (!m.overcooked.players_per_team) {
                    <p class="rounded-xl bg-ink-800 p-3 text-sm text-slate-400">El juez aún no ha fijado cuántos cocineros juegan por equipo. Cuando lo haga, podréis elegirlos aquí.</p>
                  }
                }
                @case ('duels') {
                  <div class="rounded-xl bg-ink-800 p-3 text-sm">
                    <p class="mb-2 text-xs uppercase tracking-wider text-slate-400">Juegos puntuables</p>
                    <div class="flex flex-wrap gap-1.5">
                      @for (g of m.duels.games; track g) { <span class="chip bg-white/10"><mat-icon>chess</mat-icon> {{ g }}</span> }
                    </div>
                    <p class="mt-3">Has jugado <b>{{ m.duels.my_count }}</b> de <b>{{ m.duels.limit }}</b> duelos puntuables.</p>
                  </div>
                  <p class="rounded-xl bg-sky-500/10 p-3 text-sm text-sky-200"><mat-icon>campaign</mat-icon> ¿Quieres retar a alguien? Avisad al juez <b>antes</b> de empezar para que registre el duelo.</p>
                }
                @case ('missions') {
                  <a routerLink="/player/missions" class="btn-secondary"><mat-icon>mystery</mat-icon> Ver mis misiones</a>
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
                      <app-image-lightbox [src]="imageUrl(m.spaghetti.reference_image_path)" alt="Estructura de referencia" />
                      <figcaption class="mt-1 text-center text-xs text-slate-400">Estructura que debéis reproducir</figcaption>
                    </figure>
                  } @else {
                    <p class="rounded-xl bg-ink-800 p-3 text-center text-sm text-slate-400"><mat-icon>image</mat-icon> La imagen de referencia se mostrará al comenzar la prueba.</p>
                  }
                  @if (m.spaghetti.hints.length) {
                    <app-spaghetti-hints [spaghetti]="m.spaghetti" (reload)="store.loadModalities()" />
                  }
                }
              }

              <details class="group rounded-xl bg-ink-800/70 p-3">
                <summary class="cursor-pointer list-none text-sm font-semibold text-slate-200"><mat-icon>menu_book</mat-icon> Reglas <span class="float-right transition group-open:rotate-180"><mat-icon>expand_more</mat-icon></span></summary>
                <p class="mt-2 whitespace-pre-line text-sm text-slate-300">{{ c.rules }}</p>
              </details>
            </div>
            }
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
export class PlayerModalitiesPage implements OnInit {
  protected readonly store = inject(PlayerStore);
  private readonly sb = inject(SupabaseService);
  private readonly route = inject(ActivatedRoute);
  private readonly injector = inject(Injector);
  protected readonly icons = CHALLENGE_ICONS;

  /** Modalidades desplegadas (todas plegadas por defecto) */
  private readonly opened = signal<ReadonlySet<ChallengeKind>>(new Set());
  /** El equipo aún no ha completado el orden de pilotos de Crash */
  protected readonly lineupMissing = computed(() => {
    const c = this.store.modalities()?.crash;
    return !!c && c.can_edit_lineup && !!this.store.team() && c.lineup.length < c.race_count;
  });

  /** El equipo aún no ha completado su selección de cocineros de Overcooked */
  protected readonly rosterMissing = computed(() => {
    const o = this.store.modalities()?.overcooked;
    return !!o && o.can_edit_roster && !!this.store.team() && o.roster.length < o.required;
  });

  protected readonly spaghettiActive = computed(() => ['running', 'paused'].includes(this.store.modalities()?.spaghetti.timer_status ?? ''));
  protected readonly openHints = computed(() => this.store.modalities()?.spaghetti.hints.filter((h) => h.is_open).length ?? 0);

  ngOnInit(): void {
    // Enlace desde Inicio (/player/modalities#crash): se abre y se desplaza a esa modalidad
    const kind = this.route.snapshot.fragment as ChallengeKind | null;
    if (kind && kind in CHALLENGE_ICONS) {
      this.opened.set(new Set([kind]));
      afterNextRender(() => document.getElementById(kind)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), { injector: this.injector });
    }
  }

  isOpen(kind: ChallengeKind): boolean {
    return this.opened().has(kind);
  }
  toggle(kind: ChallengeKind): void {
    this.opened.update((s) => {
      const n = new Set(s);
      if (n.has(kind)) n.delete(kind);
      else n.add(kind);
      return n;
    });
  }

  cfg(c: Challenge, key: string): string {
    const v = c.config[key];
    return v == null ? '' : String(v);
  }
  imageUrl(path: string): string {
    return this.sb.publicUrl('references', path);
  }
}
