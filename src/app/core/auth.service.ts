import { Injectable, computed, inject, signal } from '@angular/core';
import type { Session } from '@supabase/supabase-js';
import { AppError, SupabaseService, toFriendlyMessage } from './supabase.service';

export type Role = 'admin' | 'player' | 'guest';

/**
 * Gestiona la identidad:
 *  - Juez: login con email/contraseña (Supabase Auth) + presencia en public.admins.
 *  - Jugador: sesión anónima de Supabase Auth vinculada en servidor a un jugador.
 * El rol se obtiene SIEMPRE del servidor; el cliente solo lo usa para la UI.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly sb = inject(SupabaseService);

  readonly session = signal<Session | null>(null);
  readonly role = signal<Role>('guest');
  readonly playerId = signal<string | null>(null);
  readonly isAdmin = computed(() => this.role() === 'admin');

  private readyPromise: Promise<void> | null = null;

  /** Resuelve cuando se conoce el rol actual. */
  ready(): Promise<void> {
    if (!this.readyPromise) this.readyPromise = this.init();
    return this.readyPromise;
  }

  private async init(): Promise<void> {
    if (!this.sb.configured) return;
    const { data } = await this.sb.client.auth.getSession();
    this.session.set(data.session);
    this.sb.client.auth.onAuthStateChange((_event, session) => {
      const changedUser = session?.user.id !== this.session()?.user.id;
      this.session.set(session);
      if (changedUser) void this.resolveRole();
    });
    await this.resolveRole();
  }

  async resolveRole(): Promise<Role> {
    const s = this.session();
    if (!s) {
      this.role.set('guest');
      this.playerId.set(null);
      return 'guest';
    }
    try {
      const { data: admin } = await this.sb.client.from('admins').select('user_id').eq('user_id', s.user.id).maybeSingle();
      if (admin) {
        this.role.set('admin');
        this.playerId.set(null);
        return 'admin';
      }
      const { data: sess } = await this.sb.client
        .from('player_sessions')
        .select('player_id')
        .eq('user_id', s.user.id)
        .is('revoked_at', null)
        .maybeSingle();
      if (sess?.player_id) {
        this.role.set('player');
        this.playerId.set(sess.player_id as string);
        void this.sb.client.rpc('touch_session');
        return 'player';
      }
    } catch {
      /* sin conexión: se mantiene guest */
    }
    this.role.set('guest');
    this.playerId.set(null);
    return 'guest';
  }

  // ---------------------------------------------------------------- Juez
  async signInAdmin(email: string, password: string): Promise<void> {
    if (this.session()?.user.is_anonymous) await this.sb.client.auth.signOut();
    const { data, error } = await this.sb.client.auth.signInWithPassword({ email, password });
    if (error) {
      throw new AppError(/invalid login/i.test(error.message) ? 'Email o contraseña incorrectos.' : toFriendlyMessage(error));
    }
    this.session.set(data.session);
    const role = await this.resolveRole();
    if (role !== 'admin') {
      await this.signOut();
      throw new AppError('Esta cuenta no tiene permisos de juez.');
    }
  }

  async signOut(): Promise<void> {
    await this.sb.client.auth.signOut();
    this.session.set(null);
    this.role.set('guest');
    this.playerId.set(null);
  }

  // ---------------------------------------------------------------- Jugador
  private async ensureAnonymousSession(): Promise<void> {
    if (this.session()) return;
    const { data, error } = await this.sb.client.auth.signInAnonymously();
    if (error) {
      throw new AppError(
        /anonymous/i.test(error.message)
          ? 'El acceso de invitados no está habilitado en Supabase (Anonymous Sign-Ins).'
          : toFriendlyMessage(error),
      );
    }
    this.session.set(data.session);
  }

  async joinWithInvite(inviteCode: string, name: string): Promise<void> {
    await this.ensureAnonymousSession();
    await this.sb.rpc('join_competition', {
      p_invite_code: inviteCode,
      p_name: name,
      p_user_agent: navigator.userAgent,
    });
    await this.resolveRole();
  }

  async joinWithPersonalCode(code: string): Promise<void> {
    await this.ensureAnonymousSession();
    await this.sb.rpc('claim_player', { p_code: code, p_user_agent: navigator.userAgent });
    await this.resolveRole();
  }
}
