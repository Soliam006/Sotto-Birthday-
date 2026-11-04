import { Injectable, signal } from '@angular/core';

export interface ConfirmRequest {
  title: string;
  message?: string;
  confirmText?: string;
  danger?: boolean;
  /** Si se indica, pide un texto (p. ej. motivo) y lo devuelve */
  prompt?: { label: string; placeholder?: string; required?: boolean };
  resolve: (value: string | false) => void;
}

/** Diálogo de confirmación modal para acciones importantes. */
@Injectable({ providedIn: 'root' })
export class ConfirmService {
  readonly current = signal<ConfirmRequest | null>(null);

  ask(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
    return new Promise((resolve) => this.current.set({ ...opts, resolve: (v) => resolve(v !== false) }));
  }

  prompt(opts: Omit<ConfirmRequest, 'resolve'> & { prompt: NonNullable<ConfirmRequest['prompt']> }): Promise<string | null> {
    return new Promise((resolve) => this.current.set({ ...opts, resolve: (v) => resolve(v === false ? null : v) }));
  }

  close(value: string | false): void {
    const c = this.current();
    this.current.set(null);
    c?.resolve(value);
  }
}
