/**
 * Card AI profile types for role-based scoring.
 *
 * Origin: AI_Upgrade Phase 1 (P1-4). Types live in rules-engine so utilityScorer
 * can import them without depending on server.
 *
 * Public entry symbols: CARD_ROLES, CardRole, CardAIProfileNeed, CardAIProfile.
 */

export const CARD_ROLES = [
  'ramp',
  'draw',
  'removal',
  'sweeper',
  'counterspell',
  'protection',
  'token_maker',
  'tutor',
  'recursion',
  'lifegain',
  'wincon',
] as const;

export type CardRole = (typeof CARD_ROLES)[number];

export type CardAIProfileNeed =
  | 'target_creature'
  | 'target_permanent'
  | 'target_player'
  | 'graveyard_card';

export interface CardAIProfile {
  oracleId: string;
  name: string;
  /** Sorted, unique; may be empty. */
  roles: CardRole[];
  timing: 'instant' | 'sorcery_speed';
  needs: CardAIProfileNeed[];
  source: 'ir' | 'analyzer' | 'override';
}
