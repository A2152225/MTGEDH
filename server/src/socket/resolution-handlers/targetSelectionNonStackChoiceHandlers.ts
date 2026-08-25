/**
 * socket/resolution-handlers/targetSelectionNonStackChoiceHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: three TARGET_SELECTION branches whose selections are not stack targets and are
 * applied on the spot - `divineReckoningChoice` (record each player's survivor, and once the batch is
 * complete destroy everything else), `sacrificeSelection` (Grave Pact / Dictate of Erebos style
 * "sacrifice a permanent of this type") and `opponentSelection` (Secret Rendezvous style, which just
 * parks the chosen opponents on state for a later effect).
 * Public entry symbols: handleDivineReckoningChoiceTargetSelection,
 * handleSacrificeSelectionTargetSelection, handleOpponentSelectionTargetSelection.
 *
 * Every branch always returned, so each call site is `await handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import { appendEvent } from "../../db/index.js";
import type { GameContext } from "../../state/context.js";
import {
  applyDivineReckoningBatchResult,
  clearDivineReckoningChoiceBatch,
  recordDivineReckoningChoice,
} from "../../state/modules/spellLegacyChoiceBatchUtils.js";
import type {
  ResolutionStep,
  ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debug, debugWarn } from "../../utils/debug.js";
import { broadcastGame, getPlayerName } from "../util.js";

/** Divine Reckoning style "each player chooses a creature to keep". */
export async function handleDivineReckoningChoiceTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const selectedPermanentId = String(selections[0] || '').trim();
  if (!selectedPermanentId) {
    return;
  }

  const batchId = String(stepAny?.divineReckoningBatchId || `${String(stepAny?.divineReckoningSourceId || step.sourceId || '').trim()}:divine_reckoning`).trim();
  const sourceId = String(stepAny?.divineReckoningSourceId || step.sourceId || '').trim() || undefined;
  const sourceName = String(stepAny?.divineReckoningSourceName || step.sourceName || 'Divine Reckoning').trim() || 'Divine Reckoning';
  const controllerId = String(stepAny?.divineReckoningController || '').trim() || undefined;
  const expectedPlayerIds = Array.isArray(stepAny?.divineReckoningExpectedPlayerIds)
    ? stepAny.divineReckoningExpectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];
  const batch = recordDivineReckoningChoice(game.state, batchId, {
    playerId: String(pid || '').trim(),
    permanentId: selectedPermanentId,
    controller: controllerId,
    sourceId,
    sourceName,
    expectedPlayerIds,
  });

  try {
    await appendEvent(gameId, Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0), 'divineReckoningChoiceResolve', {
      playerId: String(pid || '').trim(),
      batchId,
      resolvedStepId: String(step.id || '').trim(),
      sourceId,
      sourceName,
      selectedPermanentId,
      expectedPlayerIds,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist divineReckoningChoiceResolve event:', err);
  }

  const battlefield = Array.isArray((game.state as any)?.battlefield) ? (game.state as any).battlefield : [];
  const chosenPermanent = battlefield.find((permanent: any) => permanent && String(permanent.id || '') === selectedPermanentId);
  const chosenName = String(chosenPermanent?.card?.name || 'a creature');

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} chooses ${chosenName} for ${sourceName}.`,
    ts: Date.now(),
  });

  const batchChoices = batch?.choices && typeof batch.choices === 'object' && !Array.isArray(batch.choices)
    ? batch.choices
    : {};
  const finalExpectedPlayerIds = expectedPlayerIds.length > 0
    ? expectedPlayerIds
    : Array.isArray(batch?.expectedPlayerIds)
      ? batch.expectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
      : [];
  const survivorIds = finalExpectedPlayerIds
    .map((playerId: string) => String(batchChoices[playerId] || '').trim())
    .filter(Boolean);
  const batchComplete = finalExpectedPlayerIds.length > 0
    ? finalExpectedPlayerIds.every((playerId: string) => Boolean(String(batchChoices[playerId] || '').trim()))
    : survivorIds.length > 0;

  if (batchComplete) {
    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as unknown as GameContext;
    const result = applyDivineReckoningBatchResult(ctx, survivorIds);
    clearDivineReckoningChoiceBatch(game.state, batchId);

    try {
      await appendEvent(gameId, Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0), 'divineReckoningBatchResolve', {
        batchId,
        sourceId,
        sourceName,
        survivorIds: result.survivorIds,
        destroyedIds: result.destroyedIds,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist divineReckoningBatchResolve event:', err);
    }

    const survivorNames = result.survivorIds
      .map((permanentId) => {
        const permanent = battlefield.find((entry: any) => entry && String(entry.id || '') === permanentId);
        return String(permanent?.card?.name || '').trim();
      })
      .filter(Boolean);
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}`,
      gameId,
      from: 'system',
      message: survivorNames.length > 0
        ? `${sourceName} destroys every other creature. Survivors: ${survivorNames.join(', ')}.`
        : `${sourceName} destroys every creature.`,
      ts: Date.now(),
    });
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
  broadcastGame(io, game, gameId);
}

