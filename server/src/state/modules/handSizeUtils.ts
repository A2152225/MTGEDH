import { debugWarn } from '../../utils/debug.js';

/**
 * True when this card's oracle grants no maximum hand size (Reliquary Tower,
 * Thought Vessel, Spellbook, Folio of Fancies, …).
 */
export function cardGrantsNoMaximumHandSize(card: any): boolean {
  const oracle = String(card?.oracle_text || card?.oracleText || card?.text || '').toLowerCase();
  return oracle.includes('no maximum hand size');
}

/**
 * Maximum hand size for cleanup discard (Rule 514.1).
 * Returns Infinity when the player has no maximum hand size.
 */
export function getMaxHandSizeForPlayer(gameState: any, playerId: string): number {
  try {
    if (!gameState) return 7;

    const playerMaxHandSize = gameState.maxHandSize?.[playerId];
    if (playerMaxHandSize === Infinity || playerMaxHandSize === Number.POSITIVE_INFINITY) {
      return Infinity;
    }
    if (typeof playerMaxHandSize === 'number' && playerMaxHandSize > 0) {
      return playerMaxHandSize;
    }

    const noMaxHandSize = gameState.noMaximumHandSize?.[playerId];
    if (noMaxHandSize === true) {
      return Infinity;
    }

    const playerEffects = gameState.playerEffects?.[playerId] || [];
    for (const effect of playerEffects) {
      if (effect && (effect.type === 'no_maximum_hand_size' || effect.effect === 'no_maximum_hand_size')) {
        return Infinity;
      }
    }

    const battlefield = Array.isArray(gameState.battlefield) ? gameState.battlefield : [];
    for (const perm of battlefield) {
      if (perm && perm.controller === playerId) {
        const oracle = String(perm.card?.oracle_text || '').toLowerCase();
        if (oracle.includes('you have no maximum hand size') || oracle.includes('no maximum hand size')) {
          return Infinity;
        }
      }
    }

    const emblems = Array.isArray(gameState.emblems) ? gameState.emblems : [];
    for (const emblem of emblems) {
      if (emblem && emblem.controller === playerId) {
        const effectText = String(emblem.effect || emblem.text || '').toLowerCase();
        if (effectText.includes('no maximum hand size')) {
          return Infinity;
        }
      }
    }

    return 7;
  } catch (err) {
    debugWarn(1, `[getMaxHandSizeForPlayer] failed:`, err);
    return 7;
  }
}
