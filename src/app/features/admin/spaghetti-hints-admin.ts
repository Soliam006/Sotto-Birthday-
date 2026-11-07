import { Component, DestroyRef, OnInit, computed, inject, input, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList, moveItemInArray } from '@angular/cdk/drag-drop';
import { MatIcon } from '@angular/material/icon';
import { elapsedMs, formatClock, formatMs, syncServerClock } from '../../core/clock';
import { ConfirmService } from '../../core/confirm.service';
import { LiveService } from '../../core/live.service';
import { SpaghettiHint, SpaghettiState } from '../../core/models';
import { SupabaseService } from '../../core/supabase.service';
import { ToastService } from '../../core/toast.service';
import { ImageLightbox } from '../../shared/image-lightbox';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

/**
 * Gestión de las pistas de Spaghetti (juez): subir, titular, ordenar,
 * sustituir, eliminar y abrir antes de tiempo. El calendario lo calcula el
 * servidor (admin_spaghetti_get_hints); aquí solo se muestran las cuentas atrás.
 */
@Component({
  selector: 'app-spaghetti-hints-admin',
  imports: [MatIcon, FormsModule, CdkDropList, CdkDrag, CdkDragHandle, ImageLightbox],
  template: `
    <section class="card mt-4">
      <h2 class="section-title"><mat-icon>tips_and_updates</mat-icon> Pistas</h2>
      <p class="mb-3 text-xs text-slate-400">
        Se abren solas según el tiempo de prueba: la pista 1 al minuto {{ clock(firstSeconds()) }} y las siguientes cada {{ intervalMinutes() }} min.
        Las pausas no cuentan. Al terminar la prueba se abren todas. Los jugadores solo ven la imagen de las pistas abiertas.
      </p>

      <!-- Añadir -->
      <div class="mb-4 flex flex-col gap-2 rounded-xl border border-dashed border-white/10 p-3 sm:flex-row">
        <input class="input flex-1" placeholder="Título (opcional), p. ej. «Base triangular»" maxlength="80"
               [(ngModel)]="newTitle" name="newTitle" aria-label="Título de la nueva pista" />
        <label class="btn-primary cursor-pointer">
          <mat-icon>{{ uploading() ? 'hourglass_top' : 'add_photo_alternate' }}</mat-icon> {{ uploading() ? 'Subiendo…' : 'Añadir pista' }}
          <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" (change)="add($event)" [disabled]="uploading()" />
        </label>
      </div>

      @if (hints().length) {
        <ol cdkDropList [cdkDropListSortPredicate]="canDropAt" (cdkDropListDropped)="drop($event)" class="flex flex-col gap-2">
          @for (r of rows(); track r.hint.id; let i = $index) {
            @let h = r.hint;
            <li cdkDrag [cdkDragDisabled]="r.fixed" cdkDragLockAxis="y"
                class="rounded-xl border bg-ink-900 p-2.5"
                [class]="r.open ? 'border-amber-400/40' : 'border-white/5'">
              <div class="flex items-center gap-2">
                @if (r.fixed) {
                  <mat-icon class="text-slate-600" aria-label="Pista abierta: no se puede mover">lock</mat-icon>
                } @else {
                  <button type="button" cdkDragHandle class="grid size-8 shrink-0 cursor-grab touch-none place-items-center text-slate-400" [attr.aria-label]="'Mover pista ' + h.number">
                    <mat-icon>drag_indicator</mat-icon>
                  </button>
                }
                <div class="w-20 shrink-0"><app-image-lightbox [src]="imageUrl(h.image_path!)" [alt]="'Pista ' + h.number" [compact]="true" /></div>
                <div class="min-w-0 flex-1">
                  <p class="flex flex-wrap items-center gap-x-2 gap-y-1 font-semibold">
                    <span class="whitespace-nowrap">Pista {{ h.number }}</span>
                    @if (r.open) {
                      <span class="chip bg-amber-500/15 text-amber-300"><mat-icon class="icon-xs">lock_open</mat-icon>{{ h.opened_manually ? 'Abierta a mano' : 'Abierta' }}</span>
                    } @else if (r.msLeft !== null) {
                      <span class="chip bg-white/5 text-slate-300 tabular-nums">{{ paused() ? 'En pausa · ' : '' }}en {{ fmt(r.msLeft) }}</span>
                    }
                  </p>
                  <p class="mt-0.5 text-[11px]" [class]="r.beyond ? 'text-rose-300' : 'text-slate-500'">
                    Se abre al minuto {{ clock(h.open_at_seconds) }}
                    @if (r.beyond) { · no llegará a abrirse: la prueba dura {{ clock(durationSeconds()) }} }
                  </p>
                </div>
              </div>
              <input class="input mt-2 min-h-9 py-1.5 text-sm" [ngModel]="h.title ?? ''" (change)="rename(h, $any($event.target).value)"
                     maxlength="80" placeholder="Sin título (opcional)" [attr.aria-label]="'Título de la pista ' + h.number" />
              <div class="mt-2 flex flex-wrap justify-end gap-1">
                @if (active() && !r.open) {
                  <button type="button" class="btn-secondary btn-sm" (click)="openNow(h)"><mat-icon>lock_open</mat-icon> Abrir ya</button>
                }
                @if (!(active() && r.open)) {
                  <label class="btn-ghost btn-sm cursor-pointer">
                    <mat-icon>swap_horiz</mat-icon> Cambiar imagen
                    <input type="file" accept="image/png,image/jpeg,image/webp,image/gif" class="hidden" (change)="replace(h, $event)" />
                  </label>
                  <button type="button" class="btn-ghost btn-sm text-rose-300" (click)="remove(h)" [attr.aria-label]="'Eliminar pista ' + h.number">
                    <mat-icon>delete</mat-icon> Eliminar
                  </button>
                }
              </div>
            </li>
          }
        </ol>
      } @else {
        <p class="text-sm text-slate-500">Aún no hay pistas. Añade imágenes de piezas o de cómo montar partes de la estructura.</p>
      }
    </section>
  `,
})
export class SpaghettiHintsAdmin implements OnInit {
  /** Estado del cronómetro (lo carga la página padre) */
  readonly timer = input.required<SpaghettiState>();

