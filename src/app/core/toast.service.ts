import { Injectable, signal } from '@angular/core';
import { toFriendlyMessage } from './supabase.service';

export interface Toast {
  id: number;
  kind: 'success' | 'error' | 'info' | 'points';
  text: string;
}

@Injectable({ providedIn: 'root' })
export class ToastService {
  readonly toasts = signal<Toast[]>([]);
  private seq = 0;

  show(kind: Toast['kind'], text: string, ms = 3500): void {
    const id = ++this.seq;
    this.toasts.update((t) => [...t.slice(-3), { id, kind, text }]);
    setTimeout(() => this.dismiss(id), kind === 'error' ? ms + 2500 : ms);
  }
  success(text: string): void { this.show('success', text); }
  info(text: string): void { this.show('info', text); }
  points(text: string): void { this.show('points', text, 4500); }
  error(err: unknown): void { this.show('error', typeof err === 'string' ? err : toFriendlyMessage(err)); }
  dismiss(id: number): void { this.toasts.update((t) => t.filter((x) => x.id !== id)); }
}
