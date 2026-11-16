// server/src/state/modules/replacementOrderChoiceApply.ts
// Apply a CR 616.1 replacement-order choice: force the chosen effect first,
// then resume the original event. Public: applyReplacementOrderChoiceOnContext.

import type { PlayerID } from '../../../../shared/src/types.js';
import type { GameContext } from './context.js';
import { ResolutionQueueManager } from '../resolution/index.js';
import { drawCards } from './zones-handlers/zonesDrawCards.js';
import { createToken } from './counters_tokens.js';
import type { ReplacementOrderCandidate, ReplacementOrderEventKind } from './replacementOrderChoice.js';

function stepsFor(gameId: unknown): number {
  const id = String(gameId || '').trim();
  if (!id) return 0;
  try {
    return ResolutionQueueManager.getQueue(id).steps.length;
  } catch {
    return 0;
  }
}

export function applyReplacementOrderChoiceOnContext(ctx: GameContext, event: {
  playerId: string;
  choiceId?: string;
  eventKind?: ReplacementOrderEventKind;
  candidates?: ReplacementOrderCandidate[];
  remainingDrawCountAfterChoice?: number;
  tokenCreate?: any;
}): { applied: boolean; choiceId?: string; queuedFollowup: boolean } {
  const playerId = String(event?.playerId || '').trim();
  const choiceId = String(event?.choiceId || '').trim();
  const candidates = Array.isArray(event?.candidates) ? event.candidates : [];
  if (!playerId || !choiceId || !ctx) return { applied: false, queuedFollowup: false };
  const chosen = candidates.find((c) => c.id === choiceId) || candidates[0];
  if (!chosen) return { applied: false, queuedFollowup: false };

  (ctx as any)._replacementOrderForcedId = chosen.id;
  const remaining = Math.max(0, Math.floor(Number(event?.remainingDrawCountAfterChoice || 0)));
  const kind = event?.eventKind || 'card-draw';
  let queuedFollowup = false;

  try {
    if (kind === 'card-draw') {
      const before = stepsFor((ctx as any).gameId);
      drawCards(ctx, playerId as PlayerID, 1, { skipEventPersistence: true });
      const after = stepsFor((ctx as any).gameId);
      queuedFollowup = after > before;
      if (!queuedFollowup && remaining > 0) {
        drawCards(ctx, playerId as PlayerID, remaining, { skipEventPersistence: true });
      }
    } else {
      const tokenCreate = event.tokenCreate || {};
      const before = stepsFor((ctx as any).gameId);
      createToken(
        ctx,
        playerId as PlayerID,
        String(tokenCreate.name || 'Token'),
        Math.max(0, Math.floor(Number(tokenCreate.count ?? 1))),
        tokenCreate.basePower,
        tokenCreate.baseToughness,
        tokenCreate.options,
        tokenCreate.skipMirrormindReplacement === true,
      );
      queuedFollowup = stepsFor((ctx as any).gameId) > before;
    }
  } finally {
    delete (ctx as any)._replacementOrderForcedId;
  }

  return { applied: true, choiceId: chosen.id, queuedFollowup };
}
