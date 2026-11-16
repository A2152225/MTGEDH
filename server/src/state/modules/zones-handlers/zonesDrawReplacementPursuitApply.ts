// server/src/state/modules/zones-handlers/zonesDrawReplacementPursuitApply.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster: applyPursuitDrawReplacementChoice — put a study (or parsed)
//   counter on Pursuit of Knowledge instead of drawing, or decline and draw.
// Public entry symbols: applyPursuitDrawReplacementChoice, addCounterToPermanent.
// Leaf must not import zones.ts or zones-handlers/index.ts.

import type { PlayerID } from '../../../../../shared/src/types.js';
import type { GameContext } from '../../context.js';
import { drawCards } from './zonesDrawCards.js';

export interface PursuitDrawReplacementResult {
  applied: boolean;
  putCounter?: boolean;
  declined?: boolean;
  reason?: string;
  drawnCards?: any[];
}

export function addCounterToPermanent(
  ctx: GameContext,
  permanentId: string,
  counterType: string,
  amount: number = 1,
): boolean {
  const id = String(permanentId || '').trim();
  const kind = String(counterType || 'study').trim() || 'study';
  const add = Math.max(1, Math.floor(Number(amount || 1)));
  if (!id) return false;
  const battlefield = Array.isArray((ctx.state as any)?.battlefield) ? (ctx.state as any).battlefield : [];
  const permanent = battlefield.find((entry: any) => String(entry?.id || '') === id);
  if (!permanent) return false;
  if (!permanent.counters || typeof permanent.counters !== 'object' || Array.isArray(permanent.counters)) {
    permanent.counters = {};
  }
  const current = Number(permanent.counters[kind] || 0);
  permanent.counters[kind] = (Number.isFinite(current) ? current : 0) + add;
  if (permanent.card && (permanent.card.counters == null || typeof permanent.card.counters === 'object')) {
    if (!permanent.card.counters || Array.isArray(permanent.card.counters)) permanent.card.counters = {};
    const cardCurrent = Number(permanent.card.counters[kind] || 0);
    permanent.card.counters[kind] = (Number.isFinite(cardCurrent) ? cardCurrent : 0) + add;
  }
  return true;
}

export function applyPursuitDrawReplacementChoice(ctx: GameContext, event: {
  playerId: PlayerID | string;
  choiceId?: string;
  remainingDrawCountAfterChoice?: number;
  sourcePermanentId?: string;
  sourceName?: string;
  counterType?: string;
}): PursuitDrawReplacementResult {
  const playerId = String(event?.playerId || '').trim() as PlayerID;
  if (!playerId) return { applied: false, reason: 'missing_player' };

  const choiceId = String(event?.choiceId || '').trim().toLowerCase();
  const remainingDrawCountAfterChoice = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const counterType = String(event?.counterType || 'study').trim() || 'study';
  const sourcePermanentId = String(event?.sourcePermanentId || '').trim();

  const putCounter = choiceId === 'put_counter' || choiceId === 'put-counter' || choiceId === 'counter';
  if (putCounter) {
    if (sourcePermanentId) addCounterToPermanent(ctx, sourcePermanentId, counterType, 1);
    ctx.bumpSeq();
    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, playerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
    }
    return { applied: true, putCounter: true };
  }

  const previousSuppress = (ctx as any)._suppressPursuitDrawReplacement === true;
  (ctx as any)._suppressPursuitDrawReplacement = true;
  try {
    const drawnCards = drawCards(ctx, playerId, 1, { skipEventPersistence: true });
    if (remainingDrawCountAfterChoice > 0) {
      drawCards(ctx, playerId, remainingDrawCountAfterChoice, { skipEventPersistence: true });
    }
    return { applied: true, declined: true, drawnCards };
  } finally {
    if (previousSuppress) {
      (ctx as any)._suppressPursuitDrawReplacement = true;
    } else {
      delete (ctx as any)._suppressPursuitDrawReplacement;
    }
  }
}
