/**
 * socket/resolution-handlers/aiCostAndExploreStepResponses.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the contiguous run of AI auto-answers for cost/decision prompts -
 * STATION_CREATURE_SELECTION (tap the highest-power creature, cancel when there is none),
 * LIFE_PAYMENT (pay the minimum), ADDITIONAL_COST_PAYMENT (take the first N of the offered pool),
 * SQUAD_COST_PAYMENT (buy zero), EXPLORE_DECISION and BATCH_EXPLORE_DECISION (keep lands, bin
 * nonlands), MODE_SELECTION (delegates to chooseAIModeSelectionsForStep), OPENING_HAND_ACTIONS
 * (put every eligible card onto the battlefield), TEMPTING_OFFER (decline) and ACTIVATED_ABILITY
 * (auto-resolve).
 * Public entry symbol: buildAiCostAndExploreStepResponse.
 *
 * The ten `case` bodies became one dispatcher because they were contiguous in the parent switch and
 * each ended in a plain `break`, so the call site is a single fallthrough group of `case` labels
 * assigning `response = buildAiCostAndExploreStepResponse(game, step);`. The early `break` inside
 * STATION_CREATURE_SELECTION for an empty creature list is now an early `return` of the same
 * cancelled response. Heuristics and debug strings are unchanged. Returns null only for a step type
 * outside this group.
 *
 * Reads `game` but never `io` or the queue, so resolution.ts imports it directly. Must not import
 * resolution.ts.
 */

import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { chooseAIModeSelectionsForStep } from "../ai.js";
import { isOpeningHandBattlefieldCard } from "../opening-hand.js";

/** AI answer for the cost/decision prompts listed in the module header. */
export function buildAiCostAndExploreStepResponse(
  game: any,
  step: ResolutionStep,
): ResolutionStepResponse | null {
  switch (step.type) {
    case ResolutionStepType.STATION_CREATURE_SELECTION: {
      const stepData = step as any;
      const creatures: any[] = Array.isArray(stepData.tapForCountersCreatures)
        ? stepData.tapForCountersCreatures
        : Array.isArray(stepData.creatures)
          ? stepData.creatures
          : [];

      if (creatures.length === 0) {
        debugWarn(1, `[Resolution] AI STATION_CREATURE_SELECTION: no creature options`);
        return {
          stepId: step.id,
          playerId: step.playerId,
          selections: [],
          cancelled: true,
          timestamp: Date.now(),
        };
      }

      // Prefer the highest power creature (to reach threshold faster)
      const best = creatures
        .slice()
        .sort((a: any, b: any) => Number(b?.power || 0) - Number(a?.power || 0))[0];

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [String(best?.id || creatures[0].id)],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI STATION_CREATURE_SELECTION: chose ${String(best?.name || best?.id)}`);
      return response;
    }

    case ResolutionStepType.LIFE_PAYMENT: {
      const stepData = step as any;
      const minPayment = Number(stepData.minPayment ?? 0);
      const maxPayment = Number(stepData.maxPayment ?? 0);
      const chosen = Number.isFinite(minPayment) ? minPayment : 0;
      const safeChosen = Math.max(0, Math.min(chosen, Number.isFinite(maxPayment) ? maxPayment : chosen));

      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: safeChosen,
        cancelled: false,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.ADDITIONAL_COST_PAYMENT: {
      const stepData = step as any;
      const amount = Math.max(0, Number(stepData.amount ?? 0));
      const costType = String(stepData.costType || 'discard');

      const pool: any[] = costType === 'sacrifice'
        ? (Array.isArray(stepData.availableTargets) ? stepData.availableTargets : [])
        : (Array.isArray(stepData.availableCards) ? stepData.availableCards : []);

      const picked = pool.slice(0, amount).map((x: any) => String(x?.id || '')).filter(Boolean);

      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: picked,
        cancelled: false,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.SQUAD_COST_PAYMENT: {
      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: 0,
        cancelled: false,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.EXPLORE_DECISION: {
      const stepData = step as any;
      const permanentId = String(stepData.permanentId || step.sourceId || '');
      const isLand = Boolean(stepData.isLand);

      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: {
          permanentId,
          // Simple AI: keep lands; bin nonlands.
          toGraveyard: isLand ? false : true,
        },
        cancelled: false,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.BATCH_EXPLORE_DECISION: {
      const stepData = step as any;
      const explores: any[] = Array.isArray(stepData.explores) ? stepData.explores : [];
      const decisions = explores.map((e: any) => ({
        permanentId: String(e?.permanentId || ''),
        toGraveyard: Boolean(e?.isLand) ? false : true,
      })).filter((d: any) => Boolean(d.permanentId));

      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: { decisions },
        cancelled: false,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.MODE_SELECTION: {
      const modeDecision = chooseAIModeSelectionsForStep(game, step.playerId as any, step as any);

      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: modeDecision.selections,
        cancelled: modeDecision.cancelled,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.OPENING_HAND_ACTIONS: {
      const hand = Array.isArray((game.state as any)?.zones?.[step.playerId]?.hand)
        ? (game.state as any).zones[step.playerId].hand
        : [];
      const selectedCardIds = hand
        .filter((card: any) => isOpeningHandBattlefieldCard(card, String(step.playerId), game.state))
        .map((card: any) => String(card?.id || ''))
        .filter(Boolean);

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: selectedCardIds,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI OPENING_HAND_ACTIONS: chose ${selectedCardIds.length} card(s)`);
      return response;
    }

    case ResolutionStepType.TEMPTING_OFFER: {
      // AI declines tempting offers (simple strategy)
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: false,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI declines tempting offer`);
      return response;
    }

    case ResolutionStepType.ACTIVATED_ABILITY: {
      // Activated abilities don't require player choice - they resolve automatically
      // Just auto-complete the step immediately
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: true,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI activated ability auto-resolving`);
      return response;
    }

    default:
      return null;
  }
}
