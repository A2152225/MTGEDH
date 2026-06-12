import type { GameContext } from '../context.js';
import { checkGraveyardTrigger } from './triggered-abilities.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import { tryApplyGraveyardSelfShuffleReplacementForCard } from './zone-manipulation.js';

export interface PushCardToGraveyardOptions {
  readonly fromBattlefield?: boolean;
  readonly controllerId?: string;
  readonly extraFields?: Record<string, unknown>;
}

/**
 * Puts a card into a player's graveyard unless a self-shuffle replacement applies.
 * Returns false when the card was shuffled into its owner's library instead.
 */
export function pushCardToPlayerGraveyardWithReplacements(
  ctx: GameContext,
  playerId: string,
  card: any,
  graveyard: any[],
  options: PushCardToGraveyardOptions = {},
): boolean {
  const ownerId = String(playerId || '').trim();
  if (!ownerId || !card) return false;

  if (tryApplyGraveyardSelfShuffleReplacementForCard(ctx, card, ownerId)) {
    return false;
  }

  graveyard.push({
    ...card,
    zone: 'graveyard',
    ...(options.extraFields || {}),
  });
  recordCardPutIntoGraveyardThisTurn(ctx, ownerId, card, {
    fromBattlefield: options.fromBattlefield === true,
    ...(options.controllerId ? { controllerId: options.controllerId } : {}),
  });
  checkGraveyardTrigger(ctx, card, ownerId);
  return true;
}
