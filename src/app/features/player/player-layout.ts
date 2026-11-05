import { Component, OnInit, inject } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { PlayerStore } from './player-store';

@Component({
  selector: 'app-player-layout',
  imports: [MatIcon, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    @let team = store.team();
    <div class="min-h-dvh pb-24" [style.--team]="team?.color ?? '#a78bfa'">
      <header class="sticky top-0 z-30 border-b border-white/5 bg-ink-950/80 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-lg">
        <div class="mx-auto flex max-w-xl items-center justify-between gap-3">
          <span class="font-display gold-text text-2xl">BIRTHDAY CUP</span>
          @if (store.state()?.player; as p) {
            <span class="flex min-w-0 items-center gap-2 rounded-full bg-white/5 py-1 pl-1 pr-3 text-sm">
              <span class="grid size-7 place-items-center rounded-full font-bold text-ink-950"
                    [style.background]="team?.color ?? '#64748b'">{{ p.name.charAt(0).toUpperCase() }}</span>
              <span class="truncate font-semibold">{{ p.name }}</span>
            </span>
          }
        </div>
        <div class="absolute inset-x-0 bottom-0 h-0.5" [style.background]="'linear-gradient(90deg, transparent, ' + (team?.color ?? '#a78bfa') + ', transparent)'"></div>
      </header>

      <main class="mx-auto max-w-xl px-4 pt-4">
        <router-outlet />
      </main>

      <nav class="fixed inset-x-0 bottom-0 z-30 border-t border-white/10 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg">
        <ul class="mx-auto grid max-w-xl grid-cols-4">
          @for (item of nav; track item.path) {
            <li>
              <a [routerLink]="item.path" routerLinkActive="!text-white [&_.ico]:scale-110 [&_.bar]:opacity-100"
                 [routerLinkActiveOptions]="{ exact: item.path === '/player' }"
                 class="relative flex flex-col items-center gap-0.5 py-2.5 text-[11px] font-semibold text-slate-400 transition">
                <span class="bar absolute inset-x-6 top-0 h-0.5 rounded-full opacity-0 transition" [style.background]="team?.color ?? '#fbbf24'"></span>
                <mat-icon class="ico icon-md transition">{{ item.icon }}</mat-icon>
                {{ item.label }}
              </a>
            </li>
          }
        </ul>
      </nav>
    </div>
  `,
})
export class PlayerLayout implements OnInit {
  protected readonly store = inject(PlayerStore);
  protected readonly nav = [
    { path: '/player', label: 'Inicio', icon: 'home' },
    { path: '/player/modalities', label: 'Modalidades', icon: 'stadia_controller' },
    { path: '/player/missions', label: 'Mis misiones', icon: 'mystery' },
    { path: '/player/team', label: 'Mi equipo', icon: 'shield' },
  ];
  ngOnInit(): void {
    this.store.start();
  }
}
