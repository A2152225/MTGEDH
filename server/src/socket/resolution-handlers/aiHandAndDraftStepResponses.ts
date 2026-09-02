/**
 * socket/resolution-handlers/aiHandAndDraftStepResponses.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep).
 * Cluster moved: the opening run of AI auto-answers for X / mana-color / hand / draft prompts -
 * X_VALUE_SELECTION, MANA_COLOR_SELECTION (single color or a distribution keyed by the chosen
 * code), HAND_TO_BOTTOM (bottom the last N cards), RETURN_CONTROLLED_PERMANENT_CHOICE,
 * HIDEAWAY_CHOICE, REPEATED_ZONE_DRAFT (first legal card; include attachId when
 * that Aura has more than one legal host) and JOIN_FORCES (shared draw/lands pay into X).
 * Public entry symbol: buildAiHandAndDraftStepResponse.
 *
 * The seven `case` bodies became one dispatcher because they were contiguous in the parent switch
 * and each ended in a plain `break`, so the call site is a single fallthrough group of `case` labels
 * assigning `response = buildAiHandAndDraftStepResponse(game, step);`. Four branches used to `break`
 * without assigning a response (no cards to bottom, no permanent / hideaway card / draft card
 * available); those now `return null`, which leaves the parent's `response` null exactly as before.
 * JOIN_FORCES uses `chooseAIJoinForcesContribution` (shared-positive X for all AIs). Returns null for a
 * step type outside this group too.
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
import { filterLegalRepeatedZoneDraftCardIds, buildRepeatedZoneDraftCardChoiceInfo } from "../../../../rules-engine/src/oracleIRExecutorRepeatedZoneDraft.js";
import {
  chooseAIHideawayCardId,
  chooseAIManaColorForActivation,
  chooseAIReturnControlledPermanentId,
  chooseAIXValueSelection,
} from "../ai.js";
import { chooseAIJoinForcesContribution } from "../ai-handlers/aiJoinForcesDecision.js";

/** AI answer for the X / mana-color / hand / draft prompts listed in the module header. */
export function buildAiHandAndDraftStepResponse(
  game: any,
  step: ResolutionStep,
): ResolutionStepResponse | null {
  switch (step.type) {
    case ResolutionStepType.X_VALUE_SELECTION: {
      const xValue = chooseAIXValueSelection(game, step.playerId as any, step as any);
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: xValue,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI X_VALUE_SELECTION: chose X=${xValue}`);
      return response;
    }

    case ResolutionStepType.MANA_COLOR_SELECTION: {
      const stepData = step as any;
      const selectionKind = String(stepData.selectionKind || 'any_color');
      const allowedCodes = Array.isArray(stepData.allowedColors)
        ? stepData.allowedColors
            .map((color: any) => String(color || '').toUpperCase())
            .filter((color: string) => ['W', 'U', 'B', 'R', 'G', 'C'].includes(color))
        : ['W', 'U', 'B', 'R', 'G'];
      const chosenCode = chooseAIManaColorForActivation(
        game,
        step.playerId as any,
        allowedCodes.length > 0 ? allowedCodes : ['W', 'U', 'B', 'R', 'G'],
      );
      const codeToPoolKey: Record<string, string> = {
        W: 'white',
        U: 'blue',
        B: 'black',
        R: 'red',
        G: 'green',
        C: 'colorless',
      };

      const manaSelections: any = selectionKind === 'distribution'
        ? { [chosenCode]: Math.max(0, Number(stepData.totalAmount ?? stepData.amount ?? 0)) }
        : (codeToPoolKey[chosenCode] || 'colorless');

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: manaSelections,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI MANA_COLOR_SELECTION: chose ${selectionKind === 'distribution' ? chosenCode : (codeToPoolKey[chosenCode] || 'colorless')}`);
      return response;
    }

    case ResolutionStepType.HAND_TO_BOTTOM: {
      const stepData = step as any;
      const cardsToBottom = Number(stepData.cardsToBottom || 0);
      if (cardsToBottom <= 0) return null;

      const hand: any[] = Array.isArray(stepData.hand)
        ? stepData.hand
        : (Array.isArray((game.state as any)?.zones?.[step.playerId]?.hand)
            ? (game.state as any).zones[step.playerId].hand
            : []);

      const ids = hand
        .map((c: any) => c?.id)
        .filter((id: any) => typeof id === 'string' && id.length > 0);

      if (ids.length < cardsToBottom) {
        debugWarn(1, `[Resolution] AI HAND_TO_BOTTOM: not enough cards in hand (${ids.length} < ${cardsToBottom})`);
        return null;
      }

      // Simple AI: take the last N cards (deterministic)
      const selected = ids.slice(-cardsToBottom);

      return {
        stepId: step.id,
        playerId: step.playerId,
        selections: selected,
        cancelled: false,
        timestamp: Date.now(),
      };
    }

    case ResolutionStepType.RETURN_CONTROLLED_PERMANENT_CHOICE: {
      const permanentId = chooseAIReturnControlledPermanentId(game, step.playerId as any, step as any);
      if (!permanentId) {
        debugWarn(1, `[Resolution] AI return-controlled-permanent choice: no options available`);
        return null;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [permanentId],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI chose to return permanent: ${permanentId}`);
      return response;
    }

    case ResolutionStepType.HIDEAWAY_CHOICE: {
      const cardId = chooseAIHideawayCardId(game, step.playerId as any, step as any);
      if (!cardId) {
        debugWarn(1, `[Resolution] AI hideaway choice: no cards available`);
        return null;
      }

      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: [cardId],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI chose hideaway card: ${cardId}`);
      return response;
    }

    case ResolutionStepType.REPEATED_ZONE_DRAFT: {
      const draftStep = step as any;
      const remaining = Array.isArray(draftStep.remainingCardIds) ? draftStep.remainingCardIds : [];
      const chooserId = String(step.playerId || '').trim();
      const legalIds = filterLegalRepeatedZoneDraftCardIds(game?.state, remaining, chooserId);
      const cardId = String(legalIds[0] || remaining[0] || '').trim();
      if (!cardId) {
        debugWarn(1, `[Resolution] AI repeated zone draft: no cards remaining`);
        return null;
      }
      const draftInfo = buildRepeatedZoneDraftCardChoiceInfo(game?.state, cardId, chooserId);
      const attachOptions = Array.isArray(draftInfo?.attachOptions) ? draftInfo.attachOptions : [];
      const attachId = attachOptions.length > 1 ? String(attachOptions[0]?.id || '').trim() : '';
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: attachId ? { cardId, attachId } : [cardId],
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI chose draft card: ${cardId}`);
      return response;
    }

    case ResolutionStepType.JOIN_FORCES: {
      const contribution = chooseAIJoinForcesContribution(game, step);
      const response: ResolutionStepResponse = {
        stepId: step.id,
        playerId: step.playerId,
        selections: contribution,
        cancelled: false,
        timestamp: Date.now(),
      };
      debug(2, `[Resolution] AI Join Forces contribution=${contribution}`);
      return response;
    }

    default:
      return null;
  }
}
