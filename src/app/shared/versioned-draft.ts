import { Signal, computed, effect, signal, untracked } from '@angular/core';
import { AppError, CONFLICT_CODE } from '../core/supabase.service';
import { ToastService } from '../core/toast.service';

/** Estado guardado en el servidor: ids seleccionados y versión (0 = nunca guardado) */
export interface ServerSelection {
  ids: string[];
  version: number;
}

/**
 * Borrador local de una selección de jugadores con concurrencia optimista.
 * Lo usan las selecciones por equipo que editan los jugadores (orden de
 * pilotos de Crash, cocineros de Overcooked):
 *  - Se edita en local, sin llamadas al servidor, hasta pulsar «Guardar».
 *  - Si no hay cambios locales, adopta automáticamente lo que llegue del servidor.
 *  - Si un compañero guarda mientras hay cambios locales, `remoteChanged` lo indica.
 *  - Al guardar se envía la versión sobre la que se editó; si el servidor
 *    responde con conflicto (BC409) se descartan los cambios locales y se
 *    adopta la versión del compañero.
 * Debe crearse en un contexto de inyección (usa `effect`).
 */
export class VersionedDraft {
  readonly draft = signal<string[]>([]);
  readonly dirty = signal(false);
  readonly busy = signal(false);
  private readonly baseVersion = signal(0);

  /** Un compañero guardó otra versión mientras había cambios sin guardar */
  readonly remoteChanged: Signal<boolean> = computed(() => this.dirty() && this.server().version !== this.baseVersion());

  /**
   * @param server  selección actual del servidor (señal/computed)
   * @param ordered true si el orden importa (Crash); false para conjuntos (Overcooked)
   */
  constructor(
    private readonly server: () => ServerSelection,
    private readonly ordered: boolean,
  ) {
    effect(() => {
      const s = this.server();
      untracked(() => {
        if (!this.dirty()) {
          this.draft.set(s.ids);
          this.baseVersion.set(s.version);
        }
      });
    });
  }

  private key(ids: string[]): string {
    return (this.ordered ? ids : [...ids].sort()).join(',');
  }

  set(next: string[]): void {
    this.draft.set(next);
    this.dirty.set(this.key(next) !== this.key(this.server().ids) || this.server().version !== this.baseVersion());
  }

  discard(): void {
    this.dirty.set(false);
    this.draft.set(this.server().ids);
    this.baseVersion.set(this.server().version);
  }

  /**
   * Envía el borrador. `send` llama a la RPC con (ids, versión esperada) y
   * devuelve la nueva versión. `reload` debe volver a pedir los datos.
   */
  async save(
    send: (ids: string[], expectedVersion: number) => Promise<number>,
    opts: { toast: ToastService; successMessage: string; reload: () => void },
  ): Promise<void> {
    this.busy.set(true);
    try {
      const version = await send(this.draft(), this.baseVersion());
      this.baseVersion.set(version);
      this.dirty.set(false);
      opts.toast.success(opts.successMessage);
      opts.reload();
    } catch (e) {
      if (e instanceof AppError && e.code === CONFLICT_CODE) {
        opts.toast.info(e.message);
        this.dirty.set(false); // al recargar se adopta la versión del compañero
        opts.reload();
      } else {
        opts.toast.error(e);
      }
    } finally {
      this.busy.set(false);
    }
  }
}
