// Modelos de dominio compartidos (reflejan las tablas y las respuestas RPC)

export type ChallengeKind = 'crash' | 'overcooked' | 'duels' | 'missions' | 'spaghetti';
export type ChallengeStatus = 'pending' | 'preparing' | 'in_progress' | 'finished';
export type CompetitionStatus = 'setup' | 'running' | 'finished';
export type TvMode = 'leaderboard' | 'leaderboard_no_scores' | 'waiting' | 'final_results' | 'champion';
export type MissionStatus = 'assigned' | 'claimed' | 'validated' | 'rejected' | 'discovered';
export type DuelStatus = 'in_progress' | 'finished' | 'cancelled' | 'voided';
export type DuelFormat = '1v1' | 'multi';
export type TimerStatus = 'idle' | 'running' | 'paused' | 'finished' | 'cancelled';

export interface Team {
  id: string;
  name: string;
  color: string;
  sort_order: number;
}

export interface Player {
  id: string;
  name: string;
  team_id: string | null;
  created_at: string;
}

export interface PlayerSession {
  id: string;
  player_id: string;
  method: 'invite' | 'personal_code';
  user_agent: string | null;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
}

export interface Challenge {
  id: string;
  kind: ChallengeKind;
  name: string;
  tagline: string;
  description: string;
  rules: string;
  status: ChallengeStatus;
  config: Record<string, unknown>;
  sort_order: number;
  started_at: string | null;
  finished_at: string | null;
  results_confirmed_at: string | null;
}

export interface StandingRow {
  team_id: string;
  name: string;
  color: string;
  points: number | null;
  rank: number | null;
  players_count?: number;
}

export interface CompetitionSettings {
  id: number;
  name: string;
  subtitle: string;
  status: CompetitionStatus;
  invite_code: string;
  registration_open: boolean;
  scores_visible: boolean;
  missions_revealed: boolean;
  winner_revealed_at: string | null;
  finished_at: string | null;
}

export interface TvSettings {
  id: number;
  mode: TvMode;
  message: string;
  show_timer: boolean;
  access_key: string;
}

export interface Mission {
  id: string;
  player_id: string;
  description: string;
  reward: number;
  status: MissionStatus;
  claim_note: string | null;
  judge_note: string | null;
  assigned_at: string;
  claimed_at: string | null;
  validated_at: string | null;
}

export interface MissionDiscovery {
  id: string;
  accuser_player_id: string;
  accused_player_id: string;
  guess: string;
  status: 'pending' | 'correct' | 'incorrect';
  mission_id: string | null;
  judge_note: string | null;
  created_at: string;
  resolved_at: string | null;
}

export interface DuelGame {
  id: string;
  name: string;
  active: boolean;
  sort_order: number;
}

export interface Duel {
  id: string;
  game_id: string;
  format: DuelFormat;
  status: DuelStatus;
  notes: string;
  started_at: string;
  finished_at: string | null;
  void_reason: string | null;
  duel_players: { player_id: string; team_id: string; position: number | null; points: number | null }[];
}

export interface ScoreEvent {
  id: string;
  team_id: string;
  points: number;
  reason: string;
  challenge_id: string | null;
  player_id: string | null;
  source_type: string;
  corrects_event_id: string | null;
  created_at: string;
}

export interface CrashRace {
  id: string;
  race_number: number;
  is_training: boolean;
  track: string;
  status: 'pending' | 'in_progress' | 'finished';
}

export interface CrashLineup {
  team_id: string;
  slot: number;
  player_id: string;
}

export interface CrashResult {
  race_id: string;
  player_id: string;
  team_id: string;
  raw_position: number;
  human_position: number;
  points: number;
}

export interface SpaghettiState {
  reference_image_path: string | null;
  reference_visible: boolean;
  duration_seconds: number;
  timer_status: TimerStatus;
  started_at: string | null;
  ends_at: string | null;
  paused_remaining_ms: number | null;
}

