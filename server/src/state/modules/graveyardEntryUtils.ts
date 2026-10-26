import type { GameContext } from '../context.js';
import type { ReplacementZone } from './replacement-effects.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import {
  checkGraveyardTrigger,
  tryApplyDeclarativeGraveyardDestinationReplacement,
} from './zone-manipulation.js';

export interface PushCardToGraveyardOptions {
  readonly fromBattlefield?: boolean;
  readonly controllerId?: string;
  readonly sourceZone?: ReplacementZone;
  readonly extraFields?: Record<string, unknown>;
  /** Stamp Mayhem / Jump-start discard provenance onto the graveyard card. */
  readonly asDiscard?: boolean;
  /**
   * Put the card in the graveyard without firing from-anywhere triggers yet.
   * Batch discards must move every selected card first, then flush triggers,
   * so Kozilek sees the other discarded cards.
   */
  readonly deferGraveyardTriggers?: boolean;
}

function inferGraveyardSourceZone(card: any, options: PushCardToGraveyardOptions): ReplacementZone {
  if (options.sourceZone) return options.sourceZone;
  if (options.fromBattlefield) return 'battlefield';
  const stamped = String((card as any)?.putIntoGraveyardFrom || '').toLowerCase();
  if (stamped === 'library') return 'library';
  const zone = String(card?.zone || card?.card?.zone || '').toLowerCase();
  if (
    zone === 'library'
    || zone === 'stack'
    || zone === 'hand'
    || zone === 'exile'
    || zone === 'battlefield'
    || zone === 'command'
  ) {
    return zone;
  }
  return 'hand';
}

/** Fields required for Mayhem and similar "discarded this turn" eligibility. */
export function buildDiscardProvenanceFields(
  state: any,
  playerId: string,
): { discardedByPlayerId: string; discardedOnTurn: number } {
  return {
    discardedByPlayerId: String(playerId || '').trim(),
    discardedOnTurn: Number(state?.turnNumber ?? state?.turn ?? 0) || 0,
  };
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

  const sourceZone = inferGraveyardSourceZone(card, options);

  if (tryApplyDeclarativeGraveyardDestinationReplacement(ctx, card, ownerId, {
    sourceZone,
    controller: options.controllerId || ownerId,
    objectId: String(card?.id || ''),
    cause: options.fromBattlefield ? 'destroy' : undefined,
  }).handled) {
    return false;
  }

  const discardFields = options.asDiscard
    ? buildDiscardProvenanceFields((ctx as any).state, ownerId)
    : {};

  const turnNumber = Number((ctx as any)?.state?.turnNumber ?? (ctx as any)?.state?.turn ?? 0) || 0;
  graveyard.push({
    ...card,
    zone: 'graveyard',
    putIntoGraveyardFrom: sourceZone,
    putIntoGraveyardTurn: turnNumber,
    ...(sourceZone === 'library' ? { milledTurn: turnNumber } : {}),
    ...discardFields,
    ...(options.extraFields || {}),
  });
  recordCardPutIntoGraveyardThisTurn(ctx, ownerId, card, {
    fromBattlefield: options.fromBattlefield === true,
    originZone: sourceZone,
    ...(options.controllerId ? { controllerId: options.controllerId } : {}),
  });
  if (!options.deferGraveyardTriggers) {
    const entered = graveyard[graveyard.length - 1] || card;
    checkGraveyardTrigger(ctx, entered, ownerId, sourceZone);
  }
  return true;
}

/** Fire from-anywhere graveyard triggers after a simultaneous discard/mill batch. */
export function applyDeferredGraveyardEntryTriggers(
  ctx: GameContext,
  entries: ReadonlyArray<{ card: any; ownerId: string; sourceZone?: string }>,
): void {
  for (const entry of entries) {
    if (!entry?.card || !entry.ownerId) continue;
    checkGraveyardTrigger(ctx, entry.card, entry.ownerId, entry.sourceZone);
  }
}

/** Library → graveyard (mill, explore, put-rest). Stamps sourceZone so Gaea's Blessing can fire. */
export function pushCardToGraveyardFromLibrary(
  ctx: GameContext,
  playerId: string,
  card: any,
  graveyard: any[],
  options: Omit<PushCardToGraveyardOptions, 'sourceZone'> = {},
): boolean {
  return pushCardToPlayerGraveyardWithReplacements(ctx, playerId, card, graveyard, {
    ...options,
    sourceZone: 'library',
  });
}
