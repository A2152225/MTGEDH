import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { applyMillReplacements } from './game-state-effects.js';
import { checkGraveyardTrigger } from './triggered-abilities.js';
import { recordCardPutIntoGraveyardThisTurn } from './turn-tracking.js';
import { processMillTriggers } from './zones.js';
import { debug } from '../../utils/debug.js';

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
        const graveyardCard = { ...milled, zone: 'graveyard' };
        z.graveyard.push(graveyardCard);
        milledCards.push(graveyardCard);
        recordCardPutIntoGraveyardThisTurn(ctx, String(targetPlayerId), milled, { fromBattlefield: false });

        try {
          checkGraveyardTrigger(ctx, milled, String(targetPlayerId));
        } catch {
          // best-effort
        }
      }
    }
    if (ctxLibraries && typeof ctxLibraries.set === 'function') {
      ctxLibraries.set(targetPlayerId, lib);
    }
    z.libraryCount = lib.length;
    z.graveyardCount = z.graveyard.length;
    processMillTriggers(ctx, targetPlayerId as PlayerID, milledCards, caster);
    if (typeof (ctx as any).bumpSeq === 'function') {
      (ctx as any).bumpSeq();
    }
    debug(2, `[executeTriggerEffect] ${sourceName} milled ${millCount} card(s) for ${targetPlayerId}`);
  }
}
