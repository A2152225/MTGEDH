// server/src/state/modules/zones-handlers/zonesMovePermanentToHand.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: movePermanentToHand.
// Public entry symbols: movePermanentToHand.

import type { PlayerID } from "../../../../../shared/src/types.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import { revertCopyPermanentToOriginal } from "../permanent-copy.js";
import { processLTBTriggers, processReturnedToHandTriggers } from "../triggerEmissionFamilyUtils.js";
import { processLinkedExileReturns } from "../triggers/linked-exile.js";
import { recordPermanentPutIntoHandFromBattlefieldThisTurn } from "../turn-tracking.js";
import {
  applyLeaveBattlefieldReplacementLifeGain,
  tryApplyDeclarativeLeaveBattlefieldDestinationReplacement,
} from "../zone-manipulation.js";
import { clearPreparedStateOnBattlefieldExit } from "./zonesClearPreparedOnBattlefieldExit.js";

/**
 * movePermanentToHand
 * Moves a permanent from battlefield to owner's hand (bounce effect).
 * Handles Commander Replacement Effect (Rule 903.9a) - offers choice to put in command zone instead.
 * 
 * @param permanentId - ID of the permanent to move
 * @returns true if moved (or deferred for commander choice), false if permanent not found
 */
export function movePermanentToHand(ctx: GameContext, permanentId: string): boolean {
  const { state, bumpSeq, commandZone } = ctx;
  const battlefield = state.battlefield || [];
  
  const idx = battlefield.findIndex((p: any) => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = battlefield.splice(idx, 1)[0];
  const removedPermanentId = String((perm as any)?.id || permanentId || '').trim();
  const owner = perm.owner as PlayerID;

  try {
    revertCopyPermanentToOriginal(perm);
  } catch {
    // best-effort only
  }

  const card = perm.card;

  clearPreparedStateOnBattlefieldExit(state, perm);

  // Revolt-style per-turn tracking: a permanent left the battlefield under its controller's control.
  const controllerAtLeave = String((perm as any)?.controller || owner || '').trim();
  try {
    if (controllerAtLeave) {
      (state as any).permanentLeftBattlefieldThisTurn = (state as any).permanentLeftBattlefieldThisTurn || {};
      (state as any).permanentLeftBattlefieldThisTurn[controllerAtLeave] = true;
    }
  } catch {
    // best-effort only
  }

  try {
    processLTBTriggers(ctx, perm, { cause: 'bounce' });
  } catch (err) {
    debugWarn(1, '[movePermanentToHand] processLTBTriggers failed:', err);
  }

  const leaveReplacement = tryApplyDeclarativeLeaveBattlefieldDestinationReplacement(
    ctx,
    perm,
    String(owner || ''),
    {
      intendedDestination: 'hand',
      controller: controllerAtLeave,
      permanentId: removedPermanentId,
      cause: 'bounce',
    },
  );
  if (leaveReplacement.handled) {
    applyLeaveBattlefieldReplacementLifeGain(ctx, leaveReplacement, controllerAtLeave);
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    if (leaveReplacement.replacementDestination !== 'exile') {
      bumpSeq();
    }
    return true;
  }

  // Tokens cease to exist when they leave the battlefield (Rule 111.7).
  if ((perm as any).isToken === true) {
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    debug(2, `[movePermanentToHand] Token ${card?.name || permanentId} left battlefield -> ceased to exist (not moved to hand)`);
    bumpSeq();
    return true;
  }

  try {
    processReturnedToHandTriggers(ctx, perm);
  } catch (err) {
    debugWarn(1, '[movePermanentToHand] processReturnedToHandTriggers failed:', err);
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into its owner's hand from anywhere,
  // its owner may put it into the command zone instead.
  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Defer zone change - let player choose command zone or hand
    // Defer zone change - let player choose command zone or hand via Resolution Queue
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: permanentId,
      sourceName: card.name,
      sourceImage: card.image_uris?.small || card.image_uris?.normal,
      description: `Your commander ${card.name} would be returned to your hand. Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: 'Let it go to hand' },
      ],
      commanderId: card.id,
      commanderName: card.name,
      fromZone: 'hand',
      card: {
        id: card.id,
        name: card.name,
        type_line: card.type_line,
        oracle_text: card.oracle_text,
        image_uris: card.image_uris,
        mana_cost: card.mana_cost,
        power: card.power,
        toughness: card.toughness,
        ...(buildZoneObjectWithRetainedCounters(card, perm, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(card, perm, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[movePermanentToHand] Commander ${card.name} would go to hand - queued commander zone choice step`);
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    bumpSeq();
    return true;
  }
  
  // Non-commander - move directly to hand
  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.hand = z.hand || [];
  z.hand.push({ ...card, zone: 'hand' });
  z.handCount = z.hand.length;

  recordPermanentPutIntoHandFromBattlefieldThisTurn(ctx, String(owner));

  if (removedPermanentId) {
    processLinkedExileReturns(ctx, removedPermanentId);
  }
  
  debug(2, `[movePermanentToHand] ${card?.name || permanentId} returned to ${owner}'s hand`);
  bumpSeq();
  return true;
}
