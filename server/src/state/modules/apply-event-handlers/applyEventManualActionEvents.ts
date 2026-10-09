// server/src/state/modules/apply-event-handlers/applyEventManualActionEvents.ts
// Kitchen-table manualAction replay. Origin: new feature (not extracted from applyEvent.ts).
// Public entry: applyManualActionEvents(ctx, e) -> true when it handled the event.
//
// Handles: manualAction

import type { GameContext } from '../../context.js';
import type { GameEvent } from '../../types.js';
import { applyManualAction } from '../manualActionApply.js';
import { debugWarn } from '../../../utils/debug.js';
import type { ManualActionPayload } from '../../../../../shared/src/manualAction.js';

export function applyManualActionEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case 'manualAction': {
      try {
        const payload = {
          verb: (e as any).verb,
          actorId: String((e as any).actorId || (e as any).playerId || ''),
          targetPlayerId: (e as any).targetPlayerId,
          objectIds: (e as any).objectIds,
          count: (e as any).count,
          amount: (e as any).amount,
          fromZone: (e as any).fromZone,
          toZone: (e as any).toZone,
          position: (e as any).position,
          nth: (e as any).nth,
          tapped: (e as any).tapped,
          faceDown: (e as any).faceDown,
          controllerId: (e as any).controllerId,
          attachToId: (e as any).attachToId,
          counterType: (e as any).counterType,
          manaColor: (e as any).manaColor,
          tokenName: (e as any).tokenName,
          tokenPower: (e as any).tokenPower,
          tokenToughness: (e as any).tokenToughness,
          tokenTypeLine: (e as any).tokenTypeLine,
          searchName: (e as any).searchName,
          keepTopIds: (e as any).keepTopIds,
          bottomIds: (e as any).bottomIds,
          graveyardIds: (e as any).graveyardIds,
          libraryOrder: (e as any).libraryOrder,
          drawnCardIds: (e as any).drawnCardIds,
          createdPermanentIds: Array.isArray((e as any).createdPermanentIds)
            ? [...(e as any).createdPermanentIds]
            : (e as any).createdPermanentIds,
          shuffled: (e as any).shuffled,
          outcome: (e as any).outcome,
          note: (e as any).note,
        } as ManualActionPayload;
        applyManualAction(ctx, payload);
      } catch (err) {
        debugWarn(1, 'applyEvent(manualAction): failed', err);
      }
      return true;
    }
    default:
      return false;
  }
}
