/**
 * Mox Diamond ETB replacement: discard a land or the artifact goes to the graveyard.
 */

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from '../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../resolution/index.js';
import { debug } from '../../utils/debug.js';

export function isMoxDiamondCard(card: any): boolean {
  const name = String(card?.name || '').toLowerCase().trim();
  if (name === 'mox diamond') return true;
  const oracle = String(card?.oracle_text || '').toLowerCase();
  return (
    /\bdiscard a land card instead\b/.test(oracle) &&
    (/\bmox diamond\b/.test(oracle) || /this artifact would enter/.test(oracle))
  );
}

export function isLandCardForMoxDiscard(card: any): boolean {
  if (!card) return false;
  const typeLine = String(card.type_line || '').toLowerCase();
  return /\bland\b/.test(typeLine);
}

export function buildMoxDiamondLandOptions(hand: any[]): Array<{ id: string; label: string; imageUrl?: string }> {
  return (Array.isArray(hand) ? hand : [])
    .filter((c: any) => isLandCardForMoxDiscard(c))
    .map((c: any) => ({
      id: String(c.id),
      label: `Discard ${c.name || 'Land'}`,
      imageUrl: c.image_uris?.small || c.image_uris?.normal,
    }));
}

/**
 * Queue the Mox Diamond replacement choice while the spell remains on the stack.
 * Returns true when the ETB should be deferred (caller must not resolve the spell yet).
 */
export function queueMoxDiamondChoiceForStackItem(ctx: GameContext, stackItem: any): boolean {
  const card = stackItem?.card;
  const controller = stackItem?.controller as PlayerID | undefined;
  const stackItemId = String(stackItem?.id || '').trim();

  if (!card || !controller || !stackItemId || !isMoxDiamondCard(card)) {
    return false;
  }

  const gameId = String(ctx.gameId || '').trim();
  if (!gameId) return false;

  const existing = ResolutionQueueManager.getStepsForPlayer(gameId, controller).find(
    (s: any) => (s as any)?.moxDiamondChoice === true && String((s as any)?.stackItemId || '') === stackItemId,
  );
  if (existing) {
    return true;
  }

  const zones = (ctx.state as any)?.zones?.[controller];
  const hand = Array.isArray(zones?.hand) ? zones.hand : [];
  const landCardsInHand = buildMoxDiamondLandOptions(hand);

  ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: controller,
    description:
      'Mox Diamond — Discard a land to put it onto the battlefield, or decline to put it into the graveyard',
    mandatory: true,
    sourceId: stackItemId,
    sourceName: String(card.name || 'Mox Diamond'),
    options: [
      ...landCardsInHand,
      { id: 'decline_mox_diamond', label: "Don't discard (put Mox Diamond into graveyard)" },
    ],
    minSelections: 1,
    maxSelections: 1,
    moxDiamondChoice: true,
    stackItemId,
  } as any);

  debug(2, `[moxDiamond] Queued land discard choice for ${controller} (${landCardsInHand.length} land option(s))`);
  return true;
}

/** Peek at the top stack item and queue Mox Diamond choice if applicable. */
export function tryQueueMoxDiamondBeforeStackResolve(game: any): boolean {
  const stack = game?.state?.stack;
  if (!Array.isArray(stack) || stack.length === 0) return false;

  const topItem = stack[stack.length - 1];
  if (!topItem?.card || !topItem?.controller) return false;

  const ctx: GameContext = {
    gameId: String(game.id || (game.state as any)?.id || ''),
    state: game.state,
    bumpSeq: () => {
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
    },
  } as GameContext;

  return queueMoxDiamondChoiceForStackItem(ctx, topItem);
}
