/**
 * Origin parent: server/src/socket/ai.ts
 *
 * Cluster moved: handleAIResolutionStep cases trigger_order, kynaios_choice,
 * target_selection, mutate_target_selection, option_choice, modal_choice.
 *
 * Public entry symbols: handleAIResolutionTriggerAndChoiceSteps.
 */
import type { Server } from "socket.io";
import type { PlayerID } from "../../../../shared/src/types.js";
import { ResolutionQueueManager } from "../../state/resolution/ResolutionQueueManager.js";
import { debug } from "../../utils/debug.js";
import { getPlayerName } from "../util.js";
import { chooseAITargetSelectionsForChoiceStep } from "./aiTargetChoiceHandlers.js";
import { chooseAIKynaiosChoiceSelection } from "./aiModeChoiceHandlers.js";
import { chooseAIOptionSelectionsForStep } from "./aiOptionChoiceHandlers.js";

export async function handleAIResolutionTriggerAndChoiceSteps(
  io: Server,
  gameId: string,
  game: any,
  playerId: PlayerID,
  step: any,
  createResponse: (selections: any, cancelled?: boolean) => any,
): Promise<void> {
  switch (step.type) {
      case 'trigger_order': {
        // AI auto-orders triggers (defaults to the order they were provided)
        const triggers = step.triggers || [];
        const orderedTriggerIds = triggers.map((t: any) => t.id);
        
        debug(1, `[AI] Auto-ordering ${orderedTriggerIds.length} triggers`);
        
        // Submit the response via Resolution Queue
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(orderedTriggerIds));
        
        io.to(gameId).emit("chat", {
          id: `m_${Date.now()}`,
          gameId,
          from: "system",
          message: `${getPlayerName(game, playerId)} (AI) puts ${triggers.length} triggered abilities on the stack`,
          ts: Date.now(),
        });
        break;
      }
      
      case 'kynaios_choice': {
        const selection = chooseAIKynaiosChoiceSelection(step);
        ResolutionQueueManager.completeStep(gameId, step.id, createResponse(selection));
        debug(1, `[AI] Kynaios: ${selection.choice}${selection.landCardId ? `:${selection.landCardId}` : ''}`);
        break;
      }
      
      case 'target_selection': {
        const targetsToSelect = chooseAITargetSelectionsForChoiceStep(game, playerId, step);
        const targetResponse = createResponse(targetsToSelect);
        ResolutionQueueManager.completeStep(gameId, step.id, targetResponse);
        if ((step as any)?.oracleIrLibraryChaosTargetSelection === true) {
          const { resolveLibraryChaosTargetSelectionForAI } = await import('../resolution.js');
          await resolveLibraryChaosTargetSelectionForAI(io, game, gameId, step, targetResponse);
        } else if ((step as any)?.planeswalkerAbility) {
          // completeStep only records the choice. Loyalty cost + stack item live in
          // applyResolutionStepSideEffects (same path as a human target response).
          const { applyResolutionStepSideEffects } = await import('../resolution.js');
          await applyResolutionStepSideEffects(io, game, gameId, step, targetResponse);
        }
        debug(1, `[AI] Target selection: Selected ${targetsToSelect.length} target(s)`);
        break;
      }

      case 'mutate_target_selection': {
        const validTargets: any[] = Array.isArray((step as any)?.validTargets) ? (step as any).validTargets : [];
        const targetPermanentId = String(validTargets[0]?.id || '').trim();
        const mutateResponse = createResponse({ targetPermanentId, onTop: true }, !targetPermanentId);

        ResolutionQueueManager.completeStep(gameId, step.id, mutateResponse);
        // completeStep alone does not stamp pendingSpellCasts.mutateTarget.
        const { applyResolutionStepSideEffects } = await import('../resolution.js');
        await applyResolutionStepSideEffects(io, game, gameId, step, mutateResponse);
        debug(1, `[AI] Mutate target selection: ${targetPermanentId || 'no valid target found'}`);
        break;
      }

      case 'option_choice':
      case 'modal_choice': {
        const optionDecision = chooseAIOptionSelectionsForStep(game, playerId, step);
        const response = {
          stepId: step.id,
          playerId,
          selections: optionDecision.selections,
          cancelled: optionDecision.cancelled,
          timestamp: Date.now(),
        };
        ResolutionQueueManager.completeStep(gameId, step.id, response);
        if ((step as any)?.oracleIrLibraryChaosCastPrompt === true) {
          const { resolveLibraryChaosCastChoiceForAI } = await import('../resolution.js');
          await resolveLibraryChaosCastChoiceForAI(io, game, gameId, step, response);
        }
        debug(1, `[AI] ${step.type}: Selected ${optionDecision.selections.join(', ') || 'none'}`);
        break;
      }
  }
}

