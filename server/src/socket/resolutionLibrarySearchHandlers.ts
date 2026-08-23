/**
 * socket/resolutionLibrarySearchHandlers.ts
 *
 * Library-search resolution response handler and related step predicates.
 * Extracted from resolution.ts.
 */

import type { Server } from "socket.io";
import type { PlayerID } from "../../../shared/src/types.js";
import { appendEvent } from "../db/index.js";
import { cardHasCreatureType } from "../state/creatureTypeNow.js";
import {
  buildDurablePlayableFromExilePermission,
  upsertDurablePermission,
} from "../state/modules/durable-permissions.js";
import { pushCardToPlayerGraveyardWithReplacements } from "../state/modules/graveyardEntryUtils.js";
import { cleanupCardLeavingExile } from "../state/modules/playable-from-exile.js";
import { readOracleIrLedgerPersistFields } from "../state/modules/oracleIrTransitionPipeline.js";
import { queueLibrarySearchTriggers } from "../state/modules/triggers/search.js";
import { queueLibraryShuffleTriggers } from "../state/modules/triggers/shuffle.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../state/resolution/index.js";
import { debug, debugWarn } from "../utils/debug.js";
import {
  appendQueuedResolutionPromptEvent,
  cloneLibraryStateForEvent,
} from "./resolutionCloneQueuedPromptUtils.js";
import { upsertOneShotCastFromExilePromptPermission } from "./resolutionProcessPendingHandlers.js";
import { broadcastGame, getPlayerName } from "./util.js";
import { putCardOntoBattlefield } from "./resolutionPutCardOntoBattlefieldUtils.js";
import { tryHandleLibrarySearchOracleIrChoiceResume } from "./resolutionLibrarySearchOracleIrChoiceResume.js";

