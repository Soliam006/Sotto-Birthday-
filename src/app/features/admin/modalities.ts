import { Component, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { RouterLink } from '@angular/router';
import { CHALLENGE_ICONS, Challenge } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { AdminStore } from './admin-store';
import { ChallengeControls } from './challenge-controls';

@Component({
  selector: 'app-admin-modalities',
  imports: [RouterLink, FormsModule, ChallengeControls],
  template: `
    <h1 class="title-xl mb-4">Modalidades</h1>
    <div class="flex flex-col gap-4">
      @for (c of store.challenges(); track c.id) {
        <article class="card">
          <app-challenge-controls [kind]="c.kind" />
          <p class="mb-3 text-sm text-slate-300">{{ c.description }}</p>
          <div class="flex flex-wrap gap-2">
            <a class="btn-primary btn-sm" [routerLink]="link(c)">{{ icons[c.kind] }} Gestionar</a>
            <button class="btn-secondary btn-sm" (click)="toggleEdit(c)">✏️ Textos y puntos</button>
          </div>

          @if (editing() === c.id) {
            <form class="mt-4 grid gap-3 border-t border-white/5 pt-4" (ngSubmit)="save(c)">
              <div><label class="label" [for]="'n' + c.id">Nombre</label><input class="input" [id]="'n' + c.id" name="name" [(ngModel)]="form.name" /></div>
              <div><label class="label" [for]="'t' + c.id">Subtítulo</label><input class="input" [id]="'t' + c.id" name="tagline" [(ngModel)]="form.tagline" /></div>
              <div><label class="label" [for]="'d' + c.id">Descripción</label><textarea class="input min-h-20" [id]="'d' + c.id" name="description" [(ngModel)]="form.description"></textarea></div>
              <div><label class="label" [for]="'r' + c.id">Reglas (visibles para jugadores)</label><textarea class="input min-h-32" [id]="'r' + c.id" name="rules" [(ngModel)]="form.rules"></textarea></div>
              <div>
                <label class="label" [for]="'c' + c.id">Configuración de puntos (JSON)</label>
                <textarea class="input min-h-24 font-mono text-xs" [id]="'c' + c.id" name="config" [(ngModel)]="form.config"></textarea>
                <p class="mt-1 text-xs text-slate-500">Las tablas de puntos indican los puntos por posición (1º, 2º, 3º…). No se pueden cambiar con resultados ya registrados.</p>
              </div>
              <div class="flex gap-2">
                <button type="button" class="btn-ghost flex-1" (click)="editing.set(null)">Cancelar</button>
                <button type="submit" class="btn-primary flex-1">Guardar</button>
              </div>
            </form>
          }
        </article>
      }
    </div>
  `,
})
export class AdminModalities {
  protected readonly store = inject(AdminStore);
  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  protected readonly icons = CHALLENGE_ICONS;
  protected readonly editing = signal<string | null>(null);
  protected form = { name: '', tagline: '', description: '', rules: '', config: '' };

  link(c: Challenge): string {
    return c.kind === 'duels' ? '/admin/duels' : c.kind === 'missions' ? '/admin/missions' : `/admin/modalities/${c.kind}`;
  }

  toggleEdit(c: Challenge): void {
    if (this.editing() === c.id) { this.editing.set(null); return; }
    const { race_count: _rc, ...cfg } = c.config as Record<string, unknown>;
    this.form = { name: c.name, tagline: c.tagline, description: c.description, rules: c.rules, config: JSON.stringify(cfg, null, 1) };
    this.editing.set(c.id);
  }

  async save(c: Challenge): Promise<void> {
    let cfg: Record<string, unknown>;
    try {
      cfg = JSON.parse(this.form.config || '{}');
    } catch {
      this.toast.error('La configuración no es un JSON válido.');
      return;
    }
    try {
      await this.sb.q(this.sb.client.from('challenges').update({
        name: this.form.name.trim(), tagline: this.form.tagline.trim(),
        description: this.form.description.trim(), rules: this.form.rules.trim(),
      }).eq('id', c.id).select('id'));
      const changed = Object.fromEntries(Object.entries(cfg).filter(([k, v]) => JSON.stringify(c.config[k]) !== JSON.stringify(v)));
      if (Object.keys(changed).length) {
        await this.sb.rpc('admin_update_challenge_config', { p_challenge_id: c.id, p_config: changed });
      }
      this.toast.success('Modalidad actualizada');
      this.editing.set(null);
      await this.store.loadChallenges();
    } catch (e) {
      this.toast.error(e);
    }
  }
}
