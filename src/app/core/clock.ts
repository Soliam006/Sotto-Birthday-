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

/**
 * ms de prueba transcurridos de un cronómetro del servidor
 * (null = sin iniciar o cancelado). Las pausas no cuentan.
 */
export function elapsedMs(t: {
  timer_status?: string; status?: string; ends_at: string | null; paused_remaining_ms: number | null; duration_seconds: number;
}): number | null {
  const st = t.timer_status ?? t.status;
  if (st === 'finished') return t.duration_seconds * 1000;
  if (st !== 'running' && st !== 'paused') return null;
  return Math.max(0, t.duration_seconds * 1000 - remainingMs(t));
}

/** Formato corto de minuto de prueba: 240 → «4:00» */
export function formatClock(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
}
