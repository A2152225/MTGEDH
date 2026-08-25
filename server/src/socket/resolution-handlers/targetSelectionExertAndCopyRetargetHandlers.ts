/**
 * socket/resolution-handlers/targetSelectionExertAndCopyRetargetHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the three "the chosen targets belong to something already on (or heading to) the
 * stack" branches - `exertTargetChoice` (push the exert reward ability with its targets),
 * `retargetAbilityCopyTargetSelection` (rewrite a copied ability's targets, including the equip and
 * reconfigure params that carry their own target creature) and `retargetSpellCopyTargetSelection`
 * (rewrite a copied spell's targets).
 * Public entry symbols: handleExertTargetChoiceTargetSelection,
 * handleRetargetAbilityCopyTargetSelection, handleRetargetSpellCopyTargetSelection.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { pushExertTriggeredAbilityOntoStack } from "../resolutionKeywordChoiceHandlers.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** Exert reward target choice: push the reward ability with the chosen targets. */
export function handleExertTargetChoiceTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const attackerId = String(stepAny?.exertAttackerId || step.sourceId || '').trim();
  const rewardDescription = String(stepAny?.exertRewardDescription || '').trim();
  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const attacker = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === attackerId)
    || stepAny?.sourcePermanentSnapshot
    || null;
  if (!attacker || !rewardDescription) {
    return;
  }

  pushExertTriggeredAbilityOntoStack(
    game,
    gameId,
    attacker,
    String(pid),
    rewardDescription,
    selections.map((value: any) => String(value)).filter(Boolean),
  );

  const targetName = Array.isArray(stepAny?.validTargets)
    ? String(stepAny.validTargets.find((entry: any) => String(entry?.id || '') === String(selections[0] || ''))?.label || 'the chosen target')
    : 'the chosen target';
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} chooses ${targetName} for ${String(step.sourceName || attacker?.card?.name || 'Exert')}.`,
    ts: Date.now(),
  });

  broadcastGame(io, game, gameId);
}

/** New targets for a copied activated/triggered ability on the stack. */
export async function handleRetargetAbilityCopyTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const copyStackItemId = String(stepAny?.retargetAbilityCopyStackItemId || step.sourceId || '').trim();
  if (!copyStackItemId) {
    return;
  }

  const stack = Array.isArray(game.state?.stack) ? game.state.stack : [];
  const copiedItem = stack.find((item: any) => item && String(item.id || '') === copyStackItemId);
  if (!copiedItem) {
    emitToPlayer(io, pid as any, 'error', { code: 'STACK_ITEM_NOT_FOUND', message: 'Copied ability is no longer on the stack.' });
    return;
  }

  copiedItem.targets = selections.map((value: any) => String(value)).filter(Boolean);
  if (String((copiedItem as any).abilityType || '') === 'equip' && (copiedItem as any).equipParams) {
    const nextTargetId = String(copiedItem.targets[0] || '').trim();
    const validTarget = Array.isArray((copiedItem as any).copyRetargetValidTargets)
      ? (copiedItem as any).copyRetargetValidTargets.find((target: any) => String(target?.id || '') === nextTargetId)
      : null;
    (copiedItem as any).equipParams = {
      ...((copiedItem as any).equipParams || {}),
      targetCreatureId: nextTargetId,
      targetCreatureName: String(validTarget?.name || (copiedItem as any).equipParams?.targetCreatureName || 'Creature'),
    };
  } else if (String((copiedItem as any).abilityType || '') === 'reconfigure_attach' && (copiedItem as any).reconfigureParams) {
    const nextTargetId = String(copiedItem.targets[0] || '').trim();
    const validTarget = Array.isArray((copiedItem as any).copyRetargetValidTargets)
      ? (copiedItem as any).copyRetargetValidTargets.find((target: any) => String(target?.id || '') === nextTargetId)
      : null;
    (copiedItem as any).reconfigureParams = {
      ...((copiedItem as any).reconfigureParams || {}),
      targetCreatureId: nextTargetId,
      targetCreatureName: String(validTarget?.name || (copiedItem as any).reconfigureParams?.targetCreatureName || 'Creature'),
    };
  }
  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${String(step.sourceName || 'Copied ability')} gets new target${copiedItem.targets.length === 1 ? '' : 's'}.`,
    ts: Date.now(),
  });

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'retargetAbilityCopyResolve', {
      playerId: pid,
      stackItemId: copyStackItemId,
      targets: copiedItem.targets,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist retargetAbilityCopyResolve event:', err);
  }

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}

/** New targets for a copied spell on the stack. */
export async function handleRetargetSpellCopyTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const copyStackItemId = String(stepAny?.retargetSpellCopyStackItemId || step.sourceId || '').trim();
  if (!copyStackItemId) {
    return;
  }

  const stack = Array.isArray(game.state?.stack) ? game.state.stack : [];
  const copiedItem = stack.find((item: any) => item && String(item.id || '') === copyStackItemId);
  if (!copiedItem) {
    emitToPlayer(io, pid as any, 'error', { code: 'STACK_ITEM_NOT_FOUND', message: 'Copied spell is no longer on the stack.' });
    return;
  }

  copiedItem.targets = selections.map((value: any) => String(value)).filter(Boolean);

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${String(step.sourceName || 'Copied spell')} gets new target${copiedItem.targets.length === 1 ? '' : 's'}.`,
    ts: Date.now(),
  });

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'retargetSpellCopyResolve', {
      playerId: pid,
      stackItemId: copyStackItemId,
      targets: copiedItem.targets,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist retargetSpellCopyResolve event:', err);
  }

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
