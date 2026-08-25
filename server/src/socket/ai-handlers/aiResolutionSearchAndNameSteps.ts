/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: handleAIResolutionStep cases mode_selection through
 * opening_hand_actions.
 *
 * Public entry symbols: handleAIResolutionSearchAndNameSteps.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug } from "../../utils/debug.js";
import { isOpeningHandBattlefieldCard } from "../opening-hand.js";
import { getDominantCreatureType } from "../creature-type.js";
import { chooseAIGraveyardSelectionIds, chooseAILibrarySearchResponse } from "./aiZoneSearchChoiceHandlers.js";
import { chooseAICardNameSelection, chooseAIPlayerChoiceId } from "./aiPlayerCardNameChoiceHandlers.js";
import { chooseAIModeSelectionsForStep } from "./aiModeChoiceHandlers.js";
import { chooseAIManaColorForActivation } from "./aiManaCostHelpers.js";

export async function handleAIResolutionSearchAndNameSteps(
  io: Server,
  gameId: string,
  game: any,
  playerId: PlayerID,
  step: any,
  createResponse: (selections: any, cancelled?: boolean) => any,
): Promise<void> {
  switch (step.type) {
      case 'mode_selection': {
        const modeDecision = chooseAIModeSelectionsForStep(game, playerId, step);
        const response = {
          stepId: step.id,
          playerId,
          selections: modeDecision.selections,
          cancelled: modeDecision.cancelled,
          timestamp: Date.now(),
        };
        ResolutionQueueManager.completeStep(gameId, step.id, response);
        debug(1, `[AI] mode_selection: Selected ${modeDecision.selections.join(', ') || 'none'}`);
        break;
      }

      case 'graveyard_selection': {
        const selections = chooseAIGraveyardSelectionIds(game, playerId, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selections));
        debug(1, `[AI] graveyard_selection: Selected ${selections.join(', ') || 'none'}`);
        break;
      }

      case 'library_search': {
        const librarySearch = chooseAILibrarySearchResponse(
          game,
          playerId,
          Array.isArray(step?.availableCards) ? step.availableCards : [],
          {
            minSelections: Number(step?.minSelections ?? 0),
            maxSelections: Number(step?.maxSelections ?? 1),
            destination: String(step?.destination || 'hand'),
            maxTotalManaValue: Number.isFinite(Number(step?.maxTotalManaValue))
              ? Number(step.maxTotalManaValue)
              : undefined,
            splitDestination: (step as any)?.splitDestination === true,
            toBattlefield: Number((step as any)?.toBattlefield),
            toHand: (step as any)?.toHand === 'rest' ? 'rest' : Number((step as any)?.toHand),
          },
        );
        const libraryResponse = {
          ...createResponse(librarySearch.selections),
          ...(librarySearch.splitAssignments ? { splitAssignments: librarySearch.splitAssignments } : {}),
        };
        if (ResolutionQueueManager.completeStep(gameId, step.id, libraryResponse)) {
          const { applyResolutionStepSideEffects } = await import('../resolution.js');
          await applyResolutionStepSideEffects(io, game, gameId, step, libraryResponse);
        }
        debug(1, `[AI] library_search: Selected ${librarySearch.selections.join(', ') || 'none'}`);
        break;
      }

      case 'player_choice': {
        const selectedPlayerId = chooseAIPlayerChoiceId(game, playerId, step);
        const selections = selectedPlayerId ? [selectedPlayerId] : [];
        const response = createResponse(selections, !selectedPlayerId);
        if (ResolutionQueueManager.completeStep(gameId, step.id, response)) {
          // Completing the queue entry alone only records the AI's choice. Run the
          // same effect handler used by human responses so control changes, draws,
          // and other player-choice consequences are actually applied.
          const resolutionModule = await import('../resolution.js');
          await resolutionModule.applyResolutionStepSideEffects(io, game, gameId, step, response);
        }
        debug(1, `[AI] player_choice: Selected ${selectedPlayerId || 'none'}`);
        break;
      }

      case 'color_choice': {
        const rawColors = Array.isArray((step as any)?.colors) ? (step as any).colors : [];
        const colorCodes = rawColors
          .map((color: any) => String(color || '').trim().toUpperCase())
          .map((color: string) => {
            if (['W', 'U', 'B', 'R', 'G', 'C'].includes(color)) return color;
            const byName: Record<string, string> = {
              WHITE: 'W',
              BLUE: 'U',
              BLACK: 'B',
              RED: 'R',
              GREEN: 'G',
              COLORLESS: 'C',
            };
            return byName[color] || '';
          })
          .filter(Boolean);
        const chosenCode = chooseAIManaColorForActivation(
          game,
          playerId,
          colorCodes.length > 0 ? colorCodes : ['W', 'U', 'B', 'R', 'G'],
        );
        const codeToColorName: Record<string, string> = {
          W: 'white',
          U: 'blue',
          B: 'black',
          R: 'red',
          G: 'green',
          C: 'colorless',
        };
        const colorName = codeToColorName[chosenCode] || 'colorless';
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([colorName]));
        debug(1, `[AI] color_choice: Selected ${colorName}`);
        break;
      }

      case 'creature_type_choice': {
        const chosenType = String(getDominantCreatureType(game, String(playerId)) || 'Shapeshifter').trim() || 'Shapeshifter';
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([chosenType]));
        debug(1, `[AI] creature_type_choice: Selected ${chosenType}`);
        break;
      }

      case 'card_name_choice': {
        const chosenName = chooseAICardNameSelection(game, playerId, step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse([chosenName]));
        debug(1, `[AI] card_name_choice: Selected ${chosenName}`);
        break;
      }

      case 'opening_hand_actions': {
        const hand = Array.isArray((game.state as any)?.zones?.[playerId]?.hand)
          ? (game.state as any).zones[playerId].hand
          : [];
        const selectedCardIds = hand
          .filter((card: any) => isOpeningHandBattlefieldCard(card, String(playerId), game.state))
          .map((card: any) => String(card?.id || ''))
          .filter(Boolean);

        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selectedCardIds));
        debug(1, `[AI] opening_hand_actions: Selected ${selectedCardIds.length} card(s)`);
        break;
      }
  }
}

