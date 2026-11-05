import { Component, OnInit, inject, input, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { toFriendlyMessage } from '../../core/supabase.service';
import { Spinner } from '../../shared/ui';

const INVITE_KEY = 'birthday-cup-invite';

/**
 * Entrada de invitados:
 *  - QR general: /?code=INVITACION  → nombre → jugador nuevo
 *  - QR personal: /?p=CODIGO8       → recupera la identidad del jugador
 */
@Component({
  selector: 'app-join-page',
  imports: [MatIcon, FormsModule, RouterLink, Spinner],
  template: `
    <main class="mx-auto flex min-h-dvh max-w-md flex-col px-5 pb-8 pt-[max(2.5rem,env(safe-area-inset-top))]">
      <header class="mb-8 text-center">
        <div class="mb-3 text-6xl drop-shadow-[0_0_25px_rgba(251,191,36,0.5)]">🏆</div>
        <h1 class="font-display gold-text text-6xl leading-none">BIRTHDAY CUP</h1>
        <p class="mt-2 text-sm uppercase tracking-[0.3em] text-slate-400">Competición por equipos</p>
      </header>

      @if (busy()) {
        <app-spinner label="Entrando en la competición…" />
      } @else if (mode() === 'personal') {
        <section class="card animate-rise">
          <h2 class="title-md mb-2">Acceso personal</h2>
          <p class="mb-4 text-sm text-slate-300">Este QR es tu acceso personal. Pulsa para recuperar tu identidad en este dispositivo.</p>
          @if (error()) { <p class="mb-3 rounded-lg bg-rose-950/60 p-3 text-sm text-rose-200">{{ error() }}</p> }
          <button class="btn-primary w-full text-base" (click)="claim()">Entrar como participante</button>
        </section>
      } @else {
        <form class="card animate-rise flex flex-col gap-4" (ngSubmit)="join()">
          <div>
            <label class="label" for="name">¿Cómo te llamas?</label>
            <input id="name" name="name" class="input text-lg" [(ngModel)]="name" autocomplete="nickname"
                   maxlength="40" placeholder="Tu nombre o apodo" required />
          </div>
          @if (!inviteFromUrl()) {
            <div>
              <label class="label" for="code">Código de invitación</label>
              <input id="code" name="code" class="input uppercase tracking-[0.3em]" [(ngModel)]="code"
                     maxlength="12" placeholder="ABC123" autocapitalize="characters" />
              <p class="mt-1 text-xs text-slate-500">Lo encontrarás junto al QR de la fiesta.</p>
            </div>
          }
          @if (error()) { <p class="rounded-lg bg-rose-950/60 p-3 text-sm text-rose-200">{{ error() }}</p> }
          <button type="submit" class="btn-primary text-base" [disabled]="name().trim().length < 2 || !code().trim()">
            ¡A competir! <mat-icon>rocket_launch</mat-icon>
          </button>
        </form>
      }

      <footer class="mt-auto pt-10 text-center">
        <a routerLink="/admin/login" class="text-xs text-slate-600 hover:text-slate-400">Acceso del juez</a>
      </footer>
    </main>
  `,
})
export class JoinPage implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  /** Parámetros de la URL (withComponentInputBinding) */
  readonly codeParam = input<string | undefined>(undefined, { alias: 'code' });
  readonly personalParam = input<string | undefined>(undefined, { alias: 'p' });

  protected readonly name = signal('');
  protected readonly code = signal('');
  protected readonly inviteFromUrl = signal(false);
  protected readonly mode = signal<'invite' | 'personal'>('invite');
  protected readonly busy = signal(true);
  protected readonly error = signal('');

  async ngOnInit(): Promise<void> {
    const invite = this.codeParam() ?? this.readStoredInvite();
    if (invite) {
      this.code.set(invite.toUpperCase());
      this.inviteFromUrl.set(!!this.codeParam());
      this.storeInvite(invite);
    }
    if (this.personalParam()) this.mode.set('personal');

    await this.auth.ready();
    const role = this.auth.role();
    if (role === 'admin' && !this.personalParam()) {
      await this.router.navigateByUrl('/admin');
      return;
    }
    if (role === 'player' && !this.personalParam()) {
      await this.router.navigateByUrl('/player');
      return;
    }
    this.busy.set(false);
  }

  async join(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      await this.auth.joinWithInvite(this.code().trim(), this.name().trim());
      await this.router.navigateByUrl('/player');
    } catch (e) {
      this.error.set(toFriendlyMessage(e));
      this.busy.set(false);
    }
  }

  async claim(): Promise<void> {
    this.error.set('');
    this.busy.set(true);
    try {
      if (this.auth.isAdmin()) {
        this.error.set('Estás conectado como juez. Abre este QR en el móvil del invitado.');
        this.busy.set(false);
        return;
      }
      await this.auth.joinWithPersonalCode(this.personalParam() ?? '');
      await this.router.navigateByUrl('/player');
    } catch (e) {
      this.error.set(toFriendlyMessage(e));
      this.busy.set(false);
    }
  }

  private readStoredInvite(): string | null {
    try { return localStorage.getItem(INVITE_KEY); } catch { return null; }
  }
  private storeInvite(v: string): void {
    try { localStorage.setItem(INVITE_KEY, v); } catch { /* sin almacenamiento */ }
  }
}
