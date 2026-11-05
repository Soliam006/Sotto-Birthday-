import { Component, OnInit, computed, inject, signal } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { FormsModule } from '@angular/forms';
import { ConfirmService } from '../../core/confirm.service';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { QrCodeView } from '../../shared/qr-code';
import { AdminStore } from './admin-store';

@Component({
  selector: 'app-admin-settings',
  imports: [MatIcon, FormsModule, QrCodeView],
  template: `
    <h1 class="title-xl mb-4">Configuración</h1>
    @if (store.settings(); as s) {
      <div class="grid gap-4 lg:grid-cols-2">
        <section class="card">
          <h2 class="section-title"><mat-icon>qr_code_2</mat-icon> QR de invitación</h2>
          <app-qr [text]="inviteUrl()" [size]="220" />
          <p class="mt-3 text-center text-sm">Código: <b class="font-display text-2xl tracking-[0.3em] text-amber-300">{{ s.invite_code }}</b></p>
          <div class="mt-3 flex flex-wrap gap-2">
            <button class="btn-secondary flex-1" (click)="print()"><mat-icon>print</mat-icon> Imprimir</button>
            <button class="btn-ghost" (click)="regenerate()"><mat-icon>refresh</mat-icon> Nuevo código</button>
          </div>
          <label class="mt-4 flex items-center justify-between gap-3 rounded-xl bg-ink-800 p-3">
            <span class="text-sm"><b>Registro abierto</b><br /><span class="text-xs text-slate-400">Si lo cierras, solo podrán entrar con su QR personal.</span></span>
            <input type="checkbox" class="size-6" [checked]="s.registration_open" (change)="toggle('registration_open', !s.registration_open)" />
          </label>
        </section>

        <section class="card">
          <h2 class="section-title"><mat-icon>label</mat-icon> Competición</h2>
          <form class="grid gap-3" (ngSubmit)="saveNames()">
            <div><label class="label" for="cname">Nombre</label><input id="cname" class="input" name="name" [(ngModel)]="name" maxlength="60" /></div>
            <div><label class="label" for="csub">Subtítulo (p. ej. «Los 30 de Marta»)</label><input id="csub" class="input" name="subtitle" [(ngModel)]="subtitle" maxlength="80" /></div>
            <button class="btn-secondary" type="submit">Guardar</button>
          </form>

          <h2 class="section-title mt-6"><mat-icon>visibility</mat-icon> Visibilidad de puntuaciones para jugadores</h2>
          <div class="grid grid-cols-2 gap-2">
            <button class="btn" [class]="s.scores_visible ? 'btn-primary' : 'btn-secondary'" (click)="setVisible(true)"><mat-icon>visibility</mat-icon> Visible</button>
            <button class="btn" [class]="!s.scores_visible ? 'btn-primary' : 'btn-secondary'" (click)="setVisible(false)"><mat-icon>visibility_off</mat-icon> Oculta</button>
          </div>
          <p class="mt-2 text-xs text-slate-500">Cuando está oculta, el servidor no entrega puntos ni posiciones a los jugadores. La TV se controla aparte.</p>

          <h2 class="section-title mt-6"><mat-icon>traffic</mat-icon> Estado</h2>
          <p class="text-sm text-slate-300">Competición: <b>{{ statusLabel() }}</b></p>
          @if (s.status === 'finished') {
            <button class="btn-ghost btn-sm mt-2" (click)="setStatus('running')"><mat-icon>undo</mat-icon> Reabrir competición</button>
          } @else {
            <button class="btn-secondary btn-sm mt-2" (click)="setStatus('finished')"><mat-icon>sports_score</mat-icon> Finalizar competición</button>
          }
        </section>
      </div>

      <!-- Hoja imprimible -->
      <div id="print-sheet" class="hidden">
        <h1>{{ s.name }}</h1>
        <p>{{ s.subtitle }}</p>
        <app-qr [text]="inviteUrl()" [size]="420" [showText]="false" />
        <p>Escanea para unirte · Código <b>{{ s.invite_code }}</b></p>
      </div>
    }
  `,
  styles: `
    @media print {
      :host ::ng-deep body * { visibility: hidden; }
      #print-sheet, #print-sheet * { visibility: visible; }
      #print-sheet { display: flex !important; position: fixed; inset: 0; flex-direction: column; align-items: center; justify-content: center; gap: 16px; background: #fff; color: #000; font-size: 28px; text-align: center; }
    }
  `,
})
export class AdminSettings implements OnInit {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  protected name = '';
  protected subtitle = '';
  protected readonly inviteUrl = computed(() => `${location.origin}/?code=${this.store.settings()?.invite_code ?? ''}`);
  protected readonly statusLabel = computed(() => ({ setup: 'En preparación', running: 'En marcha', finished: 'Finalizada' })[this.store.settings()?.status ?? 'setup']);
  protected readonly busy = signal(false);

  ngOnInit(): void {
    const s = this.store.settings();
    this.name = s?.name ?? '';
    this.subtitle = s?.subtitle ?? '';
  }

  private async update(patch: Record<string, unknown>): Promise<void> {
    await this.sb.q(this.sb.client.from('competition_settings').update(patch).eq('id', 1).select('id'));
    await this.store.loadSettings();
  }

  async toggle(key: 'registration_open', value: boolean): Promise<void> {
    try {
      await this.update({ [key]: value });
      this.toast.success(value ? 'Registro abierto' : 'Registro cerrado');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async saveNames(): Promise<void> {
    try {
      await this.update({ name: this.name.trim() || 'BIRTHDAY CUP', subtitle: this.subtitle.trim() });
      this.toast.success('Guardado');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async setVisible(v: boolean): Promise<void> {
    if (this.store.settings()?.scores_visible === v) return;
    try {
      await this.update({ scores_visible: v });
      this.toast.success(v ? 'Clasificación visible para jugadores' : 'Clasificación oculta para jugadores');
    } catch (e) {
      this.toast.error(e);
    }
  }

  async regenerate(): Promise<void> {
    if (!(await this.confirm.ask({ title: 'Nuevo código de invitación', message: 'El QR anterior dejará de funcionar. Los jugadores ya conectados no se ven afectados.' }))) return;
    try {
      await this.sb.rpc('admin_regenerate_invite_code');
      await this.store.loadSettings();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async setStatus(status: 'running' | 'finished'): Promise<void> {
    if (!(await this.confirm.ask({ title: status === 'finished' ? 'Finalizar competición' : 'Reabrir competición', message: status === 'finished' ? 'No se podrán registrar más puntos hasta reabrirla.' : '' }))) return;
    try {
      await this.sb.rpc('admin_set_competition_status', { p_status: status });
      await this.store.loadSettings();
    } catch (e) {
      this.toast.error(e);
    }
  }

  print(): void {
    window.print();
  }
}
