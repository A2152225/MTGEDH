// server/src/state/modules/apply-event-handlers/applyEventPayLifeReplacementOrderReplay.ts
// Replay hook for payLifeReplacementOrderResolve. Live path already applied the
// chosen CR 616.1 replacement (or the unreplaced payment) and appended the
// event; applyEvent re-applies that outcome and clears the order prompt.

import type { GameContext } from '../context.js';
import type { GameEvent } from '../../types.js';
import { clearReplayQueuedSteps } from '../applyEventReplayZoneCommanderManaHelpers.js';
import { applyAshiokLifePayExile } from '../batch96LifePayExile.js';
import { payLifeAmount } from '../batch97PayLife.js';
import {
  PAY_LIFE_REPLACEMENT_ORDER_FLAG,
  applyChosenPayLifeReplacement,
  type PayLifeReplacementCandidate,
} from '../payLifeReplacementOrder.js';
import { debugWarn } from '../../../utils/debug.js';

function applyOne(state: any, playerId: string, amount: number, candidate: PayLifeReplacementCandidate): boolean {
  if (candidate.effectId === 'pay-life-exile-library-top') {
    const applied = applyAshiokLifePayExile(state, playerId, amount);
    return Boolean(applied?.replaced);
  }
  return false;
}

export function applyPayLifeReplacementOrderEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case 'payLifeReplacementOrderResolve': {
      const playerId = String((e as any).playerId || '').trim();
      const amount = Math.max(0, Math.floor(Number((e as any).amount || 0)));
      const chosenId = String((e as any).chosenId || '').trim();
      const resolvedStepId = String((e as any).resolvedStepId || '').trim();
      try {
        const replayGameId = String((ctx as any).gameId || '').trim();
        if (replayGameId) {
          clearReplayQueuedSteps(replayGameId, (step: any) => {
            if (!step) return false;
            const stepId = String(step?.id || '').trim();
            if (resolvedStepId && stepId === resolvedStepId) return true;
            return (step?.[PAY_LIFE_REPLACEMENT_ORDER_FLAG] === true || step?.payLifeReplacementOrderChoice === true)
              && (!playerId || String(step?.playerId || step?.payLifePlayerId || '').trim() === playerId);
          });
        }

        const state = (ctx as any).state;
        let replaced = false;
        const first = applyChosenPayLifeReplacement({
          state,
          playerId,
          amount,
          chosenId,
          applyCandidate: (candidate) => {
            if (applyOne(state, playerId, amount, candidate)) replaced = true;
          },
        });

        if (!replaced) {
          for (const candidate of first.remaining) {
            if (applyOne(state, playerId, amount, candidate)) {
              replaced = true;
              break;
            }
          }
        }

        if (!replaced) {
          payLifeAmount(state, playerId, amount, {
            skipReplacementOrder: true,
            alreadyAppliedEffectIds: [
              first.chosen?.effectId,
              ...first.remaining.map((candidate) => candidate.effectId),
            ].filter(Boolean) as string[],
          });
        }
        if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(payLifeReplacementOrderResolve): failed', err);
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
