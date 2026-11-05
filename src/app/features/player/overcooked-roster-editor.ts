import { Component, computed, inject, input, output } from '@angular/core';
import { MatIcon } from '@angular/material/icon';
import { PlayerModalities } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { DraftFooter } from '../../shared/draft-footer';
import { VersionedDraft } from '../../shared/versioned-draft';
import { Member } from './crash-lineup-editor';

/**
 * Cocineros de la partida oficial de Overcooked (sin orden).
 * Misma mecánica que el orden de Crash: edición local y envío al pulsar
 * «Guardar», con control de versión (ver VersionedDraft).
 */
@Component({
  selector: 'app-overcooked-roster-editor',
  imports: [MatIcon, DraftFooter],
  template: `
    @let oc = overcooked();
    <section class="rounded-2xl border border-white/10 bg-ink-800/70 p-3">
      <div class="mb-1 flex items-center gap-2">
        <mat-icon class="text-amber-300">groups</mat-icon>
        <h3 class="flex-1 font-semibold">Cocineros de tu equipo</h3>
        <span class="chip" [class]="state.draft().length === oc.required ? 'bg-emerald-500/15 text-emerald-300' : 'bg-amber-500/15 text-amber-300'">
          {{ state.draft().length }} / {{ oc.required }}
        </span>
      </div>
      @if (oc.lock_reason) {
        <p class="mb-3 flex items-center gap-1.5 text-xs text-slate-400"><mat-icon class="icon-sm">lock</mat-icon> {{ oc.lock_reason }}</p>
      } @else {
        <p class="mb-3 text-xs text-slate-400">
          Elegid entre todos quién juega la partida oficial ({{ oc.required }} {{ oc.required === 1 ? 'cocinero' : 'cocineros' }}). El orden no importa.
          Los cambios no se envían hasta pulsar «Guardar».
        </p>
      }

      <ul class="grid grid-cols-2 gap-1.5">
        @for (m of members(); track m.id) {
          @let on = selected().has(m.id);
          <li>
            <button type="button" (click)="toggle(m.id)" [disabled]="!oc.can_edit_roster" [attr.aria-pressed]="on"
                    class="flex w-full items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition disabled:cursor-default"
                    [class]="on ? 'border-amber-400/60 bg-amber-400/10 text-white' : 'border-white/5 bg-ink-900 text-slate-300'">
              <mat-icon class="icon-md" [class.icon-fill]="on" [class.text-amber-300]="on">{{ on ? 'check_circle' : 'radio_button_unchecked' }}</mat-icon>
              <span class="min-w-0 flex-1 truncate">{{ m.name }}{{ m.id === me() ? ' (tú)' : '' }}</span>
            </button>
          </li>
        }
      </ul>

      @if (oc.can_edit_roster && state.draft().length !== oc.required) {
        <p class="mt-2 text-xs text-amber-300">
          {{ state.draft().length < oc.required ? 'Faltan ' + (oc.required - state.draft().length) : 'Sobran ' + (state.draft().length - oc.required) }} por elegir.
        </p>
      }

      <app-draft-footer [draft]="state" [updatedBy]="oc.roster_updated_by" [updatedAt]="oc.roster_updated_at"
                        [valid]="state.draft().length === oc.required" [enabled]="oc.can_edit_roster" (save)="save()" />
    </section>
  `,
})
export class OvercookedRosterEditor {
  readonly overcooked = input.required<PlayerModalities['overcooked']>();
  readonly members = input.required<Member[]>();
  readonly me = input<string | null | undefined>(null);
  readonly reload = output<void>();

  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);

  protected readonly state = new VersionedDraft(
    () => ({ ids: this.overcooked().roster, version: this.overcooked().roster_version }),
    false,
  );
  protected readonly selected = computed(() => new Set(this.state.draft()));

  toggle(id: string): void {
    const cur = this.state.draft();
    if (cur.includes(id)) {
      this.state.set(cur.filter((x) => x !== id));
    } else if (cur.length >= this.overcooked().required) {
      this.toast.info(`Ya hay ${this.overcooked().required} cocineros: quita a alguien antes de añadir a otro.`);
    } else {
      this.state.set([...cur, id]);
    }
  }

  save(): Promise<void> {
    return this.state.save(
      async (ids, version) =>
        (await this.sb.rpc<{ version: number }>('player_overcooked_set_roster', { p_player_ids: ids, p_expected_version: version })).version,
      { toast: this.toast, successMessage: 'Cocineros guardados. ¡Tu equipo ya lo ve!', reload: () => this.reload.emit() },
    );
  }
}
