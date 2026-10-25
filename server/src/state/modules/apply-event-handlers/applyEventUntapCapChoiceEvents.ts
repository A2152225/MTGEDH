// server/src/state/modules/apply-event-handlers/applyEventUntapCapChoiceEvents.ts
// Replay of an untap-step cap choice (Winter Orb / Imi Statue): event untapCapChoiceResolve { playerId, resolvedStepId, untapped[] }.
// Public entry: applyUntapCapChoiceEvents(ctx, e) -> true when it handled the event.
import type { GameContext } from "../../context";
import type { GameEvent } from "../../types";
import { clearReplayQueuedSteps } from "../applyEventReplayZoneCommanderManaHelpers.js";

export function applyUntapCapChoiceEvents(ctx: GameContext, e: GameEvent): boolean {
  switch (e.type) {
    case 'untapCapChoiceResolve': {
      const ev = e as any;
      const replayGameId = String((ctx as any).gameId || '').trim();
      const playerId = String(ev.playerId || '').trim();
      const resolvedStepId = String(ev.resolvedStepId || '').trim();
      if (replayGameId) {
        clearReplayQueuedSteps(replayGameId, (step: any) => !!step && ((resolvedStepId !== '' && String(step.id || '') === resolvedStepId) || (step.untapCapChoice === true && String(step.playerId || '') === playerId)));
      }
      const bf: any[] = Array.isArray(ctx.state?.battlefield) ? (ctx.state as any).battlefield : [];
      for (const id of Array.isArray(ev.untapped) ? ev.untapped : []) {
        const perm = bf.find((x) => String(x?.id || '') === String(id));
        if (perm) perm.tapped = false;
      }
      if (typeof (ctx as any).bumpSeq === 'function') (ctx as any).bumpSeq();
      return true;
    }
    default:
      return false;
  }
}
