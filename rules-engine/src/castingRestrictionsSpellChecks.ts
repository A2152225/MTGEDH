import type { BattlefieldPermanent, GameState } from '../../shared/src';
import { isCurrentlyCreature } from './actions/combat';
import { applyStaticAbilitiesToBattlefield } from './staticAbilities';
import type { SpellTimingRestriction } from './castingRestrictionsTypes';

/**
 * Check timing restrictions from a card's oracle text
 */
export function checkSpellTimingRestriction(
  oracleText: string,
  currentPlayerId: string,
  activePlayerId: string,
  gameState?: GameState
): SpellTimingRestriction {
  const text = (oracleText || '').toLowerCase();

  if (text.includes('cast this spell only during an opponent\'s turn') ||
      text.includes('cast only during an opponent\'s turn')) {
    const isOpponentsTurn = currentPlayerId !== activePlayerId;
    if (!isOpponentsTurn) {
      return {
        canCast: false,
        reason: 'This spell can only be cast during an opponent\'s turn',
        requiresOpponentsTurn: true,
      };
    }
    return { canCast: true, requiresOpponentsTurn: true };
  }

  if (text.includes('cast this spell only during your turn') ||
      text.includes('cast only during your turn')) {
    const isOwnTurn = currentPlayerId === activePlayerId;
    if (!isOwnTurn) {
      return {
        canCast: false,
        reason: 'This spell can only be cast during your turn',
        requiresOwnTurn: true,
      };
    }
    return { canCast: true, requiresOwnTurn: true };
  }

  if (text.includes('cast this spell only before attackers are declared') ||
      text.includes('cast only before attackers')) {
    const phase = (gameState?.phase || '').toString().toLowerCase();
    const step = (gameState?.step || '').toString().toLowerCase();
    const isCombat = phase.includes('combat') || step.includes('attack') || step.includes('block');

    if (isCombat) {
      return {
        canCast: false,
        reason: 'This spell can only be cast before attackers are declared',
      };
    }
    return { canCast: true };
  }

  return { canCast: true };
}

/**
 * Check if a spell requires specific targets and if those targets exist
 */
export function hasValidTargetsForSpell(
  oracleText: string,
  gameState: GameState,
  currentPlayerId: string
): { hasTargets: boolean; reason?: string } {
  const text = (oracleText || '').toLowerCase();
  const battlefield = getProcessedBattlefield(gameState);

  if (text.includes('cast this spell only during an opponent\'s turn') &&
      text.includes('target creature that player controls')) {
    const activePlayerId = gameState.turnPlayer || gameState.players[gameState.activePlayerIndex || 0]?.id;
    const opponentCreatures = battlefield.filter(perm => isCurrentlyCreature(perm) && perm.controller === activePlayerId);

    if (opponentCreatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'The opponent whose turn it is controls no creatures',
      };
    }

    return { hasTargets: true };
  }

  if (text.includes('target creature')) {
    const creatures = battlefield.filter(perm => isCurrentlyCreature(perm));
    if (creatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'No creatures on the battlefield',
      };
    }
  }

  if (text.includes('attacking creature') || text.includes('sacrifices an attacking creature')) {
    const phase = (gameState.phase || '').toString().toLowerCase();
    const step = (gameState.step || '').toString().toLowerCase();
    const isCombat = phase.includes('combat') || step.includes('attack') || step.includes('block') || step.includes('damage');

    if (!isCombat) {
      return {
        hasTargets: false,
        reason: 'Can only be cast during combat (requires attacking creatures)',
      };
    }

    const attackingCreatures = battlefield.filter(perm => {
      const isCreature = isCurrentlyCreature(perm);
      const isAttacking = (perm as any).attacking === true;
      return isCreature && isAttacking;
    });

    if (attackingCreatures.length === 0) {
      return {
        hasTargets: false,
        reason: 'No attacking creatures on the battlefield',
      };
    }
  }

  if (text.includes('target opponent')) {
    const opponents = gameState.players.filter(p => p.id !== currentPlayerId);
    if (opponents.length === 0) {
      return {
        hasTargets: false,
        reason: 'No opponents',
      };
    }
  }

  return { hasTargets: true };
}

function getProcessedBattlefield(gameState: GameState): BattlefieldPermanent[] {
  return applyStaticAbilitiesToBattlefield(
    (gameState.battlefield || []) as BattlefieldPermanent[]
  ) as BattlefieldPermanent[];
}
