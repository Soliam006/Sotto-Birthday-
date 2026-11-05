import { Component, OnDestroy, OnInit, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { Router, RouterLink, RouterLinkActive, RouterOutlet } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { ConfirmService } from '../../core/confirm.service';
import { AdminStore } from './admin-store';

interface NavItem { path: string; label: string; icon: string; exact?: boolean }

@Component({
  selector: 'app-admin-layout',
  imports: [MatIcon, RouterOutlet, RouterLink, RouterLinkActive],
  template: `
    <div class="min-h-dvh lg:flex">
      <!-- Barra lateral (escritorio) -->
      <aside class="sticky top-0 hidden h-dvh w-60 shrink-0 flex-col border-r border-white/5 bg-ink-900/80 p-4 lg:flex">
        <div class="mb-6">
          <p class="font-display gold-text text-3xl leading-none">BIRTHDAY CUP</p>
          <p class="text-xs uppercase tracking-[0.25em] text-slate-500">Panel del juez</p>
        </div>
        <nav class="flex flex-1 flex-col gap-1">
          @for (item of nav; track item.path) {
            <a [routerLink]="item.path" routerLinkActive="!bg-white/10 !text-white" [routerLinkActiveOptions]="{ exact: !!item.exact }"
               class="flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-semibold text-slate-400 transition hover:bg-white/5">
              <mat-icon class="icon-md">{{ item.icon }}</mat-icon>{{ item.label }}
              @if (item.path === '/admin/missions' && pendingCount()) { <span class="ml-auto chip bg-amber-500 text-ink-950">{{ pendingCount() }}</span> }
            </a>
          }
        </nav>
        <button class="btn-ghost justify-start text-slate-500" (click)="logout()"><mat-icon>logout</mat-icon> Cerrar sesión</button>
      </aside>

      <div class="min-w-0 flex-1 pb-24 lg:pb-8">
        <header class="sticky top-0 z-30 flex items-center justify-between border-b border-white/5 bg-ink-950/85 px-4 pb-3 pt-[max(0.75rem,env(safe-area-inset-top))] backdrop-blur-lg lg:hidden">
          <span class="font-display gold-text text-2xl">BIRTHDAY CUP</span>
          <span class="chip bg-amber-500/15 text-amber-300"><mat-icon>gavel</mat-icon> JUEZ</span>
        </header>
        @if (store.error()) {
          <div class="mx-4 mt-3 rounded-xl bg-rose-950/60 p-3 text-sm text-rose-200">{{ store.error() }}
            <button class="btn-ghost btn-sm" (click)="store.reloadAll()">Reintentar</button></div>
        }
        <main class="mx-auto max-w-5xl px-4 pt-4 lg:px-8 lg:pt-8">
          <router-outlet />
        </main>
      </div>

      <!-- Navegación inferior (móvil) -->
      <nav class="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-ink-900/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-lg lg:hidden">
        <ul class="grid grid-cols-5">
          @for (item of primary; track item.path) {
            <li>
              <a [routerLink]="item.path" routerLinkActive="!text-amber-300" [routerLinkActiveOptions]="{ exact: !!item.exact }"
                 class="relative flex flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold text-slate-400" (click)="moreOpen.set(false)">
                <mat-icon class="icon-md">{{ item.icon }}</mat-icon>{{ item.label }}
                @if (item.path === '/admin/missions' && pendingCount()) {
                  <span class="absolute right-3 top-1.5 grid size-4 place-items-center rounded-full bg-amber-500 text-[10px] text-ink-950">{{ pendingCount() }}</span>
                }
              </a>
            </li>
          }
          <li>
            <button type="button" class="flex w-full flex-col items-center gap-0.5 py-2.5 text-[10px] font-semibold"
                    [class]="moreOpen() ? 'text-amber-300' : 'text-slate-400'" (click)="moreOpen.set(!moreOpen())">
              <span class="text-xl"><mat-icon>menu</mat-icon></span>Más
            </button>
          </li>
        </ul>
      </nav>
      @if (moreOpen()) {
        <div class="fixed inset-0 z-30 bg-black/60 lg:hidden" (click)="moreOpen.set(false)">
          <div class="animate-rise absolute inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] rounded-t-3xl border-t border-white/10 bg-ink-850 p-4"
               (click)="$event.stopPropagation()">
            <div class="grid grid-cols-3 gap-2">
              @for (item of secondary; track item.path) {
                <a [routerLink]="item.path" (click)="moreOpen.set(false)" routerLinkActive="!border-amber-400/50"
                   class="flex flex-col items-center gap-1 rounded-2xl border border-white/5 bg-ink-800 p-3 text-xs font-semibold">
                  <mat-icon class="icon-lg">{{ item.icon }}</mat-icon>{{ item.label }}
                </a>
              }
              <button type="button" (click)="logout()" class="flex flex-col items-center gap-1 rounded-2xl border border-white/5 bg-ink-800 p-3 text-xs font-semibold text-slate-400">
                <span class="text-2xl"><mat-icon>logout</mat-icon></span>Salir
              </button>
            </div>
          </div>
        </div>
      }
    </div>
  `,
})
export class AdminLayout implements OnInit, OnDestroy {
  protected readonly store = inject(AdminStore);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly confirm = inject(ConfirmService);
  protected readonly moreOpen = signal(false);
  protected readonly pendingCount = computed(() => this.store.pending().missions + this.store.pending().discoveries);

  protected readonly nav: NavItem[] = [
    { path: '/admin', label: 'Dashboard', icon: 'dashboard', exact: true },
    { path: '/admin/players', label: 'Participantes', icon: 'group' },
    { path: '/admin/teams', label: 'Equipos', icon: 'shield' },
    { path: '/admin/modalities', label: 'Modalidades', icon: 'stadia_controller' },
    { path: '/admin/duels', label: 'Duelos', icon: 'chess' },
    { path: '/admin/missions', label: 'Misiones', icon: 'mystery' },
    { path: '/admin/scores', label: 'Puntuaciones', icon: 'leaderboard' },
    { path: '/admin/tv', label: 'Pantalla TV', icon: 'tv' },
    { path: '/admin/settings', label: 'Configuración', icon: 'settings' },
  ];
  protected readonly primary = this.nav.filter((n) => ['/admin', '/admin/modalities', '/admin/duels', '/admin/missions'].includes(n.path));
  protected readonly secondary = this.nav.filter((n) => !this.primary.includes(n));

  ngOnInit(): void {
    this.store.start();
  }
  ngOnDestroy(): void {
    this.store.stop();
  }

  async logout(): Promise<void> {
    this.moreOpen.set(false);
    if (!(await this.confirm.ask({ title: '¿Cerrar sesión?', message: 'Tendrás que volver a introducir tu email y contraseña.' }))) return;
    await this.auth.signOut();
    await this.router.navigateByUrl('/admin/login');
  }
}
