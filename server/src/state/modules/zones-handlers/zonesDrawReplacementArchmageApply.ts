// server/src/state/modules/zones-handlers/zonesDrawReplacementArchmageApply.ts
// Apply Archmage Ascension's optional search-instead-of-draw and resume leftover
// draws. Public: applyArchmageAscensionSearchOnContext.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { applyArchmageAscensionSearchInstead } from '../replacementBatch93DrawReplacements.js';
import { drawCards } from './zonesDrawCards.js';
import { syncPlayerLibraryFromContext, writePlayerLibraryToContext } from './zonesDrawReplacementLibrarySync.js';

function shufflePlayerLibrary(ctx: GameContext, playerId: string): void {
  const lib = syncPlayerLibraryFromContext(ctx, playerId).slice();
  const rng = typeof (ctx as any).rng === 'function' ? (ctx as any).rng.bind(ctx) : Math.random;
  for (let i = lib.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [lib[i], lib[j]] = [lib[j], lib[i]];
  }
  writePlayerLibraryToContext(ctx, playerId, lib);
  if ((ctx as any).state?.zones?.[playerId]) {
    (ctx as any).state.zones[playerId].libraryNeedsShuffle = false;
  }
}

export function applyArchmageAscensionSearchOnContext(ctx: GameContext, event: {
  playerId: string;
  chosenCardId?: string;
  declined?: boolean;
  remainingDrawCountAfterChoice?: number;
  resumeRemaining?: boolean;
}): { applied: boolean; declined: boolean; drawn?: any; reason?: string } {
  const playerId = String(event?.playerId || '').trim();
  if (!playerId || !ctx) return { applied: false, declined: false, reason: 'missing-player' };

  const remaining = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const declined = event?.declined === true || !String(event?.chosenCardId || '').trim();
  let result: { applied: boolean; declined: boolean; drawn?: any; reason?: string };

  if (declined) {
    (ctx as any)._suppressArchmageAscensionReplacement = true;
    try {
      const drawn = drawCards(ctx, playerId as PlayerID, 1, { skipEventPersistence: true });
      result = { applied: true, declined: true, drawn: Array.isArray(drawn) ? drawn[0] : drawn };
    } finally {
      delete (ctx as any)._suppressArchmageAscensionReplacement;
    }
  } else {
    syncPlayerLibraryFromContext(ctx, playerId);
    const applied = applyArchmageAscensionSearchInstead(
      (ctx as any).state,
      playerId,
      String(event.chosenCardId),
    );
    const nextLib = Array.isArray((ctx as any).state?.zones?.[playerId]?.library)
      ? (ctx as any).state.zones[playerId].library
      : [];
    writePlayerLibraryToContext(ctx, playerId, nextLib);
    if (applied.applied) shufflePlayerLibrary(ctx, playerId);
    if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
    result = { applied: applied.applied, declined: false, drawn: applied.drawn, reason: applied.reason };
  }

  if ((ctx as any).state) delete (ctx as any).state.pendingArchmageAscensionDraw;

  if (event?.resumeRemaining !== false && remaining > 0 && result.applied) {
    drawCards(ctx, playerId as PlayerID, remaining, { skipEventPersistence: true });
  }
  return result;
}