  private readonly sb = inject(SupabaseService);
  private readonly toast = inject(ToastService);
  private readonly confirm = inject(ConfirmService);
  private readonly live = inject(LiveService);
  private readonly destroyRef = inject(DestroyRef);

  protected readonly hints = signal<SpaghettiHint[]>([]);
  protected readonly uploading = signal(false);
  protected newTitle = '';
  private readonly tick = signal(0);
  private lastReload = 0;

  protected readonly active = computed(() => ['running', 'paused'].includes(this.timer().timer_status));
  protected readonly paused = computed(() => this.timer().timer_status === 'paused');
  protected readonly durationSeconds = computed(() => this.timer().duration_seconds);
  protected readonly firstSeconds = computed(() => this.hints()[0]?.open_at_seconds ?? 60);
  protected readonly intervalMinutes = computed(() => {
    const h = this.hints();
    return h.length > 1 ? (h[1].open_at_seconds - h[0].open_at_seconds) / 60 : 3;
  });

  protected readonly rows = computed(() => {
    this.tick();
    const elapsed = elapsedMs({ ...this.timer() });
    return this.hints().map((hint) => {
      const reached = elapsed !== null && elapsed >= hint.open_at_seconds * 1000;
      const open = hint.is_open || reached;
      return {
        hint,
        open,
        /** Con la prueba en marcha, las abiertas no se mueven */
        fixed: this.active() && open,
        msLeft: open || elapsed === null ? null : hint.open_at_seconds * 1000 - elapsed,
        beyond: hint.open_at_seconds >= this.durationSeconds(),
      };
    });
  });

  protected readonly canDropAt = (index: number): boolean => !this.rows()[index]?.fixed;

  ngOnInit(): void {
    void this.load();
    this.live.watch(['spaghetti'], () => void this.load(), this.destroyRef);
    const id = setInterval(() => {
      this.tick.update((v) => v + 1);
      // Al llegar la hora de una pista se refresca el estado oficial del servidor
      if (this.timer().timer_status === 'running' && this.rows().some((r) => r.open && !r.hint.is_open) && Date.now() - this.lastReload > 3000) {
        this.lastReload = Date.now();
        void this.load();
      }
    }, 500);
    this.destroyRef.onDestroy(() => clearInterval(id));
  }

