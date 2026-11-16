// Batch 112 draw replacements: look at the top N, keep one, rest to the graveyard;
// Chains of Mephistopheles-style discard-or-mill; Shared Fate exile from an opponent.
// Public: autoApplyOrQueueLookOneRestGraveyard, applyChainsDrawReplacement,
// applySharedFateDrawReplacement.

import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { ResolutionStepType } from '../resolution/index.js';
import { queueResolveTopOfStackPrompt } from './resolutionPromptEvents.js';
import { syncPlayerLibraryFromContext, writePlayerLibraryToContext } from './zones-handlers/zonesDrawReplacementLibrarySync.js';

function libraryOf(ctx: GameContext, playerId: string): any[] {
  return syncPlayerLibraryFromContext(ctx, playerId);
}

export function applyLookOneRestGraveyard(ctx: GameContext, playerId: string, lookCount: number, chosenId?: string): void {
  const lib = libraryOf(ctx, playerId);
  const n = Math.min(Math.max(0, lookCount), lib.length);
  const revealed = lib.splice(0, n);
  if (revealed.length === 0) {
    writePlayerLibraryToContext(ctx, playerId, lib);
    return;
  }
  const chosen = revealed.find((card) => String(card?.id || '') === String(chosenId || '')) || revealed[0];
  const rest = revealed.filter((card) => card !== chosen);
  const state: any = (ctx as any).state;
  state.zones = state.zones || {};
  state.zones[playerId] = state.zones[playerId] || {};
  const hand = Array.isArray(state.zones[playerId].hand) ? state.zones[playerId].hand : [];
  hand.push(chosen);
  state.zones[playerId].hand = hand;
  state.zones[playerId].handCount = hand.length;
  const gy = Array.isArray(state.zones[playerId].graveyard) ? state.zones[playerId].graveyard : [];
  gy.push(...rest);
  state.zones[playerId].graveyard = gy;
  state.zones[playerId].graveyardCount = gy.length;
  writePlayerLibraryToContext(ctx, playerId, lib);
}

export function autoApplyOrQueueLookOneRestGraveyard(ctx: GameContext, playerId: string, metadata: any): 'break' | 'continue' {
  const lookCount = Math.max(1, Math.floor(Number(metadata?.lookAtLibraryTop || 3)));
  if ((ctx as any).isReplaying && String((ctx as any)._replayNextEventType || '') === 'librarySearchResolve') return 'break';
  const revealed = libraryOf(ctx, playerId).slice(0, lookCount);
  if (revealed.length <= 1 || (ctx as any).isReplaying) {
    applyLookOneRestGraveyard(ctx, playerId, lookCount);
    return 'continue';
  }
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') {
    applyLookOneRestGraveyard(ctx, playerId, lookCount);
    return 'continue';
  }
  const sourceName = String(metadata?.sourceName || 'Replacement');
  queueResolveTopOfStackPrompt(ctx, {
    type: ResolutionStepType.LIBRARY_SEARCH,
    playerId: playerId as PlayerID,
    sourceId: String(metadata?.sourcePermanentId || 'look-one-graveyard'),
    sourceName,
    description: `${sourceName}: Look at the top ${revealed.length}. Put one into your hand and the rest into your graveyard.`,
    mandatory: true,
    minSelections: 1,
    maxSelections: 1,
    destination: 'hand',
    reveal: true,
    shuffleAfter: false,
    remainderDestination: 'graveyard',
    availableCards: revealed.map((card) => ({ id: String(card?.id || ''), name: card?.name || 'Card' })),
    lookOneRestGraveyard: true,
    lookAtLibraryTop: lookCount,
  } as any);
  return 'break';
}

export function applyChainsDrawReplacement(ctx: GameContext, playerId: string): 'break' | 'continue' {
  const state: any = (ctx as any).state;
  const step = String(state?.step || '').toLowerCase();
  const draws = Number(state?.drawsThisDrawStep?.[playerId] || 0);
  if (step.includes('draw') && draws === 0) {
    state.drawsThisDrawStep = state.drawsThisDrawStep || {};
    state.drawsThisDrawStep[playerId] = draws + 1;
    return 'continue';
  }
  const hand = state?.zones?.[playerId]?.hand;
  if (Array.isArray(hand) && hand.length > 0) {
    const discarded = hand.pop();
    const gy = state.zones[playerId].graveyard || (state.zones[playerId].graveyard = []);
    gy.push(discarded);
    state.zones[playerId].handCount = hand.length;
    state.zones[playerId].graveyardCount = gy.length;
    return 'continue';
  }
  const lib = libraryOf(ctx, playerId);
  const milled = lib.shift();
  if (milled) {
    const gy = state.zones[playerId].graveyard || (state.zones[playerId].graveyard = []);
    gy.push(milled);
    state.zones[playerId].graveyardCount = gy.length;
    writePlayerLibraryToContext(ctx, playerId, lib);
  }
  return 'break';
}

export function applySharedFateDrawReplacement(ctx: GameContext, playerId: string, sourcePermanentId: string): 'break' {
  const state: any = (ctx as any).state;
  const opponents = Object.keys(state?.zones || {}).filter((id) => id !== playerId);
  const opponent = opponents.find((id) => libraryOf(ctx, id).length > 0) || opponents[0];
  if (!opponent) return 'break';
  const lib = libraryOf(ctx, opponent);
  const card = lib.shift();
  writePlayerLibraryToContext(ctx, opponent, lib);
  if (card) {
    card.faceDown = true;
    card.exiledBy = sourcePermanentId;
    card.exiledByPlayer = playerId;
    const exile = state.zones[playerId].exile || (state.zones[playerId].exile = []);
    exile.push(card);
  }
  return 'break';
}
