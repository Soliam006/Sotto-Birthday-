import { Component, DestroyRef, OnInit, computed, effect, inject, input, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { syncServerClock } from '../../core/clock';
import { LiveService } from '../../core/live.service';
import { StandingRow, TvState } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { Countdown } from '../../shared/countdown';
import { AnimatedNumber } from './animated-number';

const KEY_STORAGE = 'birthday-cup-tv-key';

/**
 * Pantalla pública para la televisión (/tv?key=...).
 * Solo lectura: usa get_tv_state(clave), que devuelve exclusivamente lo
 * necesario según el modo elegido por el juez. Sin controles interactivos.
 */
@Component({
  selector: 'app-tv-page',
  imports: [DatePipe, Countdown, AnimatedNumber],
  template: `
    <div class="tv relative flex h-dvh w-full flex-col overflow-hidden bg-ink-950 text-white" (dblclick)="fullscreen()">
      <div class="pointer-events-none absolute inset-0 opacity-60"
           style="background: radial-gradient(60% 50% at 50% 0%, rgba(124,58,237,.35), transparent 70%), radial-gradient(40% 40% at 100% 100%, rgba(251,191,36,.18), transparent 70%)"></div>

      @if (error()) {
        <div class="relative m-auto max-w-3xl text-center">
          <p class="font-display gold-text text-[8vw] leading-none">BIRTHDAY CUP</p>
          <p class="mt-6 text-[2vw] text-slate-300">{{ error() }}</p>
          <p class="mt-2 text-[1.2vw] text-slate-500">Abre el enlace de la TV desde el panel del juez → Pantalla TV.</p>
        </div>
      } @else if (state(); as s) {
        <!-- Cabecera -->
        <header class="relative flex items-center justify-between px-[3vw] pt-[2.5vh]">
          <div class="flex items-center gap-[1.2vw]">
            <span class="text-[4vw] leading-none drop-shadow-[0_0_30px_rgba(251,191,36,.6)]">🏆</span>
            <div>
              <h1 class="font-display gold-text text-[4.2vw] leading-[0.9]">{{ s.competition.name }}</h1>
              @if (s.competition.subtitle) { <p class="text-[1.3vw] uppercase tracking-[0.35em] text-slate-400">{{ s.competition.subtitle }}</p> }
            </div>
          </div>
          @if (s.timer; as t) {
            <div class="rounded-[1.5vw] border border-white/10 bg-black/40 px-[2vw] py-[1vh] text-center">
              <p class="text-[1vw] uppercase tracking-[0.3em] text-slate-400">🍝 Spaghetti & Marshmallow</p>
              <div class="text-[3vw]"><app-countdown [status]="t.status" [endsAt]="t.ends_at" [pausedMs]="t.paused_remaining_ms" [durationSeconds]="t.duration_seconds" size="md" /></div>
            </div>
          }
        </header>

        <main class="relative flex min-h-0 flex-1 flex-col px-[3vw] pb-[3vh] pt-[2vh]">
          @switch (s.mode) {
            @case ('waiting') {
              <div class="m-auto flex w-full flex-col items-center gap-[5vh] text-center">
                <p class="max-w-[70vw] font-display text-[5vw] leading-tight text-slate-100">{{ s.message }}</p>
                <div class="flex flex-wrap justify-center gap-[2vw]">
                  @for (t of s.teams; track t.team_id; let i = $index) {
                    <div class="animate-rise flex min-w-[14vw] flex-col items-center rounded-[1.5vw] border-2 px-[2vw] py-[2vh]"
                         [style.border-color]="t.color" [style.background]="t.color + '22'" [style.box-shadow]="'0 0 40px ' + t.color + '55'"
                         [style.animation-delay.ms]="i * 120">
                      <span class="font-display text-[3vw] leading-none" [style.color]="t.color">{{ t.name }}</span>
                      <span class="mt-1 text-[1.3vw] text-slate-300">{{ t.players_count }} jugadores</span>
                    </div>
                  }
                </div>
              </div>
            }

            @case ('champion') {
              <div class="relative m-auto flex w-full flex-col items-center text-center">
                @if (revealPhase() === 'countdown') {
                  <p class="text-[2.2vw] uppercase tracking-[0.5em] text-slate-400">Y el equipo campeón es…</p>
                  <p class="animate-pop font-display text-[22vw] leading-none text-amber-300" [attr.data-n]="revealCount()">{{ revealCount() }}</p>
                } @else if (champion(); as c) {
                  <div class="confetti pointer-events-none fixed inset-0">
                    @for (p of confetti; track $index) {
                      <span [style.left.%]="p.x" [style.background]="p.c" [style.animation-delay.s]="p.d" [style.animation-duration.s]="p.t" [style.width.px]="p.s" [style.height.px]="p.s * 0.4"></span>
                    }
                  </div>
                  <p class="animate-rise text-[2vw] uppercase tracking-[0.5em] text-amber-200">🏆 Campeones de la {{ s.competition.name }} 🏆</p>
                  <h2 class="champion-name font-display text-[13vw] leading-[0.9]" [style.color]="c.color" [style.text-shadow]="'0 0 80px ' + c.color">{{ c.name }}</h2>
                  <p class="animate-rise font-display text-[6vw] leading-none text-white" style="animation-delay: .6s"><app-animated-number [value]="c.points ?? 0" [duration]="2500" /> puntos</p>
                  <p class="animate-rise mt-[2vh] text-[2.2vw] text-slate-200" style="animation-delay: 1.2s">¡Enhorabuena, campeones! 🎉</p>
                  <div class="mt-[4vh] flex gap-[3vw]">
                    @for (r of runnersUp(); track r.team_id; let i = $index) {
                      <div class="animate-rise flex items-center gap-[1vw] rounded-[1vw] bg-white/5 px-[2vw] py-[1.5vh]" [style.animation-delay.s]="1.6 + i * 0.3">
                        <span class="font-display text-[3vw]">{{ r.rank === 2 ? '🥈' : '🥉' }}</span>
                        <span class="font-display text-[2.6vw]" [style.color]="r.color">{{ r.name }}</span>
                        <span class="font-display text-[2.6vw] text-slate-300">{{ r.points }}</span>
                      </div>
                    }
                  </div>
                }
              </div>
            }

            @case ('final_results') {
              <div class="m-auto flex w-full items-end justify-center gap-[2vw]">
                @for (t of podium(); track t.team_id) {
                  <div class="animate-rise flex w-[22vw] flex-col items-center" [style.animation-delay.ms]="t.rank === 1 ? 600 : t.rank === 2 ? 300 : 0">
                    <span class="text-[4vw]">{{ t.rank === 1 ? '🥇' : t.rank === 2 ? '🥈' : '🥉' }}</span>
                    <span class="font-display text-center text-[3vw] leading-none" [style.color]="t.color">{{ t.name }}</span>
                    <span class="font-display text-[4vw]">{{ t.points }}</span>
                    <div class="w-full rounded-t-[1vw]" [style.height.vh]="t.rank === 1 ? 40 : t.rank === 2 ? 30 : 22"
                         [style.background]="'linear-gradient(180deg, ' + t.color + ', ' + t.color + '33)'"></div>
                  </div>
                }
              </div>
              @if (rest().length) {
                <p class="mt-[2vh] text-center text-[1.6vw] text-slate-400">
                  @for (t of rest(); track t.team_id) { <span class="mx-[1vw]">{{ t.rank }}º {{ t.name }} · {{ t.points }}</span> }
                </p>
              }
            }

            @default {
              <!-- Clasificación (con o sin puntos) -->
              @let showPoints = s.mode === 'leaderboard';
              <div class="relative min-h-0 flex-1">
                @for (t of s.teams; track t.team_id) {
                  @let idx = order().indexOf(t.team_id);
                  <div class="absolute inset-x-0 px-[0.3vw] transition-all duration-1000 ease-[cubic-bezier(.2,.9,.3,1.1)]"
                       [style.top.%]="idx * (100 / s.teams.length)" [style.height.%]="100 / s.teams.length">
                    <div class="flex h-[88%] items-center gap-[2vw] overflow-hidden rounded-[1.4vw] border-2 px-[2vw]"
                         [style.border-color]="t.color + (t.rank === 1 ? '' : '66')"
                         [style.background]="'linear-gradient(90deg, ' + t.color + (t.rank === 1 ? '55' : '2a') + ', #0d0f17 75%)'"
                         [style.box-shadow]="t.rank === 1 ? '0 0 60px ' + t.color + '66' : 'none'">
                      <span class="font-display w-[6vw] text-center text-[5.5vh] leading-none">{{ t.rank === 1 ? '👑' : t.rank + 'º' }}</span>
                      <span class="size-[4vh] shrink-0 rounded-full" [style.background]="t.color" [style.box-shadow]="'0 0 25px ' + t.color"></span>
                      <span class="font-display min-w-0 flex-1 truncate text-[7vh] leading-none">{{ t.name }}</span>
                      @if (t.rank === 1 && showPoints) { <span class="rounded-full bg-amber-400 px-[1vw] py-[0.4vh] text-[1.6vh] font-bold uppercase tracking-widest text-ink-950">Líder</span> }
                      @if (showPoints) {
                        <span class="font-display text-[9vh] leading-none tabular-nums"><app-animated-number [value]="t.points ?? 0" /></span>
                      }
                    </div>
                  </div>
                }
              </div>
              <footer class="flex items-center justify-between pt-[1vh] text-[1.6vh] text-slate-500">
                <span>{{ showPoints ? 'Clasificación en directo' : '🤫 Puntuaciones ocultas · ¿quién irá ganando?' }}</span>
                @if (s.last_update) { <span>Última actualización: {{ s.last_update | date: 'HH:mm' }}</span> }
              </footer>
            }
          }
        </main>
      } @else {
        <div class="m-auto size-16 animate-spin rounded-full border-8 border-white/10 border-t-amber-400"></div>
      }
    </div>
  `,
  styles: `
    .confetti span { position: absolute; top: -5vh; border-radius: 2px; animation-name: fall; animation-timing-function: linear; animation-iteration-count: infinite; }
    @keyframes fall { 0% { transform: translateY(0) rotate(0deg); opacity: 1 } 100% { transform: translateY(110vh) rotate(720deg); opacity: .8 } }
    .champion-name { animation: champion 1.2s cubic-bezier(.2,1.6,.4,1) both; }
    @keyframes champion { 0% { transform: scale(.2); opacity: 0; filter: blur(20px) } 100% { transform: scale(1); opacity: 1; filter: blur(0) } }
  `,
})
export class TvPage implements OnInit {
  readonly key = input<string | undefined>(undefined);
  private readonly sb = inject(SupabaseService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly state = signal<TvState | null>(null);
  protected readonly error = signal('');
  protected readonly revealPhase = signal<'countdown' | 'done'>('done');
  protected readonly revealCount = signal(3);
  private lastRevealHandled: string | null = null;
  private accessKey = '';

  protected readonly order = computed(() => [...(this.state()?.teams ?? [])]
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name))
    .map((t) => t.team_id));
  protected readonly sorted = computed(() => [...(this.state()?.teams ?? [])].sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)));
  protected readonly champion = computed<StandingRow | undefined>(() => this.sorted()[0]);
  protected readonly runnersUp = computed(() => this.sorted().filter((t) => t.rank === 2 || t.rank === 3).slice(0, 2));
  protected readonly podium = computed(() => {
    const top = this.sorted().slice(0, 3);
    return [top[1], top[0], top[2]].filter((x): x is StandingRow => !!x);
  });
  protected readonly rest = computed(() => this.sorted().slice(3));

  protected readonly confetti = Array.from({ length: 90 }, () => ({
    x: Math.random() * 100,
    c: ['#fbbf24', '#f97316', '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#ffffff'][Math.floor(Math.random() * 7)],
    d: Math.random() * 4,
    t: 3 + Math.random() * 3,
    s: 8 + Math.random() * 10,
  }));

  constructor() {
    // Lanza la animación de revelación cuando el juez pulsa «REVELAR GANADOR»
    effect(() => {
      const s = this.state();
      if (s?.mode !== 'champion' || !s.winner_revealed_at || s.winner_revealed_at === this.lastRevealHandled) return;
      this.lastRevealHandled = s.winner_revealed_at;
      const age = Date.now() - new Date(s.winner_revealed_at).getTime();
      if (age > 60000) { this.revealPhase.set('done'); return; }
      this.runRevealCountdown();
    });
  }

  ngOnInit(): void {
    this.accessKey = this.key() ?? this.readKey() ?? '';
    if (this.key()) this.storeKey(this.key()!);
    if (!this.accessKey) {
      this.error.set('Falta la clave de la pantalla.');
      return;
    }
    void this.load();
    this.live.watch(['tv', 'scores', 'teams', 'players', 'settings', 'spaghetti'], () => void this.load(), this.destroyRef);
    void this.keepAwake();
  }

  async load(): Promise<void> {
    try {
      const t0 = Date.now();
      const s = await this.sb.rpc<TvState>('get_tv_state', { p_key: this.accessKey });
      syncServerClock(s.server_now, t0);
      this.state.set(s);
      this.error.set('');
    } catch (e) {
      if (!this.state()) this.error.set((e as Error).message);
    }
  }

  private runRevealCountdown(): void {
    this.revealPhase.set('countdown');
    this.revealCount.set(3);
    const id = setInterval(() => {
      const n = this.revealCount() - 1;
      if (n <= 0) {
        clearInterval(id);
        this.revealPhase.set('done');
      } else {
        this.revealCount.set(n);
      }
    }, 1200);
    this.destroyRef.onDestroy(() => clearInterval(id));
  }

  protected fullscreen(): void {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen?.().catch(() => undefined);
  }

  private async keepAwake(): Promise<void> {
    try {
      const nav = navigator as Navigator & { wakeLock?: { request(type: 'screen'): Promise<unknown> } };
      await nav.wakeLock?.request('screen');
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'visible') void nav.wakeLock?.request('screen').catch(() => undefined);
      });
    } catch {
      /* no soportado */
    }
  }

  private readKey(): string | null {
    try { return localStorage.getItem(KEY_STORAGE); } catch { return null; }
  }
  private storeKey(k: string): void {
    try { localStorage.setItem(KEY_STORAGE, k); } catch { /* sin almacenamiento */ }
  }
}
