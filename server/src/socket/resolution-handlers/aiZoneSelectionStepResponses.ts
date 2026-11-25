/**
 * socket/resolution-handlers/aiZoneSelectionStepResponses.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the contiguous run of AI auto-answers for prompts that pick or order cards in a
 * zone - LIBRARY_SEARCH (delegates to chooseAILibrarySearchResponse, or answers empty when the
 * search found nothing), GRAVEYARD_SELECTION, SCRY, SURVEIL (bin lands, keep the rest on top),
 * BOTTOM_ORDER and LIM_DULS_VAULT (both keep the given order), DANCE_WITH_CALAMITY (continue while
 * the total mana value is safe) and DANCE_WITH_CALAMITY_CAST (cast biggest first), and
 * DISCARD_SELECTION (discard the highest-CMC non-lands first, but keep no-max-hand-size
 * cards; reading the live hand when present).
 * Public entry symbol: buildAiZoneSelectionStepResponse.
 *
 * The nine `case` bodies became one dispatcher because they were contiguous in the parent switch
 * and each ended in a plain `break`, so the call site is a single fallthrough group of `case`
 * labels assigning `response = buildAiZoneSelectionStepResponse(game, step);`. DISCARD_SELECTION
 * keeps Reliquary Tower / Thought Vessel. Returns null only for a step type outside this group.
 *
 * Reads `game` but never `io` or the queue, so resolution.ts imports it directly. Must not import
 * resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug } from "../../utils/debug.js";
import {
  chooseAIGraveyardSelectionIds,
  chooseAILibrarySearchResponse,
  chooseAIScrySelection,
} from "../ai.js";
import { normalizeResolutionCardId } from "../resolutionDiscardResponseCoreHandlers.js";
import { cardGrantsNoMaximumHandSize } from "../../state/modules/handSizeUtils.js";

/** AI answer for the zone card-selection prompts listed in the module header. */
export function buildAiZoneSelectionStepResponse(
  game: any,
  step: ResolutionStep,
): ResolutionStepResponse | null {
  switch (step.type) {
    case ResolutionStepType.LIBRARY_SEARCH: {
      // AI selects the best card(s) from the library search
      const searchStep = step as any;
      const availableCards = (searchStep.availableCards || []).filter((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId) return false;
        const selectableIds = Array.isArray(searchStep.selectableCardIds)
          ? searchStep.selectableCardIds.map((id: any) => String(id || '').trim()).filter(Boolean)
          : [];
        if (selectableIds.length > 0) return selectableIds.includes(cardId);
        const nonSelectableIds = new Set(
          (Array.isArray(searchStep.nonSelectableCards) ? searchStep.nonSelectableCards : [])
            .map((entry: any) => String(entry?.id || '').trim())
            .filter(Boolean),
        );
        return !nonSelectableIds.has(cardId);
      });
      // `||` turned a computed "up to X" of 0 into 1; keep an explicit 0 maximum.
      const minSelections = Math.max(0, Number(searchStep.minSelections ?? 0) || 0);
      const maxSelectionsRaw = Number(searchStep.maxSelections);
      const maxSelections = Number.isFinite(maxSelectionsRaw) && maxSelectionsRaw >= 0 ? Math.floor(maxSelectionsRaw) : 1;
      const destination = searchStep.destination || 'hand';
      const maxTotalManaValue = Number(searchStep.maxTotalManaValue);

      if (availableCards.length === 0 || maxSelections === 0) {
        // No valid cards found (or "up to 0") - complete with empty selection
        const emptyResponse: ResolutionStepResponse = {
          stepId: step.id,
          playerId: step.playerId,
          selections: [],
          // An optional split search that found nothing cannot fill its required battlefield pile: decline it.
          cancelled: searchStep.mandatory === false && availableCards.length === 0 && Number(searchStep.toBattlefield) > 0
            && (searchStep.splitDestination === true || String(searchStep.destination || '').toLowerCase() === 'split'),
          timestamp: Date.now(),
          // Split-destination searches (Cultivate-style) must still name both piles, even when empty.
          ...(searchStep.splitDestination === true || String(searchStep.destination || '').toLowerCase() === 'split'
            ? { splitAssignments: { toBattlefield: [], toHand: [] } }
            : {}),
        };
        debug(2, `[Resolution] AI library search: no available cards, selecting none`);
        return emptyResponse;
      }

      const librarySearch = chooseAILibrarySearchResponse(game, step.playerId as any, availableCards, {
        minSelections,
        maxSelections,
        destination,
        maxTotalManaValue: Number.isFinite(maxTotalManaValue) ? maxTotalManaValue : undefined,
        splitDestination: searchStep.splitDestination === true,
        toBattlefield: Number(searchStep.toBattlefield),
        toHand: searchStep.toHand === 'rest' ? 'rest' : Number(searchStep.toHand),
      });

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: librarySearch.selections,
        cancelled: false,
        timestamp: Date.now(),
        ...(librarySearch.splitAssignments ? { splitAssignments: librarySearch.splitAssignments } : {}),
      };
      debug(2, `[Resolution] AI library search: selected ${librarySearch.selections.length} card(s) from ${availableCards.length} available`);
      return response;
    }

    case ResolutionStepType.GRAVEYARD_SELECTION: {
      const stepData = step as any;
      const selectedCardIds = chooseAIGraveyardSelectionIds(game, step.playerId as any, stepData);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: selectedCardIds.filter(Boolean),
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI graveyard selection: selected ${selectedCardIds.length} card(s)`);
      return response;
    }

    case ResolutionStepType.SCRY: {
      const selections = chooseAIScrySelection(game, step.playerId as any, step as any);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI scry: keeping ${selections.keepTopOrder.length} on top, ${selections.bottomOrder.length} on bottom`);
      return response;
    }

    case ResolutionStepType.SURVEIL: {
      // AI puts cards to graveyard if they're lands (simple strategy)
      const surveilStep = step as any;
      const cards = surveilStep.cards || [];

      const keepTop: any[] = [];
      const toGraveyard: any[] = [];

      for (const card of cards) {
        const typeLine = (card.type_line || '').toLowerCase();
        if (typeLine.includes('land')) {
          toGraveyard.push(card);
        } else {
          keepTop.push(card);
        }
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          keepTopOrder: keepTop,
          toGraveyard: toGraveyard,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI surveil: keeping ${keepTop.length} on top, ${toGraveyard.length} to graveyard`);
      return response;
    }

    case ResolutionStepType.BOTTOM_ORDER: {
      const bottomStep = step as any;
      const cards = bottomStep.cards || [];

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          bottomOrder: cards,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI bottom_order: ordering ${cards.length} card(s) as-is`);
      return response;
    }

    case ResolutionStepType.LIM_DULS_VAULT: {
      const vaultStep = step as any;
      const cards = Array.isArray(vaultStep.cards) ? vaultStep.cards : [];

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          action: 'finish',
          orderedIds: cards.map((card: any) => String(card?.id || '')).filter(Boolean),
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI lim_duls_vault: keeping current top-five order`);
      return response;
    }

    case ResolutionStepType.DANCE_WITH_CALAMITY: {
      const danceStep = step as any;
      const exiledCards = Array.isArray(danceStep.exiledCards) ? danceStep.exiledCards : [];
      const totalManaValue = Number(danceStep.totalManaValue || 0);
      const hasSpell = exiledCards.some((card: any) => !String(card?.type_line || '').toLowerCase().includes('land'));
      const shouldContinue = danceStep.canContinue === true && (!hasSpell || totalManaValue <= 8);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          action: shouldContinue ? 'continue' : 'stop',
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI dance_with_calamity: ${shouldContinue ? 'continue' : 'stop'} at total ${totalManaValue}`);
      return response;
    }

    case ResolutionStepType.DANCE_WITH_CALAMITY_CAST: {
      const castStep = step as any;
      const spellCards = Array.isArray(castStep.spellCards) ? castStep.spellCards : [];
      const orderedSpellIds = [...spellCards]
        .sort((left: any, right: any) => (Number(right?.cmc || 0) || 0) - (Number(left?.cmc || 0) || 0))
        .map((card: any) => String(card?.id || ''))
        .filter(Boolean);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          orderedSpellIds,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI dance_with_calamity_cast: selected ${orderedSpellIds.length} spell(s)`);
      return response;
    }

    case ResolutionStepType.DISCARD_SELECTION: {
      // Answer from the cards the step offers (validated against step.hand), see below.
      const discardStep = step as any;
      // "Discard any number" arrives as discardCount 0; `|| 1` turned it into a forced single discard.
      const discardCountRaw = Number(discardStep.discardCount ?? 1);
      const discardCount = Number.isFinite(discardCountRaw) && discardCountRaw >= 0 ? Math.floor(discardCountRaw) : 1;
      const liveHand: any[] = Array.isArray(game.state?.zones?.[step.playerId]?.hand) ? game.state.zones[step.playerId].hand : [];
      // Activation-cost discards offer a restricted set (typed cost, "at random"): answer from it.
      const costOfferedHand = discardStep.discardAbilityAsCost === true && Array.isArray(discardStep.hand) && discardStep.hand.length > 0
        ? discardStep.hand
        : null;
      // Otherwise the step's `hand` is still the set the validator enforces: the chooser's own hand for
      // cleanup/effect discards, or a revealed opponent hand ("you choose a nonland card from it"). Use the
      // listed cards still in the live hand when there are any, else the listed cards as they are (a
      // revealed hand is not the chooser's zone); the live hand only when the step lists nothing.
      const stepHand: any[] = Array.isArray(discardStep.hand) ? discardStep.hand : [];
      const liveIds = new Set(liveHand.map((card: any) => normalizeResolutionCardId(card?.id)).filter(Boolean));
      const stepHandInLiveHand = stepHand.filter((card: any) => liveIds.has(normalizeResolutionCardId(card?.id)));
      const hand = costOfferedHand
        ? costOfferedHand
        : stepHand.length > 0
        ? (stepHandInLiveHand.length > 0 ? stepHandInLiveHand : stepHand)
        : liveHand;

      if (discardCount > hand.length && discardStep.mandatory === false) {
        // Optional prompt whose count cannot be met ("you may discard your hand" sent as 9999): decline it.
        return { stepId: step.id, playerId: step.playerId, selections: [], cancelled: true, timestamp: Date.now() };
      }

      // Score cards - higher score = discard first
      const scoredHand = hand.map((card: any) => {
        const cmc = card.cmc || 0;
        const typeLine = (card.type_line || '').toLowerCase();
        let score = cmc; // Discard higher CMC first

        // Keep lands lower priority to discard (they're free to play)
        if (typeLine.includes('land')) {
          score -= 5;
        }
        // Reliquary Tower / Thought Vessel must not be dumped to make hand size.
        if (cardGrantsNoMaximumHandSize(card)) {
          score -= 100;
        }

        return { card, score };
      });

      // Sort by score (highest first = discard first)
      scoredHand.sort((a: any, b: any) => b.score - a.score);

      const toDiscard = scoredHand
        .slice(0, discardCount)
        .map((sc: any) => normalizeResolutionCardId(sc.card?.id))
        .filter(Boolean);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: toDiscard,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI discard: discarding ${toDiscard.length} card(s)`);
      return response;
    }

    default:
      return null;
  }
}
