import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { TvMode, TvSettings } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { QrCodeView } from '../../shared/qr-code';
import { Spinner } from '../../shared/ui';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-tv',
  imports: [FormsModule, QrCodeView, Spinner],
  template: `
    <h1 class="title-xl mb-1">Pantalla TV</h1>
    <p class="mb-4 text-sm text-slate-400">Abre el enlace en el navegador de la televisión. Funciona de forma independiente: puedes cerrar este panel.</p>

    @if (tv(); as t) {
      <section class="card mb-4">
        <h2 class="section-title">📺 ¿Qué muestra la TV?</h2>
        <div class="grid grid-cols-2 gap-2 sm:grid-cols-3">
          @for (m of modes; track m.id) {
            <button class="flex flex-col items-start gap-1 rounded-2xl border p-3 text-left transition"
                    [class]="t.mode === m.id ? 'border-amber-400 bg-amber-400/10' : 'border-white/5 bg-ink-800'"
                    [disabled]="m.needsReveal && !revealed()" [class.opacity-40]="m.needsReveal && !revealed()" (click)="setMode(m.id)">
              <span class="text-2xl">{{ m.icon }}</span>
              <span class="text-sm font-semibold">{{ m.label }}</span>
              <span class="text-xs text-slate-400">{{ m.hint }}</span>
            </button>
          }
        </div>
        <p class="mt-3 text-xs text-slate-500">Independiente de la visibilidad para jugadores (ahora: {{ store.settings()?.scores_visible ? 'visible' : 'oculta' }}).</p>
      </section>

      <section class="card mb-4 border-amber-400/40 bg-gradient-to-br from-amber-500/10 to-transparent">
        <h2 class="section-title">👑 Final de la competición</h2>
        @if (store.settings()?.status !== 'finished') {
          <p class="mb-3 text-sm text-slate-300">Cuando terminen todas las pruebas, finaliza la competición. Se bloquearán nuevos puntos.</p>
          <button class="btn-secondary w-full" (click)="finishCompetition()">🏁 Finalizar competición</button>
        } @else {
          <p class="mb-3 text-sm text-slate-300">Competición finalizada. Pulsa para lanzar la animación de revelación en la TV.</p>
          <button class="btn-primary w-full py-4 text-lg" (click)="reveal()">🏆 REVELAR GANADOR</button>
          <div class="mt-2 flex flex-wrap gap-2">
            <button class="btn-ghost btn-sm" (click)="reopen()">↩️ Reabrir competición</button>
          </div>
        }
      </section>

      <section class="card mb-4">
        <h2 class="section-title">💬 Pantalla de espera</h2>
        <textarea class="input min-h-16" [(ngModel)]="message" name="msg" maxlength="200"></textarea>
        <label class="mt-3 flex items-center gap-2 text-sm"><input type="checkbox" [(ngModel)]="showTimer" name="timer" class="size-5" /> Mostrar el cronómetro de Spaghetti cuando esté en marcha</label>
        <button class="btn-secondary mt-3 w-full" (click)="saveText()">Guardar</button>
      </section>

      <section class="card">
        <h2 class="section-title">🔗 Enlace de la TV</h2>
        <app-qr [text]="tvUrl()" [size]="180" />
        <div class="mt-3 flex flex-wrap gap-2">
          <a class="btn-primary flex-1" [href]="tvUrl()" target="_blank" rel="noopener">Abrir pantalla TV ↗</a>
          <button class="btn-secondary" (click)="copy()">📋 Copiar</button>
          <button class="btn-ghost" (click)="rotate()">🔑 Nueva clave</button>
        </div>
        <p class="mt-2 text-xs text-slate-500">La clave da acceso solo de lectura a la clasificación según el modo elegido. No otorga permisos de juez.</p>
      </section>
    } @else { <app-spinner /> }
  `,
})
export class AdminTv implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);

  protected readonly tv = signal<TvSettings | null>(null);
  protected message = '';
  protected showTimer = true;
  protected readonly revealed = computed(() => !!this.store.settings()?.winner_revealed_at);
  protected readonly tvUrl = computed(() => `${location.origin}/tv?key=${this.tv()?.access_key ?? ''}`);

  protected readonly modes: { id: TvMode; icon: string; label: string; hint: string; needsReveal?: boolean }[] = [
    { id: 'leaderboard', icon: '🏆', label: 'Clasificación', hint: 'Con puntuaciones' },
    { id: 'leaderboard_no_scores', icon: '🎭', label: 'Sin puntuaciones', hint: 'Solo posiciones' },
    { id: 'waiting', icon: '⏳', label: 'Espera', hint: 'Equipos y mensaje' },
    { id: 'final_results', icon: '📊', label: 'Resultados finales', hint: 'Tras revelar', needsReveal: true },
    { id: 'champion', icon: '👑', label: 'Campeón', hint: 'Tras revelar', needsReveal: true },
  ];

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  async load(): Promise<void> {
    try {
      const t = await this.sb.q<TvSettings>(this.sb.client.from('tv_settings').select('*').eq('id', 1).single());
      this.tv.set(t);
      this.message = t.message;
      this.showTimer = t.show_timer;
    } catch (e) {
      this.toast.error(e);
    }
  }

  async setMode(mode: TvMode): Promise<void> {
    try {
      await this.sb.rpc('admin_set_tv_mode', { p_mode: mode });
      this.tv.update((t) => (t ? { ...t, mode } : t));
      this.toast.success('Pantalla TV actualizada');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async saveText(): Promise<void> {
    try {
      await this.sb.q(this.sb.client.from('tv_settings').update({ message: this.message.trim(), show_timer: this.showTimer }).eq('id', 1).select('id'));
      this.toast.success('Guardado');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async finishCompetition(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Finalizar competición', message: 'No se podrán registrar más puntos (puedes reabrirla si es necesario). Después podrás revelar al ganador.' }))) return;
    try {
      await this.sb.rpc('admin_set_competition_status', { p_status: 'finished' });
      await this.store.loadSettings();
      this.toast.success('Competición finalizada');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async reopen(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Reabrir competición', message: 'Se volverán a permitir puntos y la TV volverá a la clasificación.' }))) return;
    try {
      await this.sb.rpc('admin_set_competition_status', { p_status: 'running' });
      await Promise.all([this.store.loadSettings(), this.load()]);
    } catch (e) {
      this.toast.error(e);
    }
  }

  async reveal(): Promise<void> {
    if (!(await this.confirm.ask({ title: '🏆 Revelar ganador', message: 'La televisión mostrará ahora la animación con el equipo campeón.', confirmText: '¡Revelar!' }))) return;
    try {
      await this.sb.rpc('admin_reveal_winner');
      await Promise.all([this.store.loadSettings(), this.load()]);
      this.toast.points('¡Ganador revelado en la TV!');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async rotate(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Generar nueva clave', message: 'La TV actual dejará de funcionar hasta que abras el nuevo enlace.' }))) return;
    try {
      await this.sb.rpc('admin_rotate_tv_key');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async copy(): Promise<void> {
    try {
      await navigator.clipboard.writeText(this.tvUrl());
      this.toast.success('Enlace copiado');
    } catch {
      this.toast.info(this.tvUrl());
    }
  }
}
