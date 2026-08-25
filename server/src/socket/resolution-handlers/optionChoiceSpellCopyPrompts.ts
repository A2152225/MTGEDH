/**
 * socket/resolution-handlers/optionChoiceSpellCopyPrompts.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleOptionChoiceResponse).
 * Cluster moved: the three OPTION_CHOICE prompts around copying something on the stack -
 * `resolvedSpellCopyChoice` (accept the copy, put the snapshot back on the stack, then offer the
 * retarget prompt when the copy has targets), `retargetSpellCopy` and `retargetAbilityCopy` (both
 * answer keep-or-retarget and, on retarget, queue the TARGET_SELECTION that rewrites the copy's
 * targets).
 * Public entry symbols: handleResolvedSpellCopyChoice, handleRetargetSpellCopyChoice,
 * handleRetargetAbilityCopyChoice.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`. The
 * TARGET_SELECTION side of these prompts already lives in
 * `targetSelectionExertAndCopyRetargetHandlers.ts`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import type { PlayerID } from "../../../../shared/src/types.js";
import { debugWarn } from "../../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { broadcastGame } from "../util.js";
import { extractOptionChoiceSelectionId } from "./resolutionOptionChoiceSelectionIds.js";

/** "You may copy that spell" after it resolved, then optionally retarget the copy. */
export async function handleResolvedSpellCopyChoice(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = String(extractOptionChoiceSelectionId(response.selections) || 'no').trim().toLowerCase() || 'no';
  const sourceId = String(step.sourceId || '').trim() || undefined;
  const sourceName = String(step.sourceName || 'Spell').trim() || 'Spell';

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'resolvedSpellCopyChoiceResolve', {
      playerId,
      sourceId,
      resolvedStepId: String(step.id || '').trim() || undefined,
      choiceId,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(resolvedSpellCopyChoiceResolve) failed:', err);
  }

  if (choiceId !== 'yes') {
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const copiedSpellSnapshot = stepData?.resolvedSpellCopySnapshot;
  if (!copiedSpellSnapshot || typeof copiedSpellSnapshot !== 'object' || Array.isArray(copiedSpellSnapshot)) {
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const copyResolvePayload = {
    playerId,
    sourceId,
    sourceName,
    copiedSpell: copiedSpellSnapshot,
  };

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'resolvedSpellCopyResolve', copyResolvePayload);
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(resolvedSpellCopyResolve) failed:', err);
  }

  if (typeof (game as any).applyEvent === 'function') {
    (game as any).applyEvent({ type: 'resolvedSpellCopyResolve', ...copyResolvePayload } as any);
  } else {
    const stack = Array.isArray((game.state as any)?.stack) ? (game.state as any).stack : (((game.state as any).stack = []) as any[]);
    const copiedSpellId = String((copiedSpellSnapshot as any)?.id || '').trim();
    if (!copiedSpellId || !stack.some((item: any) => item && String(item.id || '').trim() === copiedSpellId)) {
      stack.push({ ...(copiedSpellSnapshot as any) });
    }
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${sourceName} is copied.`,
    ts: Date.now(),
  });

  const copyStackItemId = String((copiedSpellSnapshot as any)?.id || '').trim();
  const validTargets = Array.isArray(stepData?.resolvedSpellCopyRetargetValidTargets)
    ? stepData.resolvedSpellCopyRetargetValidTargets
    : [];
  const currentTargets = Array.isArray((copiedSpellSnapshot as any)?.targets)
    ? (copiedSpellSnapshot as any).targets
    : [];

  if (copyStackItemId && validTargets.length > 0 && currentTargets.length > 0) {
    const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: playerId as any,
      description: `${sourceName}: You may choose new targets for the copy.`,
      mandatory: false,
      sourceId: copyStackItemId,
      sourceName,
      options: [
        { id: 'keep', label: 'Keep current targets' },
        { id: 'retarget', label: 'Choose new targets' },
      ],
      minSelections: 1,
      maxSelections: 1,
      retargetSpellCopy: true,
      retargetSpellCopyStackItemId: copyStackItemId,
      retargetSpellCopyValidTargets: validTargets.map((target: any) => ({ ...target })),
      retargetSpellCopyMinTargets: Number(stepData?.resolvedSpellCopyRetargetMinTargets || currentTargets.length || 1),
      retargetSpellCopyMaxTargets: Number(stepData?.resolvedSpellCopyRetargetMaxTargets || currentTargets.length || 1),
      retargetSpellCopyTargetDescription: String(stepData?.resolvedSpellCopyRetargetTargetDescription || 'target'),
    } as any);

    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId,
      sourceId: copyStackItemId,
      queuedResolutionStep,
    });
  }

  if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
  broadcastGame(io, game, gameId);
}

/** Retarget a copied spell. */
export async function handleRetargetSpellCopyChoice(
  _io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const copyStackItemId = stepData.retargetSpellCopyStackItemId as string | undefined;
  if (!copyStackItemId) return;
  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'copyRetargetChoiceResolve', {
      playerId,
      sourceId: String(copyStackItemId || '').trim() || undefined,
      resolvedStepId: String(step.id || '').trim() || undefined,
      choiceId: String(choiceId || '').trim() || undefined,
      copyKind: 'spell',
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(copyRetargetChoiceResolve spell) failed:', err);
  }
  if (!choiceId || choiceId === 'keep') {
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const validTargets = Array.isArray(stepData.retargetSpellCopyValidTargets) ? stepData.retargetSpellCopyValidTargets : [];
  const minTargets = Number(stepData.retargetSpellCopyMinTargets || 1);
  const maxTargets = Number(stepData.retargetSpellCopyMaxTargets || 1);
  const targetDescription = String(stepData.retargetSpellCopyTargetDescription || 'target');

  if (validTargets.length === 0) {
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: playerId as PlayerID,
    description: `Choose ${targetDescription} for the copied spell`,
    mandatory: true,
    sourceId: copyStackItemId,
    sourceName: step.sourceName,
    validTargets,
    targetTypes: ['spell_target'],
    minTargets,
    maxTargets,
    targetDescription,
    priority: -1,
    retargetSpellCopyTargetSelection: true,
    retargetSpellCopyStackItemId: copyStackItemId,
  } as any);

  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId,
    sourceId: String(copyStackItemId || '').trim(),
    queuedResolutionStep,
  });
}

/** Retarget a copied activated or triggered ability. */
export async function handleRetargetAbilityCopyChoice(
  _io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepData = step as any;
  const playerId = response.playerId;

  const choiceId = extractOptionChoiceSelectionId(response.selections);
  const copyStackItemId = stepData.retargetAbilityCopyStackItemId as string | undefined;
  if (!copyStackItemId) return;
  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'copyRetargetChoiceResolve', {
      playerId,
      sourceId: String(copyStackItemId || '').trim() || undefined,
      resolvedStepId: String(step.id || '').trim() || undefined,
      choiceId: String(choiceId || '').trim() || undefined,
      copyKind: 'ability',
    });
  } catch (err) {
    debugWarn(1, '[Resolution] appendEvent(copyRetargetChoiceResolve ability) failed:', err);
  }
  if (!choiceId || choiceId === 'keep') {
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const validTargets = Array.isArray(stepData.retargetAbilityCopyValidTargets) ? stepData.retargetAbilityCopyValidTargets : [];
  const minTargets = Number(stepData.retargetAbilityCopyMinTargets || 1);
  const maxTargets = Number(stepData.retargetAbilityCopyMaxTargets || 1);
  const targetDescription = String(stepData.retargetAbilityCopyTargetDescription || 'target');
  const targetTypes = Array.isArray(stepData.retargetAbilityCopyTargetTypes) ? stepData.retargetAbilityCopyTargetTypes : ['ability_target'];

  if (validTargets.length === 0) {
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    return;
  }

  const queuedResolutionStep = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId: playerId as PlayerID,
    description: `Choose ${targetDescription} for the copied ability`,
    mandatory: true,
    sourceId: copyStackItemId,
    sourceName: step.sourceName,
    validTargets,
    targetTypes,
    minTargets,
    maxTargets,
    targetDescription,
    priority: -1,
    retargetAbilityCopyTargetSelection: true,
    retargetAbilityCopyStackItemId: copyStackItemId,
  } as any);

  appendQueuedResolutionPromptEvent(game, gameId, {
    playerId,
    sourceId: String(copyStackItemId || '').trim(),
    queuedResolutionStep,
  });
}