/** Resultado calculado por el servidor (vista previa o confirmación) */
export interface AllocationRow {
  team_id: string;
  team_name: string;
  team_color: string;
  player_id?: string;
  player_name?: string;
  position?: number;
  human_position?: number;
  raw_position?: number;
  score?: number;
  points: number;
}

export interface MyState {
  linked: boolean;
  player?: { id: string; name: string };
  team?: { id: string; name: string; color: string; members: { id: string; name: string }[] } | null;
  competition?: { name: string; subtitle: string; status: CompetitionStatus; winner_revealed: boolean };
  scores_visible?: boolean;
  missions_revealed?: boolean;
  leaderboard?: StandingRow[] | null;
  last_update?: string | null;
}

export interface PlayerModalities {
  challenges: Challenge[];
  crash: {
    races: Pick<CrashRace, 'race_number' | 'track' | 'is_training' | 'status'>[];
    my_slots: number[];
    race_count: number;
    /** El jugador puede ordenar los pilotos de su equipo */
    can_edit_lineup: boolean;
    /** Alineación guardada del equipo del jugador */
    lineup: { slot: number; player_id: string }[];
    /** Versión para la concurrencia optimista (0 = nunca guardada) */
    lineup_version: number;
    lineup_updated_at: string | null;
    lineup_updated_by_id: string | null;
    /** Nombre de quien guardó por última vez, o «el juez» */
    lineup_updated_by: string | null;
  };
  overcooked: {
    /** Cocineros por equipo fijados por el juez (0 = sin fijar) */
    players_per_team: number;
    /** Cocineros exigidos a MI equipo (menos si el equipo tiene menos miembros) */
    required: number;
    can_edit_roster: boolean;
    /** Motivo por el que la selección está cerrada (null = editable) */
    lock_reason: string | null;
    /** Cocineros elegidos en mi equipo (sin orden) */
    roster: string[];
    i_play: boolean;
    roster_version: number;
    roster_updated_at: string | null;
    roster_updated_by_id: string | null;
    roster_updated_by: string | null;
  };
  duels: { games: string[]; my_count: number; limit: number };
  spaghetti: {
    timer_status: TimerStatus;
    duration_seconds: number;
    ends_at: string | null;
    paused_remaining_ms: number | null;
    reference_image_path: string | null;
    /** Pistas: imagen y título solo de las abiertas */
    hints: SpaghettiHint[];
  };
  server_now: string;
}

/** Pista de Spaghetti tal como la entrega el servidor */
export interface SpaghettiHint {
  /** Número de pista (1, 2, 3…) */
  number: number;
  /** Segundo de prueba en que se abre */
  open_at_seconds: number;
  is_open: boolean;
  opened_manually: boolean;
  /** Solo si está abierta (o para el juez) */
  title: string | null;
  image_path: string | null;
  /** Solo para el juez */
  id?: string;
}

export interface TvState {
  mode: TvMode;
  message: string;
  competition: { name: string; subtitle: string; status: CompetitionStatus };
  winner_revealed_at: string | null;
  teams: StandingRow[];
  last_update: string | null;
  timer: {
    status: TimerStatus;
    ends_at: string | null;
    paused_remaining_ms: number | null;
    duration_seconds: number;
    /** Calendario de pistas (sin imágenes) */
    hints: Pick<SpaghettiHint, 'number' | 'open_at_seconds' | 'is_open'>[];
  } | null;
  server_now: string;
}

export const STATUS_LABELS: Record<ChallengeStatus, string> = {
  pending: 'Pendiente',
  preparing: 'En preparación',
  in_progress: 'En curso',
  finished: 'Finalizada',
};

export const MISSION_STATUS_LABELS: Record<MissionStatus, string> = {
  assigned: 'Activa',
  claimed: 'Pendiente de validar',
  validated: 'Validada',
  rejected: 'Rechazada',
  discovered: 'Descubierta',
};

/** Nombre del icono Material Symbols de cada modalidad (<mat-icon>) */
export const CHALLENGE_ICONS: Record<ChallengeKind, string> = {
  crash: 'sports_motorsports',
  overcooked: 'skillet',
  duels: 'chess',
  missions: 'mystery',
  spaghetti: 'architecture',
};