  async load(): Promise<void> {
    try {
      const t0 = Date.now();
      const r = await this.sb.rpc<{ hints: SpaghettiHint[]; server_now: string }>('admin_spaghetti_get_hints');
      syncServerClock(r.server_now, t0);
      this.hints.set(r.hints);
    } catch (e) {
      this.toast.error(e);
    }
  }

  private async uploadImage(file: File): Promise<string> {
    if (file.size > MAX_IMAGE_BYTES) throw new Error('La imagen supera los 10 MB.');
    const ext = (file.name.split('.').pop() || 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    const path = `spaghetti/hints/${crypto.randomUUID()}.${ext}`;
    const { error } = await this.sb.client.storage.from('references').upload(path, file, { contentType: file.type, upsert: false });
    if (error) throw error;
    return path;
  }

  async add(ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file) return;
    this.uploading.set(true);
    try {
      const path = await this.uploadImage(file);
      await this.sb.rpc('admin_spaghetti_add_hint', { p_path: path, p_title: this.newTitle.trim() });
      this.newTitle = '';
      this.toast.success('Pista añadida');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    } finally {
      this.uploading.set(false);
      input.value = '';
    }
  }

  async replace(h: SpaghettiHint, ev: Event): Promise<void> {
    const input = ev.target as HTMLInputElement;
    const file = input.files?.[0];
    if (!file || !h.id) return;
    try {
      const path = await this.uploadImage(file);
      await this.sb.rpc('admin_spaghetti_update_hint', { p_id: h.id, p_title: h.title ?? '', p_path: path });
      if (h.image_path) await this.sb.client.storage.from('references').remove([h.image_path]);
      this.toast.success(`Imagen de la pista ${h.number} sustituida`);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    } finally {
      input.value = '';
    }
  }

  async rename(h: SpaghettiHint, title: string): Promise<void> {
    if (!h.id || title.trim() === (h.title ?? '')) return;
    try {
      await this.sb.rpc('admin_spaghetti_update_hint', { p_id: h.id, p_title: title.trim(), p_path: null });
      this.toast.success('Título guardado');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async remove(h: SpaghettiHint): Promise<void> {
    if (!h.id) return;
    if (!(await this.confirm.ask({ title: `¿Eliminar la pista ${h.number}?`, message: 'Las pistas siguientes se renumeran y se abrirán antes.', danger: true, confirmText: 'Eliminar' }))) return;
    try {
      const path = await this.sb.rpc<string>('admin_spaghetti_delete_hint', { p_id: h.id });
      if (path) await this.sb.client.storage.from('references').remove([path]);
      this.toast.success('Pista eliminada');
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async openNow(h: SpaghettiHint): Promise<void> {
    if (!h.id) return;
    if (!(await this.confirm.ask({ title: `Abrir la pista ${h.number} ya`, message: 'Todos los equipos podrán verla desde este momento.' }))) return;
    try {
      await this.sb.rpc('admin_spaghetti_open_hint', { p_id: h.id });
      this.toast.success(`Pista ${h.number} abierta`);
      await this.load();
    } catch (e) {
      this.toast.error(e);
    }
  }

  async drop(e: CdkDragDrop<unknown>): Promise<void> {
    if (e.previousIndex === e.currentIndex) return;
    const [from, to] = [Math.min(e.previousIndex, e.currentIndex), Math.max(e.previousIndex, e.currentIndex)];
    if (this.rows().slice(from, to + 1).some((r) => r.fixed)) {
      this.toast.info('Las pistas ya abiertas no se pueden mover durante la prueba.');
      return;
    }
    const next = [...this.hints()];
    moveItemInArray(next, e.previousIndex, e.currentIndex);
    this.hints.set(next); // respuesta inmediata; el servidor recalcula números y horarios
    try {
      await this.sb.rpc('admin_spaghetti_reorder_hints', { p_ids: next.map((h) => h.id) });
    } catch (err) {
      this.toast.error(err);
    }
    await this.load();
  }

  imageUrl(path: string): string {
    return this.sb.publicUrl('references', path);
  }
  fmt(ms: number): string {
    return formatMs(ms);
  }
  clock(seconds: number): string {
    return formatClock(seconds);
  }
}
