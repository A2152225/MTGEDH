// server/src/state/modules/apply-event-handlers/applyEventPursuitDrawReplacementReplay.ts
// Replay hook for pursuitDrawReplacementResolve. Live path already applied the
// choice and appended the event; applyEvent re-applies the choice and clears
// the queued OPTION_CHOICE prompt.

import type { GameContext } from '../context.js';
import type { GameEvent } from '../../types.js';
import { clearReplayQueuedSteps } from '../applyEventReplayZoneCommanderManaHelpers.js';
import { applyPursuitDrawReplacementChoice } from '../zones-handlers/zonesDrawReplacementPursuitApply.js';
import { debugWarn } from '../../../utils/debug.js';

export function applyPursuitDrawReplacementEvents(
  ctx: GameContext,
  e: GameEvent,
): boolean {
  switch (e.type) {
    case 'pursuitDrawReplacementResolve': {
      const playerId = String((e as any).playerId || '').trim();
      const resolvedStepId = String((e as any).resolvedStepId || '').trim();
      const sourcePermanentId = String((e as any).sourcePermanentId || '').trim();
      try {
        const replayGameId = String((ctx as any).gameId || '').trim();
        if (replayGameId) {
          clearReplayQueuedSteps(replayGameId, (step: any) => {
            if (!step) return false;
            const stepId = String(step?.id || '').trim();
            if (resolvedStepId && stepId === resolvedStepId) return true;
            return step?.pursuitDrawReplacementChoice === true
              && (!playerId || String(step?.playerId || '').trim() === playerId)
              && (!sourcePermanentId
                || String(step?.pursuitSourcePermanentId || step?.sourceId || '').trim() === sourcePermanentId);
          });
        }
        applyPursuitDrawReplacementChoice(ctx, {
          playerId,
          choiceId: String((e as any).choiceId || 'draw').trim(),
          remainingDrawCountAfterChoice: Math.max(0, Math.floor(Number((e as any).remainingDrawCountAfterChoice || 0))),
          sourcePermanentId,
          sourceName: String((e as any).sourceName || '').trim(),
          counterType: String((e as any).counterType || 'study').trim() || 'study',
        });
        if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
      } catch (err) {
        debugWarn(1, 'applyEvent(pursuitDrawReplacementResolve): failed', err);
      }
      break;
    }
    default:
      return false;
  }
  return true;
}
