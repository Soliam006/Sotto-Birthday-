import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { AuthService } from './auth.service';
import { SupabaseService } from './supabase.service';

// Las guardas solo mejoran la navegación: la seguridad real está en RLS/RPC.

export const configuredGuard: CanActivateFn = () => {
  const sb = inject(SupabaseService);
  return sb.configured ? true : inject(Router).createUrlTree(['/setup']);
};

export const adminGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  return auth.isAdmin() ? true : router.createUrlTree(['/admin/login']);
};

export const playerGuard: CanActivateFn = async () => {
  const auth = inject(AuthService);
  const router = inject(Router);
  await auth.ready();
  if (auth.role() === 'player') return true;
  if (auth.role() === 'admin') return router.createUrlTree(['/admin']);
  return router.createUrlTree(['/']);
};