/** Sacrifice selection (Grave Pact / Dictate of Erebos variants, etc.). */
export async function handleSacrificeSelectionTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const permanentType = String(stepAny?.sacrificePermanentType || 'permanent');
  const sourceName = String(stepAny?.sacrificeSourceName || step.sourceName || 'Effect');
  const reason = String(stepAny?.sacrificeReason || step.description || '').trim();
  const resolvedStepId = String(step?.id || '').trim();

  const ctx = {
    state: game.state,
    libraries: (game as any).libraries,
    bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
    rng: (game as any).rng,
    gameId,
  } as unknown as GameContext;

  const { movePermanentToGraveyard } = await import('../../state/modules/counters_tokens.js');

  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const sacrificedNames: string[] = [];
  const sacrificedPermanentIds: string[] = [];

  for (const permanentId of selections) {
    const perm = battlefield.find((p: any) => p && String(p.id) === String(permanentId));
    if (!perm || String(perm.controller || '') !== String(pid)) {
      debugWarn(1, `[Resolution] sacrificeSelection invalid permanent/controller: ${permanentId}`);
      continue;
    }

    const typeLine = String(perm.card?.type_line || '').toLowerCase();
    if (permanentType !== 'permanent' && !typeLine.includes(permanentType)) {
      debugWarn(1, `[Resolution] sacrificeSelection type mismatch (${permanentType}): ${permanentId}`);
      continue;
    }

    const name = String(perm.card?.name || 'permanent');
    const ok = movePermanentToGraveyard(ctx, String(permanentId), true);
    if (ok) {
      sacrificedNames.push(name);
      sacrificedPermanentIds.push(String(permanentId));
    }
  }

  try {
    appendEvent(gameId, (game as any).seq ?? 0, 'sacrificeSelectionResolve', {
      resolvedStepId,
      playerId: pid,
      sourceId: String(step?.sourceId || '').trim(),
      sourceName,
      permanentType,
      permanentIds: sacrificedPermanentIds,
      reason,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist sacrificeSelectionResolve:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} sacrifices ${sacrificedNames.join(', ') || 'permanents'}${sourceName ? ` (${sourceName})` : ''}${reason ? `: ${reason}` : ''}.`,
    ts: Date.now(),
  });
  broadcastGame(io, game, gameId);
}

/** Opponent selection (Secret Rendezvous, etc.); stores the choice for a later effect. */
export function handleOpponentSelectionTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];
  const stepAny = step as any;

  const effectId = String(stepAny?.effectId || step.sourceId || '').trim();
  if (!effectId) {
    debugWarn(1, `[Resolution] Opponent selection step missing effectId/sourceId`);
    return;
  }

  (game.state as any).pendingOpponentSelections = (game.state as any).pendingOpponentSelections || {};
  (game.state as any).pendingOpponentSelections[effectId] = {
    selectedOpponentIds: selections,
    playerId: pid,
    timestamp: Date.now(),
  };

  debug(1, `[Resolution] Opponent selection stored for ${effectId}: ${selections.join(', ') || '(none)'}`);

  if (typeof game.bumpSeq === 'function') {
    game.bumpSeq();
  }
  broadcastGame(io, game, gameId);
}
