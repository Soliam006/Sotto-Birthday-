import { Injectable } from '@angular/core';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { environment } from '../../environments/environment';

/** Error con mensaje listo para mostrar al usuario (en español) y su código SQLSTATE/PostgREST. */
export class AppError extends Error {
  constructor(message: string, readonly code?: string) {
    super(message);
  }
}

/** Código de conflicto de versión (otro usuario guardó antes) */
export const CONFLICT_CODE = 'BC409';

const FRIENDLY: [RegExp, string][] = [
  [/permission denied|42501|row-level security/i, 'No tienes permiso para realizar esta acción.'],
  [/Failed to fetch|NetworkError|network/i, 'Sin conexión con el servidor. Comprueba tu red e inténtalo de nuevo.'],
  [/JWT expired|invalid JWT/i, 'Tu sesión ha caducado. Recarga la página.'],
  [/duplicate key value/i, 'Ese elemento ya existe.'],
  [/violates foreign key/i, 'No se puede completar: hay datos relacionados (puntos, duelos...).'],
  [/teams_color_uq/i, 'Ese color ya lo usa otro equipo.'],
];

export function toFriendlyMessage(err: unknown): string {
  const e = err as { message?: string; code?: string; details?: string } | null;
  const msg = e?.message ?? String(err ?? 'Error desconocido');
  // Errores de negocio lanzados por nuestras funciones (P0001, BCxxx) ya vienen en español
  if (e?.code === 'P0001' || e?.code?.startsWith('BC')) return msg;
  for (const [re, friendly] of FRIENDLY) {
    if (re.test(msg) || re.test(e?.code ?? '') || re.test(e?.details ?? '')) {
      if (e?.code === '42501' && /juez|pantalla/i.test(msg)) return msg;
      return friendly;
    }
  }
  return msg;
}

@Injectable({ providedIn: 'root' })
export class SupabaseService {
  readonly configured = !!environment.supabaseUrl && !!environment.supabaseAnonKey;

  readonly client: SupabaseClient = createClient(
    environment.supabaseUrl || 'http://localhost:54321',
    environment.supabaseAnonKey || 'missing-anon-key',
    {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'birthday-cup-auth' },
      realtime: { params: { eventsPerSecond: 10 } },
    },
  );

  /** Llama a una función RPC y lanza AppError con mensaje legible si falla. */
  async rpc<T = unknown>(fn: string, args?: Record<string, unknown>): Promise<T> {
    const { data, error } = await this.client.rpc(fn, args ?? {});
    if (error) throw new AppError(toFriendlyMessage(error), error.code);
    return data as T;
  }

  /** Ejecuta una consulta de PostgREST y lanza AppError si falla. */
  async q<T>(query: PromiseLike<{ data: T | null; error: unknown }>): Promise<T> {
    const { data, error } = await query;
    if (error) throw new AppError(toFriendlyMessage(error));
    return data as T;
  }

  publicUrl(bucket: string, path: string): string {
    return this.client.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }
}
