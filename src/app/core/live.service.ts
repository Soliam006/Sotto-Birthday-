import { DestroyRef, Injectable, inject } from '@angular/core';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { SupabaseService } from './supabase.service';

export type LiveTopic =
  | 'teams' | 'players' | 'settings' | 'tv' | 'challenges'
  | 'spaghetti' | 'duels' | 'missions' | 'scores';

type Listener = { topics: Set<LiveTopic>; cb: (topics: LiveTopic[]) => void };

/**
 * Actualizaciones en directo.
 * Escucha la tabla public.live_signals (sin datos privados) mediante
 * Supabase Realtime. Cuando cambia un tema, avisa a los suscriptores para que
 * vuelvan a pedir los datos a las RPC (que aplican los permisos).
 * Incluye un sondeo de respaldo por si se pierde la conexión.
 */
@Injectable({ providedIn: 'root' })
export class LiveService {
  private readonly sb = inject(SupabaseService);
  private channel: RealtimeChannel | null = null;
  private readonly listeners = new Set<Listener>();
  private readonly pending = new Map<Listener, Set<LiveTopic>>();
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private pollTimer: ReturnType<typeof setInterval> | null = null;
  private lastVersions = new Map<string, number>();

  /** Suscribe un callback a uno o varios temas; se cancela con el DestroyRef. */
  watch(topics: LiveTopic[], cb: (topics: LiveTopic[]) => void, destroyRef?: DestroyRef): () => void {
    const l: Listener = { topics: new Set(topics), cb };
    this.listeners.add(l);
    this.connect();
    const off = () => {
      this.listeners.delete(l);
      this.pending.delete(l);
    };
    destroyRef?.onDestroy(off);
    return off;
  }

  private connect(): void {
    if (this.channel || !this.sb.configured) return;
    this.channel = this.sb.client
      .channel('live-signals')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'live_signals' }, (payload) => {
        const row = payload.new as { topic?: string; version?: number };
        if (row?.topic) {
          this.lastVersions.set(row.topic, row.version ?? 0);
          this.emit(row.topic as LiveTopic);
        }
      })
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') this.emitAll();
      });
    // Respaldo: comprobar versiones cada 20 s (por si Realtime se corta)
    this.pollTimer = setInterval(() => void this.poll(), 20000);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') void this.poll();
    });
  }

  private async poll(): Promise<void> {
    const { data } = await this.sb.client.from('live_signals').select('topic, version');
    for (const row of (data ?? []) as { topic: string; version: number }[]) {
      const prev = this.lastVersions.get(row.topic);
      this.lastVersions.set(row.topic, row.version);
      if (prev !== undefined && prev !== row.version) this.emit(row.topic as LiveTopic);
    }
  }

  private emitAll(): void {
    for (const l of this.listeners) for (const t of l.topics) this.queue(l, t);
  }

  private emit(topic: LiveTopic): void {
    for (const l of this.listeners) if (l.topics.has(topic)) this.queue(l, topic);
  }

  // Agrupa ráfagas de cambios en una sola recarga
  private queue(l: Listener, topic: LiveTopic): void {
    if (!this.pending.has(l)) this.pending.set(l, new Set());
    this.pending.get(l)!.add(topic);
    if (this.flushTimer) return;
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      const batch = new Map(this.pending);
      this.pending.clear();
      for (const [listener, topics] of batch) {
        if (!this.listeners.has(listener)) continue;
        listener.cb([...topics]);
      }
    }, 250);
  }
}
