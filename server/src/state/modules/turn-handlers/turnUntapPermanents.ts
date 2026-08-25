// server/src/state/modules/turn-handlers/turnUntapPermanents.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: untapPermanentsForPlayer (Rule 502.3 battlefield untap
// plus stun-counter / doesn't-untap skips).
// Public entry symbols: untapPermanentsForPlayer.
// Called from nextStep via runTurnStepUntap and from
// performUntapStepTurnAction. Leaf must not import turn.ts or
// turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import { isPermanentPreventedFromUntapping } from "../triggered-abilities.js";
import { queueBecomesUntappedTriggers } from "../triggers/tap-untap.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

export function untapPermanentsForPlayer(ctx: GameContext, playerId: string) {
  try {
    const battlefield = (ctx as any).state?.battlefield;
    if (!Array.isArray(battlefield)) return;

    let untappedCount = 0;
    let stunCountersRemoved = 0;
    let skippedDueToEffects = 0;

    for (const permanent of battlefield) {
      if (permanent && permanent.controller === playerId && permanent.tapped) {
        // Check for "doesn't untap during untap step" flag on the permanent
        const doesntUntap = permanent.doesntUntap || false;
        if (doesntUntap) {
          skippedDueToEffects++;
          continue;
        }

        // Check for static effects that prevent untapping (Intruder Alarm, Claustrophobia, etc.)
        try {
          if (isPermanentPreventedFromUntapping(ctx, permanent, playerId)) {
            skippedDueToEffects++;
            continue;
          }
        } catch (e) {
          // If check fails, allow untapping to prevent game state from getting stuck
          debugWarn(1, `${ts()} [untapPermanentsForPlayer] Failed to check untap prevention for ${permanent.card?.name}:`, e);
        }

        // Check for stun counters (Rule 122.1c)
        // If a tapped permanent with a stun counter would become untapped, instead remove a stun counter
        if (permanent.counters && permanent.counters.stun > 0) {
          // Remove one stun counter instead of untapping
          permanent.counters.stun -= 1;
          if (permanent.counters.stun === 0) {
            delete permanent.counters.stun;
          }
          stunCountersRemoved++;
          // Permanent stays tapped
          continue;
        }

        // Normal untap
        permanent.tapped = false;
        queueBecomesUntappedTriggers(ctx, permanent);
        untappedCount++;
      }
    }

    // Clear any "doesn't untap next turn" flags that were set by spells like Sleep
    for (const permanent of battlefield) {
      if (permanent && permanent.controller === playerId && permanent.doesntUntapNextTurn) {
        delete permanent.doesntUntapNextTurn;
      }
    }

    if (untappedCount > 0 || stunCountersRemoved > 0 || skippedDueToEffects > 0) {
      debug(2, 
        `${ts()} [untapPermanentsForPlayer] Player ${playerId}: untapped ${untappedCount}, stun counters removed ${stunCountersRemoved}, skipped (doesn't untap) ${skippedDueToEffects}`
      );
    }
  } catch (err) {
    debugWarn(1, `${ts()} untapPermanentsForPlayer failed:`, err);
  }
}
