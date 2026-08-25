// server/src/state/modules/turn-handlers/turnFlickerEndStepReturns.ts
// Origin parent: server/src/state/modules/turn.ts
// Cluster moved: processPendingFlickerReturnsAtBeginningOfEndStep.
// Public entry symbols: processPendingFlickerReturnsAtBeginningOfEndStep.
// Leaf must not import turn.ts or turn-handlers/index.ts.

import type { GameContext } from "../../context.js";
import type { PlayerID } from "../../../../../shared/src/types.js";
import { triggerETBEffectsForPermanent } from "../triggerEtbPermanentEffects.js";
import { detectEntersWithCounters } from "../detectEntersWithCounters.js";
import { uid } from "../../utils.js";
import { cleanupCardLeavingExile } from "../playable-from-exile.js";
import { debug, debugWarn } from "../../../utils/debug.js";

/** Small helper to prepend ISO timestamp to debug logs */
function ts() {
  return new Date().toISOString();
}

export function processPendingFlickerReturnsAtBeginningOfEndStep(
  ctx: GameContext,
  turnPlayer: PlayerID,
  timing: 'end_step' | 'end_combat' = 'end_step',
) {
  try {
    const state = (ctx as any).state;
    if (!state) return;

    const pending = (state as any).pendingFlickerReturns;
    if (!Array.isArray(pending) || pending.length === 0) return;

    const zones = (state as any).zones || {};
    const battlefield = (state as any).battlefield || [];

    const remaining: any[] = [];
    let returnedCount = 0;

    for (const entry of pending) {
      if (!entry || entry.kind !== 'return_from_exile_to_battlefield') {
        remaining.push(entry);
        continue;
      }

      const ownerId = entry.ownerId as PlayerID | undefined;
      const cardId = entry.cardId as string | undefined;
      const returnAt = String(entry.returnAt || '');

      if (!ownerId || !cardId) {
        continue;
      }

      if (timing === 'end_combat') {
        if (returnAt !== 'end_of_combat') {
          remaining.push(entry);
          continue;
        }
      } else if (returnAt === 'end_of_combat') {
        remaining.push(entry);
        continue;
      }

      // Only process "owner's next end step" when that player is the active player.
      if (returnAt === 'owners_next_end_step' && ownerId !== turnPlayer) {
        remaining.push(entry);
        continue;
      }

      const exile = Array.isArray(zones?.[ownerId]?.exile) ? zones[ownerId].exile : [];
      const exileIdx = exile.findIndex((c: any) => c?.id === cardId);
      if (exileIdx < 0) {
        // Card is no longer in exile (commander replacement, moved elsewhere, etc.)
        continue;
      }

      const card = exile.splice(exileIdx, 1)[0];
      if (!card) {
        continue;
      }

      cleanupCardLeavingExile(state, card);

      const entersWithCounters = detectEntersWithCounters(card);
      const isPlaneswalker = String(card?.type_line || '').toLowerCase().includes('planeswalker');

      const newPermanent: any = {
        id: uid('perm'),
        card,
        controller: ownerId,
        owner: ownerId,
        tapped: false,
        summoning_sickness: String(card?.type_line || '').toLowerCase().includes('creature') || false,
        counters: entersWithCounters && Object.keys(entersWithCounters).length > 0 ? entersWithCounters : {},
        attachedTo: undefined,
      };

      if (isPlaneswalker && card?.loyalty) {
        const loyaltyValue = parseInt(String(card.loyalty), 10);
        if (!Number.isNaN(loyaltyValue)) {
          newPermanent.counters = { ...newPermanent.counters, loyalty: loyaltyValue };
          newPermanent.loyalty = loyaltyValue;
          newPermanent.baseLoyalty = loyaltyValue;
        }
      }

      battlefield.push(newPermanent);
      returnedCount += 1;

      try {
        triggerETBEffectsForPermanent(ctx as any, newPermanent, ownerId);
      } catch (err) {
        debugWarn(1, `${ts()} [processPendingFlickerReturns] Failed to trigger ETBs for ${card?.name || cardId}:`, err);
      }
    }

    (state as any).pendingFlickerReturns = remaining;
    if (returnedCount > 0) {
      debug(2, `${ts()} [processPendingFlickerReturns] Returned ${returnedCount} card(s) from exile during ${timing} for ${turnPlayer}`);
      (ctx as any).bumpSeq?.();
    }
  } catch (err) {
    debugWarn(1, `${ts()} [processPendingFlickerReturns] Failed:`, err);
  }
}
