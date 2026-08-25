// server/src/state/modules/zones-handlers/zonesMovePermanentToLibrary.ts
// Origin parent: server/src/state/modules/zones.ts
// Cluster moved: movePermanentToLibrary.
// Public entry symbols: movePermanentToLibrary.

import type { PlayerID } from "../../../../../shared/src/types.js";
import { buildZoneObjectWithRetainedCounters } from "../../../../../shared/src/zoneRetainedCounters.js";
import type { GameContext } from "../../context.js";
import { debug, debugWarn } from "../../../utils/debug.js";
import { ResolutionQueueManager } from "../../resolution/index.js";
import { ResolutionStepType } from "../../resolution/types.js";
import { processLTBTriggers } from "../triggerEmissionFamilyUtils.js";
import { processLinkedExileReturns } from "../triggers/linked-exile.js";
import {
  applyLeaveBattlefieldReplacementLifeGain,
  tryApplyDeclarativeLeaveBattlefieldDestinationReplacement,
} from "../zone-manipulation.js";
import { clearPreparedStateOnBattlefieldExit } from "./zonesClearPreparedOnBattlefieldExit.js";

/**
 * movePermanentToLibrary
 * Moves a permanent from battlefield to owner's library (top, bottom, or shuffled).
 * Handles Commander Replacement Effect (Rule 903.9a) - offers choice to put in command zone instead.
 * 
 * @param permanentId - ID of the permanent to move
 * @param position - 'top', 'bottom', or 'shuffle'
 * @returns true if moved (or deferred for commander choice), false if permanent not found
 */
export function movePermanentToLibrary(
  ctx: GameContext, 
  permanentId: string, 
  position: 'top' | 'bottom' | 'shuffle' = 'shuffle'
): boolean {
  const { state, bumpSeq, commandZone, libraries } = ctx;
  const battlefield = state.battlefield || [];
  
  const idx = battlefield.findIndex((p: any) => p.id === permanentId);
  if (idx < 0) return false;
  
  const perm = battlefield.splice(idx, 1)[0];
  const removedPermanentId = String((perm as any)?.id || permanentId || '').trim();
  const owner = perm.owner as PlayerID;
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
    processLTBTriggers(ctx, perm, { cause: 'library' });
  } catch (err) {
    debugWarn(1, '[movePermanentToLibrary] processLTBTriggers failed:', err);
  }

  const leaveReplacement = tryApplyDeclarativeLeaveBattlefieldDestinationReplacement(
    ctx,
    perm,
    String(owner || ''),
    {
      intendedDestination: 'library',
      controller: controllerAtLeave,
      permanentId: removedPermanentId,
      cause: 'library',
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

  // Tokens cease to exist when they leave the battlefield instead of entering a library.
  if ((perm as any).isToken === true) {
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    debug(2, `[movePermanentToLibrary] Token ${card?.name || permanentId} left battlefield -> ceased to exist (not moved to library)`);
    bumpSeq();
    return true;
  }
  
  // Commander Replacement Effect (Rule 903.9a):
  // If a commander would be put into its owner's library from anywhere,
  // its owner may put it into the command zone instead.
  const commanderInfo = (commandZone as any)?.[owner];
  const commanderIds = commanderInfo?.commanderIds || [];
  const isCommander = (card?.id && commanderIds.includes(card.id)) || (perm as any).isCommander === true;
  
  if (isCommander && card) {
    // Cast card as any to access properties safely
    const cardAny = card as any;
    // Defer zone change - let player choose command zone or library via Resolution Queue
    ResolutionQueueManager.addStep(ctx.gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: owner,
      sourceId: permanentId,
      sourceName: cardAny.name || 'Unknown Commander',
      sourceImage: cardAny.image_uris?.small || cardAny.image_uris?.normal,
      description: `Your commander ${cardAny.name || 'Unknown Commander'} would be put into your library (${position}). Move it to the command zone instead?`,
      mandatory: true,
      minSelections: 1,
      maxSelections: 1,
      commanderZoneChoice: true,
      options: [
        { id: 'command', label: 'Move to Command Zone' },
        { id: 'stay', label: position === 'top' ? 'Put on top of library' : position === 'bottom' ? 'Put on bottom of library' : 'Shuffle into library' },
      ],
      commanderId: cardAny.id,
      commanderName: cardAny.name || 'Unknown Commander',
      fromZone: 'library',
      libraryPosition: position,
      card: {
        id: cardAny.id,
        name: cardAny.name || 'Unknown Commander',
        type_line: cardAny.type_line,
        oracle_text: cardAny.oracle_text,
        image_uris: cardAny.image_uris,
        mana_cost: cardAny.mana_cost,
        power: cardAny.power,
        toughness: cardAny.toughness,
        ...(buildZoneObjectWithRetainedCounters(cardAny, perm, 'command')?.counters
          ? { counters: buildZoneObjectWithRetainedCounters(cardAny, perm, 'command').counters }
          : {}),
      } as any,
    } as any);
    debug(2, `[movePermanentToLibrary] Commander ${cardAny.name || 'Unknown'} would go to library (${position}) - queued commander zone choice step`);
    if (removedPermanentId) {
      processLinkedExileReturns(ctx, removedPermanentId);
    }
    bumpSeq();
    return true;
  }
  
  // Non-commander - move directly to library
  const lib = libraries.get(owner) || [];
  const cardCopy = { ...(card as any), zone: 'library' };
  
  if (position === 'top') {
    lib.unshift(cardCopy);
  } else if (position === 'bottom') {
    lib.push(cardCopy);
  } else {
    // Shuffle into library using deterministic RNG
    lib.push(cardCopy);
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(ctx.rng() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
  }
  
  libraries.set(owner, lib);
  
  // Update library count
  const zones = state.zones = state.zones || {};
  const z = zones[owner] || (zones[owner] = { hand: [], handCount: 0, libraryCount: 0, graveyard: [], graveyardCount: 0 } as any);
  z.libraryCount = lib.length;
  
  if (removedPermanentId) {
    processLinkedExileReturns(ctx, removedPermanentId);
  }

  debug(2, `[movePermanentToLibrary] ${(card as any)?.name || permanentId} put ${position} of ${owner}'s library`);
  bumpSeq();
  return true;
}
