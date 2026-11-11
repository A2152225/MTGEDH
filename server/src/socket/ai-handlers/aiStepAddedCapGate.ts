/**
 * Origin parent: server/src/socket/resolution.ts (handleAIResolutionStep STEP_ADDED path).
 *
 * Cluster: soft-cap gate for STEP_ADDED auto-resolve. Priority-path loop break already
 * caps Mirko-style recreate storms, but STEP_ADDED setImmediate answers bypass that path
 * (library_search / target_selection / X_VALUE_SELECTION), burning tens of thousands of
 * seq inside one harness tick.
 *
 * Public entry symbol: breakAiStepAddedRecreateIfCapped.
 */
import type { Server } from "socket.io";
import type { ResolutionStep } from "../../state/resolution/index.js";
import { ResolutionStepType } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { rememberAIFailedSpellCast } from "./aiLandAuraCommander.js";
import {
  breakAiCappedAutoResolveStep,
  shouldSoftCapAiAutoResolveStep,
  takeAiResolutionStepCapSlot,
} from "./aiResolutionStepLoopBreak.js";

/**
 * Shared STEP_ADDED soft-cap. Returns true when the caller must return without answering
 * (source already capped this turn). Cancels matching prompts and force-advances empty-stack
 * phases so recreate storms cannot burn the harness tick via setImmediate.
 */
export async function breakAiStepAddedRecreateIfCapped(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
): Promise<boolean> {
  if (!game?.state || !step) return false;
  if (!shouldSoftCapAiAutoResolveStep(step)) return false;
  const playerId = String(step.playerId || '');
  if (!playerId) return false;

  if (takeAiResolutionStepCapSlot(game, playerId, step) !== 'block') {
    return false;
  }

  const stepAny = step as any;
  const spellCardId = String(stepAny?.spellCardId || stepAny?.sourceId || '').trim();
  if (
    step.type === ResolutionStepType.X_VALUE_SELECTION
    && stepAny?.spellCastXSelection === true
    && spellCardId
  ) {
    rememberAIFailedSpellCast(game, playerId, spellCardId);
  }

  debugWarn(1, '[AI] STEP_ADDED resolution-step cap reached; blocking source for this turn', {
    gameId,
    playerId,
    stepType: step.type,
    stepId: step.id,
    sourceName: stepAny?.sourceName || stepAny?.cardName || null,
    spellCardId: spellCardId || null,
  });

  // Do not completeStep — side effects are what recreate the prompt.
  await breakAiCappedAutoResolveStep(
    io,
    game,
    gameId,
    step,
    'STEP_ADDED resolution-step cap reached; blocking source for this turn',
  );
  return true;
}
