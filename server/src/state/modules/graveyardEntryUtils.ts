import type { GameContext } from '../context.js';
import type { ReplacementZone } from './replacement-effects.js';
import { checkGraveyardTrigger } from './triggered-abilities.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import { tryApplyDeclarativeGraveyardDestinationReplacement } from './zone-manipulation.js';

export interface PushCardToGraveyardOptions {
  readonly fromBattlefield?: boolean;
  readonly controllerId?: string;
  readonly sourceZone?: ReplacementZone;
  readonly extraFields?: Record<string, unknown>;
}

/**
 * Puts a card into a player's graveyard unless a declarative replacement applies.
 * Returns false when the card was redirected (exile, library shuffle, etc.) instead.
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

  const sourceZone: ReplacementZone = options.sourceZone
    || (options.fromBattlefield ? 'battlefield' : 'hand');

  if (tryApplyDeclarativeGraveyardDestinationReplacement(ctx, card, ownerId, {
    sourceZone,
    controller: options.controllerId || ownerId,
    objectId: String(card?.id || ''),
    cause: options.fromBattlefield ? 'destroy' : undefined,
  }).handled) {
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
