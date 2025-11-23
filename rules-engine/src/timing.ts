// rules-engine/src/timing.ts
// Pure timing and priority validation utilities

import type { GameState, PlayerID, KnownCardRef, GamePhase, GameStep } from '../../shared/src';

/**
 * Check if a player can cast a spell at the current game state.
 * 
 * Returns null if the spell can be cast, or a string reason if it cannot.
 * 
 * Rules enforced:
 * - Player must have priority
 * - Instants or cards with flash can be cast any time with priority
 * - Sorcery-speed spells must be cast:
 *   - By the active player
 *   - During a main phase
 *   - With an empty stack
 */
export function canCastSpell(
  state: Readonly<GameState>,
  playerId: PlayerID,
  card: Readonly<KnownCardRef>
): string | null {
  // Must have priority
  if (state.priority !== playerId) {
    return 'You do not have priority';
  }

  const typeLine = (card.type_line || '').toLowerCase();
  const oracleText = (card.oracle_text || '').toLowerCase();

  // Check if it's an instant or has flash
  const isInstant = typeLine.includes('instant');
  const hasFlash = oracleText.includes('flash');

  // Instants and cards with flash can be cast anytime you have priority
  if (isInstant || hasFlash) {
    return null;
  }

  // Sorcery-speed restrictions
  const isActivePlayer = state.turnPlayer === playerId;
  if (!isActivePlayer) {
    return 'You can only cast sorcery-speed spells during your own turn';
  }

  // Must be in a main phase
  const phase = state.phase as string;
  const step = state.step as string;
  
  const isMainPhase = 
    phase === 'precombatMain' || 
    phase === 'postcombatMain' ||
    phase === 'main1' ||
    phase === 'main2' ||
    step === 'MAIN1' ||
    step === 'MAIN2';

  if (!isMainPhase) {
    return 'You can only cast sorcery-speed spells during your main phase';
  }

  // Stack must be empty
  if (state.stack && state.stack.length > 0) {
    return 'You can only cast sorcery-speed spells when the stack is empty';
  }

  return null;
}

/**
 * Check if a permanent can be tapped for mana.
 * 
 * Returns null if tapping is legal, or a string reason if not.
 */
export function canTapForMana(
  state: Readonly<GameState>,
  playerId: PlayerID,
  permanentId: string
): string | null {
  const perm = state.battlefield?.find(p => p.id === permanentId);
  
  if (!perm) {
    return 'Permanent not found';
  }

  if (perm.controller !== playerId) {
    return 'You do not control this permanent';
  }

  if (perm.tapped) {
    return 'Permanent is already tapped';
  }

  return null;
}