export function isTrueLibrarySearchStep(step: any): boolean {
  const searchZone = String(step?.searchZone || 'library').toLowerCase();
  const searchZones = Array.isArray(step?.searchZones)
    ? step.searchZones.map((zone: any) => String(zone || '').toLowerCase())
    : [];
  const includesLibrary = searchZone === 'library' || searchZones.includes('library') || searchZones.length === 0;
  if (!includesLibrary) return false;

  const text = `${String(step?.description || '')} ${String(step?.searchCriteria || '')}`.toLowerCase();
  if (text.includes('look at the top') || text.includes('reveal the top')) return false;
  if (/\btop\s+(?:one|two|three|four|five|six|seven|eight|nine|ten|\d+)\b/.test(text)) return false;
  return /\bsearch(?:es)?\s+(?:your|their|that player's|target player's|a player's)?\s*library\b/.test(text) || text.includes('search library');
}

export async function handleLibrarySearchResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;

  if (response.cancelled) {
    debug(2, `[Resolution] Library search cancelled by ${pid} (${step.sourceName || 'Library Search'})`);
    return;
  }

  const selections = response.selections as string[]; // Array of card IDs selected
  
  // Get split assignments from response (for Cultivate/Kodama's Reach effects)
  const splitAssignments = response.splitAssignments;
  
  const searchStep = step as any;
  const availableCards = searchStep.availableCards || [];
  const nonSelectableCards = searchStep.nonSelectableCards || [];
  let destination = searchStep.destination || 'hand';
  const remainderDestination = searchStep.remainderDestination || 'shuffle';
  const remainderRandomOrder = searchStep.remainderRandomOrder !== false; // default true
  const shuffleAfter = searchStep.shuffleAfter !== false; // default true
  const shuffleOnlyIfSelectedFromLibrary = (searchStep as any).shuffleOnlyIfSelectedFromLibrary === true;
  const remainderPlayerChoosesOrder =
    remainderDestination === 'bottom' && (searchStep as any).remainderPlayerChoosesOrder === true;
  const contextValue = searchStep.contextValue;
  const entersTapped = searchStep.entersTapped || false;
  const sourceName = step.sourceName || 'Library Search';
  const lifeLoss = (searchStep as any).lifeLoss;

  // Optional extras for specific effects
  const searchOwnerId = String((searchStep as any).searchOwnerId || pid).trim() || String(pid || '');
  const destinationFaceDown = (searchStep as any).destinationFaceDown === true;
  const grantPlayableFromExileToController = (searchStep as any).grantPlayableFromExileToController === true;
  const grantPlayableFromExileControllerId = String((searchStep as any).grantPlayableFromExileControllerId || searchOwnerId).trim() || searchOwnerId;
  const grantPlayableFromExileSpendManaAsThoughAnyType = (searchStep as any).grantPlayableFromExileSpendManaAsThoughAnyType === true;
  const playableFromExileTypeKey = String((searchStep as any).playableFromExileTypeKey || '').toLowerCase();
  const attachSelectedEquipmentToPermanentId = String((searchStep as any).attachSelectedEquipmentToPermanentId || '').trim();

  // Optional override: treat this step as selecting cards from a different zone.
  // Default remains the library.
  const searchZone = String((searchStep as any).searchZone || 'library');
  const searchZones: string[] = Array.isArray((searchStep as any).searchZones)
    ? ((searchStep as any).searchZones as any[]).map((z: any) => String(z))
    : [];
  
  // Check if this is a split destination effect (Cultivate, Kodama's Reach)
  const isSplitDestination = searchStep.splitDestination || destination === 'split';

  const oracleIrChoiceResume = await tryHandleLibrarySearchOracleIrChoiceResume(
    io, game, gameId, step, response, searchStep, selections as string[] | undefined, splitAssignments,
    searchOwnerId, availableCards, nonSelectableCards, entersTapped, sourceName,
    attachSelectedEquipmentToPermanentId, pid,
    destinationFaceDown,
    grantPlayableFromExileToController,
    grantPlayableFromExileControllerId,
    grantPlayableFromExileSpendManaAsThoughAnyType,
    playableFromExileTypeKey,
    lifeLoss,
  );
  if (oracleIrChoiceResume.handled) {
    return;
  }
  if (oracleIrChoiceResume.destination) {
    destination = oracleIrChoiceResume.destination;
  }
  
  debug(2, `[Resolution] Library search response: player=${pid}, selected ${Array.isArray(selections) ? selections.length : 0} from ${availableCards.length} available, destination=${destination}, remainder=${remainderDestination}, isSplit=${isSplitDestination}`);
  
  // Validate selections if any
  const selectedIds = Array.isArray(selections) ? selections : [];
  const availableIds = new Set(availableCards.map((c: any) => c.id));
  for (const cardId of selectedIds) {
    if (!availableIds.has(cardId)) {
      debugWarn(1, `[Resolution] Invalid library search selection: ${cardId} not in available cards`);
      return;
    }
  }
  
  // Get game context and utilities
  const { uid, parsePT, cardManaValue } = await import("../state/utils.js");
  const { applyCounterModifications } = await import("../state/modules/counters_tokens.js");
  const { getETBTriggersForPermanent } = await import("../state/modules/triggered-abilities.js");
  const { triggerETBEffectsForPermanent } = await import("../state/modules/triggerEtbPermanentEffects.js");
  const { detectEntersWithCounters } = await import("../state/modules/detectEntersWithCounters.js");
  const { creatureWillHaveHaste } = await import("../state/modules/creatureEntryHasteUtils.js");
  const { checkPermanentEntersTapped } = await import("../state/modules/triggerPermanentEntersTapped.js");
  
  const state = game.state || {};
  const battlefield = state.battlefield = state.battlefield || [];
  const zones = state.zones = state.zones || {};
  const z = zones[searchOwnerId] = zones[searchOwnerId] || { hand: [], handCount: 0, graveyard: [], graveyardCount: 0, exile: [], exileCount: 0 };
  const lib = (game as any).libraries?.get(searchOwnerId) || [];
  const graveyardEntryCtx = {
    state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as any;

  if (isTrueLibrarySearchStep(searchStep)) {
    queueLibrarySearchTriggers(game as any, String(pid), {
      sourceId: String((step as any).sourceId || '').trim(),
      sourceName,
      searchedLibraryOwnerId: searchOwnerId,
    });
  }
  
  // Create a map of card ID to full card data
  const allRevealedCards = [...availableCards, ...nonSelectableCards];
  const cardMap = new Map(allRevealedCards.map((c: any) => [c.id, c]));
  let didSelectFromLibrary = false;
  const takeCardFromLibrary = (cardId: string) => {
    const idx = lib.findIndex((c: any) => c.id === cardId);
    if (idx >= 0) {
      didSelectFromLibrary = true;
      return lib.splice(idx, 1)[0];
    }
    return cardMap.get(cardId);
  };

  const takeCardFromGraveyard = (cardId: string) => {
    const gy = Array.isArray(z.graveyard) ? z.graveyard : (z.graveyard = []);
    const idx = gy.findIndex((c: any) => c?.id === cardId);
    if (idx >= 0) {
      const [taken] = gy.splice(idx, 1);
      z.graveyardCount = gy.length;
      return taken;
    }
    return cardMap.get(cardId);
  };

  const takeCardFromExile = (cardId: string) => {
    const ex = Array.isArray(z.exile) ? z.exile : (z.exile = []);
    const idx = ex.findIndex((c: any) => c?.id === cardId);
    if (idx >= 0) {
      const [taken] = ex.splice(idx, 1);
      z.exileCount = ex.length;

      // If the card is being removed from the true exile zone and placed elsewhere
      // (hand/battlefield/library/etc), strip any impulse-style playable-from-exile tags.
      // This prevents stale permissions from following the card into other zones.
      if (taken && String(destination || '').toLowerCase() !== 'exile') {
        cleanupCardLeavingExile(state as any, taken);
      }
      return taken;
    }
    return cardMap.get(cardId);
  };

  const takeCardFromHand = (cardId: string) => {
    const hand = Array.isArray(z.hand) ? z.hand : (z.hand = []);
    const idx = hand.findIndex((c: any) => c?.id === cardId);
    if (idx >= 0) {
      const [taken] = hand.splice(idx, 1);
      z.handCount = hand.length;
      return taken;
    }
    return cardMap.get(cardId);
  };

  const takeCard = (cardId: string) => {
    // Multi-zone support: when searching multiple zones, try to remove from each zone in order.
    // This is used by some effects that allow choosing from hand/graveyard/library/exile.
    if (searchZones.length > 0) {
      for (const zone of searchZones) {
        const zkey = String(zone || '').toLowerCase();
        if (zkey === 'exile') {
          const c = takeCardFromExile(cardId);
          if (c) return c;
          continue;
        }
        if (zkey === 'hand') {
          const c = takeCardFromHand(cardId);
          if (c) return c;
          continue;
        }
        if (zkey === 'graveyard') {
          const c = takeCardFromGraveyard(cardId);
          if (c) return c;
          continue;
        }
        // Default (and "library")
        const c = takeCardFromLibrary(cardId);
        if (c) return c;
      }
      return cardMap.get(cardId);
    }
    if (searchZone === 'exile') return takeCardFromExile(cardId);
    if (searchZone === 'hand') return takeCardFromHand(cardId);
    if (searchZone === 'graveyard') return takeCardFromGraveyard(cardId);
    return takeCardFromLibrary(cardId);
  };

  const selectedCards = selectedIds.map(id => takeCard(id)).filter(Boolean);
    const createdPermanentIds: string[] = [];

  const chosenTypeBattlefieldIfPaid = (searchStep as any).chosenTypeBattlefieldIfPaid as
    | { chosenType?: string; additionalCostPaid?: boolean }
    | undefined;
  if (
    chosenTypeBattlefieldIfPaid?.additionalCostPaid === true
    && String(chosenTypeBattlefieldIfPaid.chosenType || '').trim()
    && selectedCards.length === 1
    && cardHasCreatureType(selectedCards[0], String(chosenTypeBattlefieldIfPaid.chosenType))
  ) {
    destination = 'battlefield';
    debug(2, `[Resolution] ${sourceName}: additional cost paid and card matches ${chosenTypeBattlefieldIfPaid.chosenType}; putting onto battlefield`);
  }

  // Optional additional constraints (used by some planeswalker templates)
  const maxTypes = (searchStep as any).maxTypes as Record<string, number> | undefined;
  if (maxTypes && selectedCards.length > 0) {
    const counts: Record<string, number> = {};
    for (const card of selectedCards as any[]) {
      const tl = String(card?.type_line || '').toLowerCase();
      for (const [typeKey, maxAllowed] of Object.entries(maxTypes)) {
        if (typeof maxAllowed !== 'number') continue;
        if (tl.includes(typeKey.toLowerCase())) {
          counts[typeKey] = (counts[typeKey] || 0) + 1;
          if (counts[typeKey] > maxAllowed) {
            debugWarn(1, `[Resolution] Library search: selection exceeds maxTypes constraint (${typeKey} > ${maxAllowed})`);
            return;
          }
        }
      }
    }
  }

  const requireDifferentNames = (searchStep as any).requireDifferentNames === true;
  if (requireDifferentNames && selectedCards.length > 0) {
    const seen = new Set<string>();
    for (const card of selectedCards as any[]) {
      const name = String(card?.name || '').toLowerCase();
      if (!name) continue;
      if (seen.has(name)) {
        debugWarn(1, `[Resolution] Library search: selection violates requireDifferentNames constraint`);
        return;
      }
      seen.add(name);
    }
  }

  const maxTotalManaValue = Number((searchStep as any).maxTotalManaValue);
  if (Number.isFinite(maxTotalManaValue) && maxTotalManaValue >= 0 && selectedCards.length > 0) {
    const totalManaValue = selectedCards.reduce((sum: number, card: any) => {
      return sum + Math.max(0, Number(card?.cmc || 0) || 0);
    }, 0);
    if (totalManaValue > maxTotalManaValue) {
      debugWarn(1, `[Resolution] Library search: selection total mana value ${totalManaValue} exceeds ${maxTotalManaValue}`);
      return;
    }
  }
  
  // If the remainder is ordered by the player, do not shuffle in this handler.
  // Any shuffleAfter responsibility is deferred to the follow-up bottom_order step.
  const willShuffleInThisHandler =
    shuffleAfter &&
    lib.length > 0 &&
    (!shuffleOnlyIfSelectedFromLibrary || didSelectFromLibrary) &&
    !(remainderPlayerChoosesOrder && remainderDestination === 'bottom');
  let pendingBottomOrderEntry: Record<string, any> | undefined;

  // For destination=top with shuffling in this handler, place selected after shuffling remainder
  const deferTopPlacement = destination === 'top' && willShuffleInThisHandler && !shuffleOnlyIfSelectedFromLibrary;
  
  // ========================================================================
  // SPLIT DESTINATION HANDLING (Cultivate, Kodama's Reach)
  // One card goes to battlefield (tapped), the other goes to hand
  // ========================================================================
  if (isSplitDestination && splitAssignments) {
    const { toBattlefield: battlefieldIds, toHand: handIds } = splitAssignments;
    
    // Process cards going to battlefield
    for (const cardId of battlefieldIds || []) {
      const card = selectedCards.find(c => c && c.id === cardId);
      if (card) {
        const createdPermanentId = await putCardOntoBattlefield(card, pid, entersTapped, state, battlefield, uid, parsePT, cardManaValue, applyCounterModifications, getETBTriggersForPermanent, triggerETBEffectsForPermanent, detectEntersWithCounters, creatureWillHaveHaste, checkPermanentEntersTapped, game, io, gameId);
        createdPermanentIds.push(createdPermanentId);

        // Optional: add extra counters as part of the effect (planeswalker templates).
        const addCounters = (searchStep as any).addCounters as Record<string, number> | undefined;
        if (addCounters && typeof addCounters === 'object') {
          const newPerm = battlefield[battlefield.length - 1] as any;
          if (newPerm) {
            newPerm.counters = newPerm.counters || {};
            for (const [k, v] of Object.entries(addCounters)) {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0) continue;
              newPerm.counters[k] = (newPerm.counters[k] || 0) + n;
            }
          }
        }
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} onto battlefield (split destination)`);
      }
    }
    
    // Process cards going to hand
    for (const cardId of handIds || []) {
      const card = selectedCards.find(c => c && c.id === cardId);
      if (card) {
        z.hand = z.hand || [];
        z.hand.push({ ...card, zone: 'hand' });
        z.handCount = z.hand.length;
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} into hand (split destination)`);
      }
    }
  } else if (!deferTopPlacement) {
    // Process selected cards based on single destination
    for (const card of selectedCards) {
      if (!card) continue;
      
      if (destination === 'battlefield') {
        const createdPermanentId = await putCardOntoBattlefield(card, pid, entersTapped, state, battlefield, uid, parsePT, cardManaValue, applyCounterModifications, getETBTriggersForPermanent, triggerETBEffectsForPermanent, detectEntersWithCounters, creatureWillHaveHaste, checkPermanentEntersTapped, game, io, gameId);
        createdPermanentIds.push(createdPermanentId);

        // Optional: add extra counters as part of the effect (planeswalker templates).
        const addCounters = (searchStep as any).addCounters as Record<string, number> | undefined;
        if (addCounters && typeof addCounters === 'object') {
          const newPerm = battlefield[battlefield.length - 1] as any;
          if (newPerm) {
            newPerm.counters = newPerm.counters || {};
            for (const [k, v] of Object.entries(addCounters)) {
              const n = Number(v);
              if (!Number.isFinite(n) || n <= 0) continue;
              newPerm.counters[k] = (newPerm.counters[k] || 0) + n;
            }
          }
        }
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} onto battlefield`);
      } else if (destination === 'hand') {
        z.hand = z.hand || [];
        z.hand.push({ ...card, zone: 'hand' });
        z.handCount = z.hand.length;
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} into hand`);
      } else if (destination === 'graveyard') {
        z.graveyard = z.graveyard || [];
        pushCardToPlayerGraveyardWithReplacements(graveyardEntryCtx, searchOwnerId, card, z.graveyard);
        z.graveyardCount = z.graveyard.length;
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} into graveyard`);
      } else if (destination === 'exile') {
        z.exile = z.exile || [];
        const exiledCard = {
          ...card,
          zone: 'exile',
          ...(destinationFaceDown ? { faceDown: true } : {}),
          ...(grantPlayableFromExileToController ? {
            canBePlayedBy: grantPlayableFromExileControllerId,
            playableUntilTurn: true,
            ...(grantPlayableFromExileSpendManaAsThoughAnyType ? { spendManaAsThoughAnyType: true } : {}),
          } : null),
        };
        z.exile.push(exiledCard);
        z.exileCount = z.exile.length;
        debug(2, `[Resolution] ${sourceName}: Exiled ${card.name}`);

        if (grantPlayableFromExileToController) {
          const typeLine = String((exiledCard as any)?.type_line || '').toLowerCase();
          const passesTypeGate = !playableFromExileTypeKey || typeLine.includes(playableFromExileTypeKey);
          if (passesTypeGate) {
            const stateAny = state as any;
            stateAny.playableFromExile = stateAny.playableFromExile || {};
            const entry = (stateAny.playableFromExile[grantPlayableFromExileControllerId] = stateAny.playableFromExile[grantPlayableFromExileControllerId] || {});
            entry[exiledCard.id] = true;
            upsertDurablePermission(stateAny, buildDurablePlayableFromExilePermission({
              playerId: grantPlayableFromExileControllerId as PlayerID,
              cardIds: [String(exiledCard.id)],
              action: 'play',
              duration: 'static',
              turnApplied: Number(stateAny.turnNumber || 0),
              sourceName,
              spendManaAsThoughAnyType: grantPlayableFromExileSpendManaAsThoughAnyType,
            }));
          }
        }
      } else if (destination === 'top') {
        lib.unshift({ ...card, zone: 'library' });
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} on top of library`);
      } else if (destination === 'bottom') {
        lib.push({ ...card, zone: 'library' });
        debug(2, `[Resolution] ${sourceName}: Put ${card.name} on bottom of library`);
      }
    }
  }
  
  // Handle unselected cards (remainder)
  const unselectedCards = allRevealedCards.filter((c: any) => !selectedIds.includes(c.id));
  
  if (remainderDestination === 'none') {
    // Intentionally do nothing.
  } else if (remainderDestination === 'graveyard') {
    z.graveyard = z.graveyard || [];
    for (const card of unselectedCards) {
      const fromLib = takeCardFromLibrary(card.id) || card;
      pushCardToPlayerGraveyardWithReplacements(graveyardEntryCtx, searchOwnerId, fromLib, z.graveyard);
    }
    z.graveyardCount = z.graveyard.length;
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards into graveyard`);
  } else if (remainderDestination === 'bottom') {
    if (remainderPlayerChoosesOrder) {
      // Remove the remainder from the library immediately, then prompt for ordering.
      const cardsToOrder = unselectedCards.map((c: any) => takeCardFromLibrary(c.id) || c).filter(Boolean);

      if (cardsToOrder.length > 0) {
        const shuffleAfterBottomOrder =
          shuffleAfter && (!shuffleOnlyIfSelectedFromLibrary || didSelectFromLibrary);
        const bottomOrderEffectId = [
          String((step as any).sourceId || sourceName || 'bottom_order'),
          ...cardsToOrder.map((card: any) => String(card?.id || '')).filter(Boolean),
        ].join(':');

        const queuedBottomOrderStep = {
          effectId: bottomOrderEffectId,
          sourceId: (step as any).sourceId,
          sourceName,
          sourceImage: (step as any).sourceImage,
          cards: cardsToOrder.map((card: any) => ({ ...card, zone: 'library' })),
          shuffleAfter: shuffleAfterBottomOrder,
          description: `${sourceName}: Put the rest on the bottom of your library in any order.`,
          type: ResolutionStepType.BOTTOM_ORDER,
          playerId: pid as any,
          mandatory: true,
        };

        const queuedStep = ResolutionQueueManager.addStep(gameId, queuedBottomOrderStep as any);
        appendQueuedResolutionPromptEvent(game, gameId, {
          playerId: pid,
          sourceId: String((step as any).sourceId || '').trim(),
          queuedResolutionStep: queuedStep,
        });
      }

      debug(2, `[Resolution] ${sourceName}: Queued bottom_order for ${unselectedCards.length} remainder card(s)`);
    } else {
      const cardsToBottom = remainderRandomOrder 
        ? [...unselectedCards].sort(() => Math.random() - 0.5)
        : unselectedCards;
      for (const card of cardsToBottom) {
        const fromLib = takeCardFromLibrary(card.id) || card;
        lib.push({ ...fromLib, zone: 'library' });
      }
      debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on bottom${remainderRandomOrder ? ' in random order' : ''}`);
    }
  } else if (remainderDestination === 'top') {
    const cardsToTop = remainderRandomOrder 
      ? [...unselectedCards].sort(() => Math.random() - 0.5)
      : unselectedCards;
    for (const card of cardsToTop.reverse()) {
      const fromLib = takeCardFromLibrary(card.id) || card;
      lib.unshift({ ...fromLib, zone: 'library' });
    }
    debug(2, `[Resolution] ${sourceName}: Put ${unselectedCards.length} unselected cards on top${remainderRandomOrder ? ' in random order' : ''}`);
  } else if (remainderDestination === 'shuffle' || remainderDestination === 'hand') {
    // Put back in library and shuffle, or to hand
    if (remainderDestination === 'hand') {
      z.hand = z.hand || [];
      for (const card of unselectedCards) {
        const fromLib = takeCardFromLibrary(card.id) || card;
        z.hand.push({ ...fromLib, zone: 'hand' });
      }
      z.handCount = z.hand.length;
    } else {
      // remainderDestination shuffle: leave cards in library (already present)
    }
  }
  
  // Shuffle if required
  if (willShuffleInThisHandler) {
    for (let i = lib.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [lib[i], lib[j]] = [lib[j], lib[i]];
    }
    debug(2, `[Resolution] ${sourceName}: Shuffled library`);

    queueLibraryShuffleTriggers(game as any, searchOwnerId, {
      sourceId: String((step as any).sourceId || '').trim(),
      sourceName,
    });
  }

  if (deferTopPlacement && selectedCards.length > 0) {
    for (let i = selectedCards.length - 1; i >= 0; i--) {
      const card = selectedCards[i];
      if (!card) continue;
      lib.unshift({ ...card, zone: 'library' });
      debug(2, `[Resolution] ${sourceName}: Put ${card.name} on top of library after shuffling`);
    }
  }
  
  // Update library count
  z.libraryCount = lib.length;
  if ((game as any).libraries?.set) {
    (game as any).libraries.set(searchOwnerId, lib);
  }
  z.library = lib;
  const libraryOwnerPlayer = ((game.state as any).players || []).find(
    (entry: any) => String(entry?.id || '').trim() === searchOwnerId,
  );
  if (libraryOwnerPlayer) {
    (libraryOwnerPlayer as any).library = lib;
  }

  if ((searchStep as any).persistLibrarySearchResolve === true) {
    try {
      appendEvent(gameId, game.seq ?? 0, 'librarySearchResolve', {
        playerId: pid,
        resolvedStepId: String((step as any).id || '').trim(),
        searchOwnerId,
        sourceId: String((step as any).sourceId || ''),
        sourceName,
        reason: String((searchStep as any).persistLibrarySearchResolveReason || ''),
        abilityId: String((searchStep as any).persistLibrarySearchResolveAbilityId || ''),
        selectedCardIds: selectedCards.map((card: any) => String(card?.id || '')).filter(Boolean),
        selectedCards: selectedCards.map((card: any) => ({ ...card })),
        createdPermanentIds: createdPermanentIds.length > 0 ? [...createdPermanentIds] : undefined,
        destination,
        splitAssignments: splitAssignments || undefined,
        entersTapped,
        destinationFaceDown,
        grantPlayableFromExileToController,
        grantPlayableFromExileControllerId,
        grantPlayableFromExileSpendManaAsThoughAnyType,
        playableFromExileTypeKey,
        pendingBottomOrder: pendingBottomOrderEntry
          ? {
              effectId: String(pendingBottomOrderEntry.effectId || ''),
              sourceId: String(pendingBottomOrderEntry.sourceId || ''),
              sourceName: String(pendingBottomOrderEntry.sourceName || ''),
              sourceImage: pendingBottomOrderEntry.sourceImage,
              description: String(pendingBottomOrderEntry.description || ''),
              cards: cloneLibraryStateForEvent(pendingBottomOrderEntry.cards || []),
              shuffleAfter: pendingBottomOrderEntry.shuffleAfter === true,
            }
          : undefined,
        remainingLibraryIds: lib.map((card: any) => String(card?.id || '')).filter(Boolean),
        lifeLoss: Number(lifeLoss || 0),
        ...readOracleIrLedgerPersistFields(game.state),
      });
    } catch {
      // Ignore persistence failures.
    }
  }

  if (destination === 'battlefield' && attachSelectedEquipmentToPermanentId && createdPermanentIds.length > 0) {
    const equipmentPermanentId = String(createdPermanentIds[0] || '').trim();
    const battlefieldRef = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const equipment = battlefieldRef.find((permanent: any) => permanent?.id === equipmentPermanentId);
    const targetPermanent = battlefieldRef.find((permanent: any) => permanent?.id === attachSelectedEquipmentToPermanentId);
    const equipmentTypeLine = String(equipment?.card?.type_line || '').toLowerCase();

    if (equipment && targetPermanent && equipmentTypeLine.includes('equipment')) {
      const equipmentId = String((equipment as any).id || equipmentPermanentId);
      for (const permanent of battlefieldRef) {
        const attachedEquipment = Array.isArray((permanent as any)?.attachedEquipment)
          ? (permanent as any).attachedEquipment
          : null;
        if (!attachedEquipment) continue;
        (permanent as any).attachedEquipment = attachedEquipment.filter((id: any) => String(id) !== equipmentId);
        if ((permanent as any).attachedEquipment.length === 0) {
          (permanent as any).isEquipped = false;
        }
      }

      (equipment as any).attachedTo = attachSelectedEquipmentToPermanentId;
      targetPermanent.attachedEquipment = Array.isArray(targetPermanent.attachedEquipment) ? targetPermanent.attachedEquipment : [];
      if (!targetPermanent.attachedEquipment.some((id: any) => String(id) === equipmentId)) {
        targetPermanent.attachedEquipment.push(equipmentId);
      }
      targetPermanent.isEquipped = true;

      try {
        await appendEvent(gameId, (game as any).seq ?? 0, 'equipPermanent', {
          playerId: String(pid),
          equipmentId,
          targetCreatureId: attachSelectedEquipmentToPermanentId,
        });
      } catch (err) {
        debugWarn(1, '[Resolution] Failed to persist equipPermanent event for post-search Equipment attachment:', err);
      }
    }
  }

  // Optional follow-up: after exiling a selected card, offer to cast it for free.
  // Used by some planeswalker templates (e.g., Kasmina, Enigma Sage).
  const followUpMayCast = (searchStep as any).followUpMayCastSelectedFromExileWithoutPayingManaCost === true;
  if (followUpMayCast && destination === 'exile' && selectedCards.length >= 1) {
    const cardsToOffer = (selectedCards as any[]).filter(Boolean);
    const chosen = cardsToOffer[0];
    const declineDestination = (searchStep as any).followUpMayCastDeclineDestination || 'exile';

    upsertOneShotCastFromExilePromptPermission(game, pid as PlayerID, chosen, sourceName, (step as any).sourceId);

    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: pid as any,
      description: `${sourceName}: You may cast ${chosen?.name || 'that card'} from exile without paying its mana cost.`,
      mandatory: false,
      sourceName,
      sourceId: (step as any).sourceId,
      sourceImage: (step as any).sourceImage,
      options: [
        { id: 'cast', label: `Cast ${chosen?.name || 'that card'}` },
        { id: 'decline', label: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      castFromExileCardId: chosen?.id,
      castFromExileCard: chosen,
      castFromExileDeclineDestination: declineDestination,
      castFromExileQueueCardIds: cardsToOffer.map(c => c.id),
      castFromExileQueueCards: cardsToOffer,
      castFromExileQueueIndex: 0,
    } as any);
  }

  // Apply life loss if specified (e.g., Vampiric Tutor)
  if (lifeLoss && lifeLoss > 0) {
    const startingLife = game.state.startingLife || 40;
    const currentLife = game.state.life?.[pid] ?? startingLife;
    game.state.life = game.state.life || {};
    game.state.life[pid] = currentLife - lifeLoss;

    // Track life lost this turn.
    try {
      (game.state as any).lifeLostThisTurn = (game.state as any).lifeLostThisTurn || {};
      (game.state as any).lifeLostThisTurn[String(pid)] = ((game.state as any).lifeLostThisTurn[String(pid)] || 0) + Number(lifeLoss || 0);
    } catch {}
    debug(2, `[Resolution] ${sourceName}: ${pid} loses ${lifeLoss} life (${currentLife} → ${game.state.life[pid]})`);
  }
  
  // Send appropriate chat message
  const selectedCount = selectedIds.length;
  const totalRevealed = allRevealedCards.length;
  
  let message = `${getPlayerName(game, pid)} `;
  if (sourceName.toLowerCase().includes('genesis wave')) {
    message += `revealed ${totalRevealed} cards with Genesis Wave (X=${contextValue || '?'}), put ${selectedCount} permanent(s) onto the battlefield`;
    if (remainderDestination === 'graveyard') {
      message += `, and ${unselectedCards.length} card(s) into the graveyard`;
    }
  } else {
    message += `${sourceName}: selected ${selectedCount} of ${availableCards.length} card(s)`;
    if (destination === 'hand') message += ' to hand';
    else if (destination === 'battlefield') message += ' onto the battlefield';
    else if (destination === 'graveyard') message += ' to graveyard';
  }
  message += '.';
  
  io.to(gameId).emit("chat", {
    id: `m_${Date.now()}`,
    gameId,
    from: "system",
    message,
    ts: Date.now(),
  });
  
  if (typeof game.bumpSeq === "function") {
    game.bumpSeq();
  }
}

