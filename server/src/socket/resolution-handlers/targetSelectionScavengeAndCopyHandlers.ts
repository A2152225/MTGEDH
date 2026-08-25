/**
 * socket/resolution-handlers/targetSelectionScavengeAndCopyHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two "apply the chosen creature target right now" branches -
 * `scavengeTargetSelection` (put N +1/+1 counters on the chosen creature, one persisted
 * counterTargetChosen event per counter) and the `self_become_copy_of_creature` /
 * `other_become_copy_of_creature` actions (the source, or a named permanent, becomes a copy of the
 * chosen creature).
 * Public entry symbols: handleScavengeTargetSelection, handleBecomeCopyOfCreatureTargetSelection.
 *
 * Both branches always returned, so each call site is `await handler(...); return;`. The copy branch
 * read `minTargets` from the top of the parent function; the leaf recomputes it from the step the
 * same way (`step.minTargets || 0`).
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import { updateCounters } from "../../state/modules/counters_tokens.js";
import { applyPermanentBecomeCopyOfTargetPermanent } from "../../state/modules/permanent-copy.js";
import type { ResolutionStep, ResolutionStepResponse } from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";

/** TARGET_SELECTION with `scavengeTargetSelection`: put the scavenged +1/+1 counters on the target. */
export async function handleScavengeTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const selectedTargetId = Array.isArray(selections)
    ? selections
        .map((entry: any) => {
          if (typeof entry === 'string') return String(entry || '').trim();
          if (entry && typeof entry === 'object') return String((entry as any).id || '').trim();
          return '';
        })
        .filter(Boolean)[0]
    : '';
  if (!selectedTargetId) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'Scavenge requires a target creature.',
    });
    return;
  }

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const targetPermanent = battlefield.find((permanent: any) => String(permanent?.id || '') === selectedTargetId) as any;
  if (!targetPermanent) {
    emitToPlayer(io, pid as any, 'error', {
      code: 'INVALID_TARGET',
      message: 'The chosen scavenge target is no longer on the battlefield.',
    });
    return;
  }

  const counterCount = Math.max(0, Number((step as any)?.counterCount || 0));
  if (counterCount > 0) {
    updateCounters(game as any, selectedTargetId, { '+1/+1': counterCount });
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${(step as any)?.cardName || step.sourceName || 'Scavenge'}: ${(targetPermanent?.card?.name || 'target creature')} gets ${counterCount} +1/+1 counter${counterCount === 1 ? '' : 's'}.`,
    ts: Date.now(),
  });

  for (let index = 0; index < counterCount; index += 1) {
    try {
      await appendEvent(gameId, (game as any).seq ?? 0, 'counterTargetChosen', {
        playerId: pid,
        sourceName: (step as any)?.cardName || step.sourceName,
        sourceId: String((step as any)?.cardId || step.sourceId || '').trim() || undefined,
        targetId: selectedTargetId,
        targetName: targetPermanent?.card?.name || 'Creature',
        counterType: '+1/+1',
        clearQueuedScavengePrompt: index === 0,
      });
    } catch (e) {
      debugWarn(1, '[Resolution] appendEvent(counterTargetChosen) failed for scavenge:', e);
    }
  }

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }

  broadcastGame(io, game, gameId);
}

/** TARGET_SELECTION for the self/other `become_copy_of_creature` actions. */
export async function handleBecomeCopyOfCreatureTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;
  const minTargets = (step as any).minTargets || 0;

  const sourceName = String(step.sourceName || stepAny?.cardName || 'Ability').trim() || 'Ability';
  const retainedAbilityText = String(stepAny?.retainedAbilityText || '').trim() || undefined;
  const selectedTargetId = String(selections?.[0] || '').trim();

  if (!selectedTargetId) {
    if (minTargets === 0) {
      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${getPlayerName(game, pid)} declined to copy for ${sourceName}.`,
        ts: Date.now(),
      });
      if (typeof game.bumpSeq === 'function') game.bumpSeq();
      broadcastGame(io, game, gameId);
    }
    return;
  }

  const copyOntoPermanentId = stepAny?.action === 'other_become_copy_of_creature'
    ? String(stepAny?.copyTargetPermanentId || stepAny?.selfBecomeCopySourcePermanentId || step.sourceId || '').trim()
    : String(stepAny?.selfBecomeCopySourcePermanentId || step.sourceId || '').trim();

  if (!copyOntoPermanentId) {
    debugWarn(1, '[Resolution] Copy target selection missing source permanent id');
    return;
  }

  const result = applyPermanentBecomeCopyOfTargetPermanent(
    game.state,
    copyOntoPermanentId,
    selectedTargetId,
    retainedAbilityText,
  );

  if (!result.applied) {
    emitToPlayer(io, pid as any, 'error', { code: 'COPY_FAILED', message: 'Could not apply copy effect' });
    return;
  }

  try {
    await appendEvent(gameId, (game as any).seq ?? 0, 'permanentBecomeCopyResolve', {
      playerId: pid,
      resolvedStepId: String(step.id || '').trim(),
      copyOntoPermanentId,
      copyFromPermanentId: selectedTargetId,
      sourceName,
      retainedAbilityText,
      targetName: result.targetName,
    });
  } catch (e) {
    debugWarn(1, '[Resolution] appendEvent(permanentBecomeCopyResolve) failed:', e);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)}: ${sourceName} became a copy of ${result.targetName || 'the chosen creature'}.`,
    ts: Date.now(),
  });

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
