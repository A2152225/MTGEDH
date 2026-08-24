/**
 * Extracted from executeSpellEffect.ts.
 * MillCards resolve + persist, including optional caller-stamped mill reason.
 * Entry: applyMillCardsSpellEffect.
 */
import type { PlayerID } from '../../../../shared/src/index.js';
import type { GameContext } from '../context.js';
import { appendEvent } from '../../db/index.js';
import { debug, debugWarn } from '../../utils/debug.js';
import { applyMillReplacements } from './game-state-effects.js';
import { pushCardToPlayerGraveyardWithReplacements } from './graveyardEntryUtils.js';
import { processMillTriggers } from './zones.js';

export const REFLEXIVE_BOUND_GRAVEYARD_SELF_EXILE_PRELUDE_MILL_REASON =
  'reflexive_bound_graveyard_self_exile_prelude';

export function applyMillCardsSpellEffect(
  ctx: GameContext,
  effect: { playerId?: PlayerID; count?: number; reason?: string },
  caster: PlayerID,
  spellName: string,
): void {
  const state = (ctx as any).state;
  const playerId = effect.playerId as PlayerID;
  const count = Math.max(0, Number(effect.count ?? 0));
  if (!playerId || count <= 0) return;

  const { finalCount } = applyMillReplacements(ctx, count, String(caster), String(playerId));
  const millCount = Math.max(0, Number(finalCount ?? count));
  if (millCount <= 0) return;

  const ctxLibraries = (ctx as any).libraries as Map<string, any[]> | undefined;
  let lib: any[] | undefined;
  if (ctxLibraries && typeof ctxLibraries.get === 'function') {
    lib = ctxLibraries.get(playerId);
  }

  const zones = (state as any).zones || ((state as any).zones = {});
  const z = (zones[playerId] = zones[playerId] || { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 });
  z.graveyard = Array.isArray(z.graveyard) ? z.graveyard : [];
  const milledCards: any[] = [];

  if (lib && Array.isArray(lib)) {
    for (let i = 0; i < millCount && lib.length > 0; i++) {
      const milled = lib.shift();
      if (milled) {
        pushCardToPlayerGraveyardWithReplacements(ctx, String(playerId), milled, z.graveyard);
        milledCards.push({ ...milled, zone: 'graveyard' });
      }
    }
    if (ctxLibraries && typeof ctxLibraries.set === 'function') {
      ctxLibraries.set(playerId, lib);
    }
    z.libraryCount = lib.length;
    z.graveyardCount = z.graveyard.length;
    processMillTriggers(ctx, playerId, milledCards, caster);
    if (!(ctx as any)?.isReplaying && milledCards.length > 0) {
      const gameId = String((ctx as any).gameId || '').trim();
      if (gameId && gameId !== 'unknown') {
        const persistReason = String(effect.reason || '').trim();
        try {
          appendEvent(
            gameId,
            Number((ctx as any).seq?.value ?? (ctx as any).seq ?? (state as any)?.seq ?? 0),
            'mill',
            {
              playerId,
              count: milledCards.length,
              cardIds: milledCards.map((c: any) => c.id).filter(Boolean),
              sourceName: spellName,
              ...(persistReason ? { reason: persistReason } : {}),
            },
          );
        } catch (err) {
          debugWarn(1, '[MillCards] appendEvent(mill) failed:', err);
        }
      }
    }
    ctx.bumpSeq();
    debug(2, `[resolveSpell] ${spellName} milled ${millCount} card(s) for ${playerId}`);
  }
}
