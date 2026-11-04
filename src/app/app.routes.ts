import { Routes } from '@angular/router';
import { adminGuard, configuredGuard, playerGuard } from './core/guards';

export const routes: Routes = [
  // Acceso de participantes (QR)
  { path: '', canActivate: [configuredGuard], loadComponent: () => import('./features/join/join-page').then((m) => m.JoinPage), title: 'BIRTHDAY CUP' },
  { path: 'setup', loadComponent: () => import('./features/join/setup-page').then((m) => m.SetupPage), title: 'Configuración pendiente' },

  // Vista de jugador
  {
    path: 'player',
    canActivate: [configuredGuard, playerGuard],
    loadComponent: () => import('./features/player/player-layout').then((m) => m.PlayerLayout),
    children: [
      { path: '', loadComponent: () => import('./features/player/player-home').then((m) => m.PlayerHome), title: 'Inicio · BIRTHDAY CUP' },
      { path: 'modalities', loadComponent: () => import('./features/player/player-modalities').then((m) => m.PlayerModalitiesPage), title: 'Modalidades · BIRTHDAY CUP' },
      { path: 'missions', loadComponent: () => import('./features/player/player-missions').then((m) => m.PlayerMissions), title: 'Mis misiones · BIRTHDAY CUP' },
      { path: 'team', loadComponent: () => import('./features/player/player-team').then((m) => m.PlayerTeam), title: 'Mi equipo · BIRTHDAY CUP' },
    ],
  },

  // Panel del juez
  { path: 'admin/login', canActivate: [configuredGuard], loadComponent: () => import('./features/admin/admin-login').then((m) => m.AdminLogin), title: 'Acceso juez' },
  {
    path: 'admin',
    canActivate: [configuredGuard, adminGuard],
    loadComponent: () => import('./features/admin/admin-layout').then((m) => m.AdminLayout),
    children: [
      { path: '', loadComponent: () => import('./features/admin/dashboard').then((m) => m.Dashboard), title: 'Panel del juez' },
      { path: 'players', loadComponent: () => import('./features/admin/players').then((m) => m.AdminPlayers), title: 'Participantes' },
      { path: 'teams', loadComponent: () => import('./features/admin/teams').then((m) => m.AdminTeams), title: 'Equipos' },
      { path: 'modalities', loadComponent: () => import('./features/admin/modalities').then((m) => m.AdminModalities), title: 'Modalidades' },
      { path: 'modalities/crash', loadComponent: () => import('./features/admin/crash').then((m) => m.AdminCrash), title: 'Crash Team Racing' },
      { path: 'modalities/overcooked', loadComponent: () => import('./features/admin/overcooked').then((m) => m.AdminOvercooked), title: 'Overcooked' },
      { path: 'modalities/spaghetti', loadComponent: () => import('./features/admin/spaghetti').then((m) => m.AdminSpaghetti), title: 'Spaghetti & Marshmallow' },
      { path: 'duels', loadComponent: () => import('./features/admin/duels').then((m) => m.AdminDuels), title: 'Duelos' },
      { path: 'missions', loadComponent: () => import('./features/admin/missions').then((m) => m.AdminMissions), title: 'Misiones' },
      { path: 'scores', loadComponent: () => import('./features/admin/scores').then((m) => m.AdminScores), title: 'Puntuaciones' },
      { path: 'tv', loadComponent: () => import('./features/admin/tv-control').then((m) => m.AdminTv), title: 'Pantalla TV' },
      { path: 'settings', loadComponent: () => import('./features/admin/settings').then((m) => m.AdminSettings), title: 'Configuración' },
    ],
  },

  // Pantalla pública de televisión
  { path: 'tv', canActivate: [configuredGuard], loadComponent: () => import('./features/tv/tv-page').then((m) => m.TvPage), title: 'BIRTHDAY CUP · TV' },

  { path: '**', redirectTo: '' },
];
