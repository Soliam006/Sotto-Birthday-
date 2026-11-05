import { Component, OnInit, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { toFriendlyMessage } from '../../core/supabase.service';

@Component({
  selector: 'app-admin-login',
  imports: [MatIcon, FormsModule, RouterLink],
  template: `
    <main class="mx-auto flex min-h-dvh max-w-sm flex-col justify-center px-5 py-10">
      <div class="mb-6 text-center">
        <div class="text-5xl"><mat-icon>gavel</mat-icon></div>
        <h1 class="font-display gold-text text-5xl">PANEL DEL JUEZ</h1>
        <p class="text-sm text-slate-400">BIRTHDAY CUP</p>
      </div>
      <form class="card flex flex-col gap-4" (ngSubmit)="submit()">
        <div>
          <label class="label" for="email">Email</label>
          <input id="email" name="email" type="email" class="input" autocomplete="username" [(ngModel)]="email" required />
        </div>
        <div>
          <label class="label" for="password">Contraseña</label>
          <input id="password" name="password" type="password" class="input" autocomplete="current-password" [(ngModel)]="password" required />
        </div>
        @if (error()) { <p class="rounded-lg bg-rose-950/60 p-3 text-sm text-rose-200">{{ error() }}</p> }
        <button type="submit" class="btn-primary" [disabled]="busy() || !email() || !password()">
          {{ busy() ? 'Entrando…' : 'Entrar' }}
        </button>
      </form>
      @if (isPlayer()) {
        <p class="mt-4 rounded-xl bg-amber-500/10 p-3 text-xs text-amber-200">
          Este dispositivo está vinculado a un jugador. Si inicias sesión como juez, se cerrará esa sesión de jugador.
        </p>
      }
      <a routerLink="/" class="mt-6 text-center text-xs text-slate-500"><mat-icon>arrow_back</mat-icon> Volver</a>
    </main>
  `,
})
export class AdminLogin implements OnInit {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  protected readonly email = signal('');
  protected readonly password = signal('');
  protected readonly busy = signal(false);
  protected readonly error = signal('');
  protected readonly isPlayer = signal(false);

  async ngOnInit(): Promise<void> {
    await this.auth.ready();
    if (this.auth.isAdmin()) await this.router.navigateByUrl('/admin');
    this.isPlayer.set(this.auth.role() === 'player');
  }

  async submit(): Promise<void> {
    this.busy.set(true);
    this.error.set('');
    try {
      await this.auth.signInAdmin(this.email().trim(), this.password());
      await this.router.navigateByUrl('/admin');
    } catch (e) {
      this.error.set(toFriendlyMessage(e));
    } finally {
      this.busy.set(false);
    }
  }
}
