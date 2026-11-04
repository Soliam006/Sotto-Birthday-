import { signal } from '@angular/core';

/** Desfase entre el reloj del servidor y el del dispositivo (ms). */
export const serverOffset = signal(0);

export function syncServerClock(serverNowIso: string | null | undefined, requestStartedAt?: number): void {
  if (!serverNowIso) return;
  const now = Date.now();
  const latency = requestStartedAt ? (now - requestStartedAt) / 2 : 0;
  serverOffset.set(new Date(serverNowIso).getTime() + latency - now);
}

export function serverNow(): number {
  return Date.now() + serverOffset();
}

/** ms restantes de un cronómetro definido por el servidor */
export function remainingMs(t: { timer_status?: string; status?: string; ends_at: string | null; paused_remaining_ms: number | null }): number {
  const st = t.timer_status ?? t.status;
  if (st === 'paused') return Math.max(0, t.paused_remaining_ms ?? 0);
  if (st === 'running' && t.ends_at) return Math.max(0, new Date(t.ends_at).getTime() - serverNow());
  return 0;
}

export function formatMs(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}
