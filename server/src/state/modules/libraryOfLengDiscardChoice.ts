// server/src/state/modules/libraryOfLengDiscardChoice.ts
// Optional "you may put the discarded card on top of your library instead
// of into your graveyard" prompt. The B95 helper applies a decided
// destination; this module only queues the choice and calls that helper.
// Public: maybeQueueLibraryOfLengDiscardChoices, applyLibraryOfLengDiscardChoiceOnContext,
// isLibraryOfLengEffectDiscardStep.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from './context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { ResolutionStepType } from '../resolution/types.js';
import {
  applyLibraryOfLengDiscardDestination,
  playerHasLibraryOfLengDiscardReplacement,
} from './batch95DiscardAndNotes.js';
import { applyDeferredGraveyardEntryTriggers } from './graveyardEntryUtils.js';
import { writePlayerLibraryToContext } from './zones-handlers/zonesDrawReplacementLibrarySync.js';

export function isLibraryOfLengEffectDiscardStep(step: any): boolean {
  if (!step) return false;
  if (step.reason === 'cleanup') return false;
  if (step.discardAbilityAsCost === true) return false;
  if (step.graveyardCastDiscardAsCost === true) return false;
  if (step.exileFromHandAbilityAsCost === true) return false;
  if (step.discardAndSacrificeAbilityAsCost === true) return false;
  if (step.wardPayment === true) return false;
  if (step.equipDiscardCost === true) return false;
  if (step.destination === 'exile') return false;
  return true;
}

function nextBatchId(ctx: GameContext): string {
  const n = Number((ctx as any)._libraryOfLengBatchSeq || 0) + 1;
  (ctx as any)._libraryOfLengBatchSeq = n;
  return `leng_${n}`;
}

export function maybeQueueLibraryOfLengDiscardChoices(
  ctx: GameContext,
  playerId: string,
  cards: any[],
): boolean {
  const gameId = String((ctx as any).gameId || '').trim();
  const pid = String(playerId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return false;
  if (!pid || !playerHasLibraryOfLengDiscardReplacement((ctx as any).state, pid)) return false;
  const list = (Array.isArray(cards) ? cards : []).filter((card) => card && String(card.id || '').trim());
  if (!list.length) return false;

  const already = new Set(
    ResolutionQueueManager.getQueue(gameId).steps
      .filter((step: any) => step?.libraryOfLengDiscardChoice === true)
      .map((step: any) => String(step?.cardId || '').trim()),
  );
  const pending = list.filter((card) => !already.has(String(card.id || '').trim()));
  if (!pending.length) return false;

  const batchId = nextBatchId(ctx);
  (ctx as any)._libraryOfLengPendingFlush = (ctx as any)._libraryOfLengPendingFlush || {};
  (ctx as any)._libraryOfLengPendingFlush[batchId] = pending.map((card) => ({
    card,
    ownerId: pid,
    sourceZone: 'hand',
  }));

  for (const card of pending) {
    const cardId = String(card.id || '').trim();
    const name = String(card.name || card.card?.name || 'that card');
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: pid as PlayerID,
      description: `You may put ${name} on top of your library instead of into your graveyard.`,
      mandatory: false,
      sourceId: cardId,
      sourceName: name,
      sourceImage: card.image_uris?.small || card.image_uris?.normal || card.card?.image_uris?.small,
      libraryOfLengDiscardChoice: true,
      libraryOfLengBatchId: batchId,
      cardId,
      options: [
        { id: 'library_top', label: `Put ${name} on top of your library` },
        { id: 'graveyard', label: `Leave ${name} in your graveyard` },
      ],
    } as any);
  }
  return true;
}

export function applyLibraryOfLengDiscardChoiceOnContext(
  ctx: GameContext,
  event: { playerId?: string; cardId?: string; putOnLibraryTop?: boolean; batchId?: string },
): { applied: boolean; putOnLibraryTop: boolean } {
  const playerId = String(event?.playerId || '').trim();
  const cardId = String(event?.cardId || '').trim();
  const batchId = String(event?.batchId || '').trim();
  const putOnLibraryTop = event?.putOnLibraryTop === true;
  if (!ctx || !playerId || !cardId) return { applied: false, putOnLibraryTop: false };

  const state: any = (ctx as any).state || {};
  const zones = state.zones?.[playerId] || {};
  const gy: any[] = Array.isArray(zones.graveyard) ? zones.graveyard : [];
  const card = gy.find((entry: any) => String(entry?.id || '').trim() === cardId)
    || ((ctx as any)._libraryOfLengPendingFlush?.[batchId] || []).find((entry: any) => String(entry?.card?.id || '').trim() === cardId)?.card;
  if (!card) return { applied: false, putOnLibraryTop: false };

  if (putOnLibraryTop) {
    applyLibraryOfLengDiscardDestination(state, playerId, card, true);
    const lib = Array.isArray(state.zones?.[playerId]?.library) ? state.zones[playerId].library : [];
    writePlayerLibraryToContext(ctx, playerId, lib);
  }

  if (batchId && (ctx as any)._libraryOfLengPendingFlush?.[batchId]) {
    const remaining = ((ctx as any)._libraryOfLengPendingFlush[batchId] as any[])
      .filter((entry) => String(entry?.card?.id || '').trim() !== cardId);
    (ctx as any)._libraryOfLengPendingFlush[batchId] = remaining;
    const gameId = String((ctx as any).gameId || '').trim();
    const more = gameId
      && ResolutionQueueManager.getQueue(gameId).steps.some((step: any) =>
        step?.libraryOfLengDiscardChoice === true && String(step?.libraryOfLengBatchId || '') === batchId,
      );
    if (!more) {
      const flush = remaining
        .map((entry) => {
          const stillInGy = gy.some((c: any) => String(c?.id || '').trim() === String(entry?.card?.id || '').trim());
          return stillInGy ? { card: entry.card, ownerId: playerId, sourceZone: 'hand' } : null;
        })
        .filter(Boolean) as Array<{ card: any; ownerId: string; sourceZone: string }>;
      // Also include the declined card still in the graveyard.
      if (!putOnLibraryTop && gy.some((c: any) => String(c?.id || '').trim() === cardId)) {
        flush.push({ card, ownerId: playerId, sourceZone: 'hand' });
      }
      if (flush.length) applyDeferredGraveyardEntryTriggers(ctx, flush);
      delete (ctx as any)._libraryOfLengPendingFlush[batchId];
    }
  }

  return { applied: true, putOnLibraryTop };
}
