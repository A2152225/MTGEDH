import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyMillReplacements } from './game-state-effects.js';
import { pushCardToGraveyardFromLibrary } from './graveyardEntryUtils.js';
import { processMillTriggers } from './zones.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { appendEvent } from '../../db/index.js';

export function millPlayerCardsFromTrigger(
  ctx: GameContext,
  caster: PlayerID,
  targetPlayerId: string,
  count: number,
  sourceName: string,
): void {
  const state = (ctx as any).state;
  if (!targetPlayerId || count <= 0 || !state) {
    return;
  }

  const { finalCount } = applyMillReplacements(ctx, count, String(caster), String(targetPlayerId));
  const millCount = Math.max(0, Number(finalCount ?? count));
  if (millCount <= 0) {
    return;
  }

  const ctxLibraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  let lib: any[] | undefined;
  if (ctxLibraries && typeof ctxLibraries.get === 'function') {
    lib = ctxLibraries.get(targetPlayerId);
  }

  const zones = state.zones || (state.zones = {});
  const z = (zones[targetPlayerId] = zones[targetPlayerId] || {
    hand: [],
    handCount: 0,
    libraryCount: 0,
    graveyard: [],
    graveyardCount: 0,
  });
  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
  const milledCards: any[] = [];

  if (lib && Array.isArray(lib)) {
    for (let i = 0; i < millCount && lib.length > 0; i++) {
      const milled = lib.shift();
      if (milled) {
        pushCardToGraveyardFromLibrary(ctx, String(targetPlayerId), milled, z.graveyard);
        milledCards.push({ ...milled, zone: 'graveyard' });
      }
    }
    if (ctxLibraries && typeof ctxLibraries.set === 'function') {
      ctxLibraries.set(targetPlayerId, lib);
    }
    z.libraryCount = lib.length;
    z.graveyardCount = z.graveyard.length;
    processMillTriggers(ctx, targetPlayerId as PlayerID, milledCards, caster);
    if (!(ctx as any)?.isReplaying) {
      const gameId = String((ctx as any).gameId || '').trim();
      if (gameId && gameId !== 'unknown' && milledCards.length > 0) {
        try {
          appendEvent(
            gameId,
            Number((ctx as any).seq?.value ?? (ctx as any).seq ?? state.seq ?? 0),
            'mill',
            {
              playerId: targetPlayerId,
              count: milledCards.length,
              cardIds: milledCards.map((c: any) => c.id).filter(Boolean),
              sourceName,
            },
          );
        } catch (err) {
          debugWarn(1, '[millPlayerCardsFromTrigger] appendEvent(mill) failed:', err);
        }
      }
    }
    if (typeof (ctx as any).bumpSeq === 'function') {
      (ctx as any).bumpSeq();
    }
    debug(2, `[executeTriggerEffect] ${sourceName} milled ${millCount} card(s) for ${targetPlayerId}`);
  }
}
