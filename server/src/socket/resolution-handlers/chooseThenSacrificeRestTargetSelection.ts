/**
 * socket/resolution-handlers/chooseThenSacrificeRestTargetSelection.ts
 *
 * TARGET_SELECTION for "chooses N [types] they control, then sacrifices the rest"
 * (Planetary Annihilation). Each prompted player names the permanents they keep.
 * When every chooser has answered, the other matching permanents are sacrificed
 * and any following Oracle IR steps (the 6 damage) resume.
 *
 * Public: handleChooseThenSacrificeRestTargetSelection
 * Must not import resolution.ts.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../../db/index.js';
import type { GameContext } from '../../state/context.js';
import { maybeResumeOracleIRStepsAfterResolution } from '../../state/modules/oracleIrServerZoneSync.js';
import {
  chooseThenSacrificeRestBatchComplete,
  clearChooseThenSacrificeRestBatch,
  getChooseThenSacrificeRestBatch,
  recordChooseThenSacrificeRestChoice,
  sacrificeUnkeptChooseThenSacrificeRest,
} from '../../state/modules/chooseThenSacrificeRestBatch.js';
import type { ResolutionStep, ResolutionStepResponse } from '../../state/resolution/index.js';
import { debugWarn } from '../../utils/debug.js';
import { broadcastGame, getPlayerName } from '../util.js';

export async function handleChooseThenSacrificeRestTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const stepAny = step as any;
  const playerId = String(response.playerId || step.playerId || '').trim();
  const selections = Array.isArray(response.selections)
    ? response.selections.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const batchId = String(stepAny.chooseThenSacrificeRestBatchId || '').trim();
  const batch = getChooseThenSacrificeRestBatch(game.state, batchId);
  if (!playerId || !batch) return;

  const minTargets = Number(stepAny.minTargets ?? 0);
  const maxTargets = Number(stepAny.maxTargets ?? minTargets);
  if (selections.length < minTargets || selections.length > maxTargets) return;

  const validIds = new Set(
    (Array.isArray(stepAny.validTargets) ? stepAny.validTargets : [])
      .map((target: any) => String(target?.id || '').trim())
      .filter(Boolean),
  );
  if (selections.some((id) => !validIds.has(id))) return;

  recordChooseThenSacrificeRestChoice(game.state, batchId, playerId, selections);

  const sourceId = String(stepAny.chooseThenSacrificeRestSourceId || step.sourceId || '').trim() || undefined;
  const sourceName = String(stepAny.chooseThenSacrificeRestSourceName || step.sourceName || 'Spell').trim() || 'Spell';
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const chosenNames = selections
    .map((id) => battlefield.find((permanent: any) => String(permanent?.id || '') === id))
    .map((permanent: any) => String(permanent?.card?.name || '').trim())
    .filter(Boolean);

  try {
    appendEvent(gameId, Number(game?.seq?.value ?? game?.seq ?? 0), 'chooseThenSacrificeRestChoiceResolve', {
      playerId,
      batchId,
      resolvedStepId: String(step.id || '').trim(),
      sourceId,
      sourceName,
      controller: batch.controller,
      keepTypes: batch.keepTypes,
      keepCount: batch.keepCount,
      upTo: batch.upTo,
      affectedPlayerIds: batch.affectedPlayerIds,
      expectedPlayerIds: batch.expectedPlayerIds,
      permanentIds: selections,
      resumeStepsJson: batch.resumeStepsJson,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist chooseThenSacrificeRestChoiceResolve event:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: chosenNames.length > 0
      ? `${getPlayerName(game, playerId)} keeps ${chosenNames.join(', ')} for ${sourceName}.`
      : `${getPlayerName(game, playerId)} keeps nothing for ${sourceName}.`,
    ts: Date.now(),
  });

  const updated = getChooseThenSacrificeRestBatch(game.state, batchId);
  if (!chooseThenSacrificeRestBatchComplete(updated)) {
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  const ctx = {
    state: game.state,
    libraries: game.libraries,
    bumpSeq: typeof game.bumpSeq === 'function' ? game.bumpSeq.bind(game) : () => {},
    rng: game.rng,
    gameId,
  } as unknown as GameContext;
  const sacrificedIds = sacrificeUnkeptChooseThenSacrificeRest(ctx, {
    keepTypes: updated!.keepTypes,
    affectedPlayerIds: updated!.affectedPlayerIds,
    choices: updated!.choices,
  });
  const resumeStepsJson = String(updated?.resumeStepsJson || stepAny.oracleIrResumeStepsJson || '').trim();
  clearChooseThenSacrificeRestBatch(game.state, batchId);

  try {
    appendEvent(gameId, Number(game?.seq?.value ?? game?.seq ?? 0), 'chooseThenSacrificeRestBatchResolve', {
      batchId,
      sourceId,
      sourceName,
      controller: updated?.controller,
      sacrificedIds,
      resumeStepsJson,
      oracleIrControllerId: updated?.oracleIrControllerId || updated?.controller,
      oracleIrSourceId: updated?.oracleIrSourceId || sourceId,
      oracleIrSourceName: updated?.oracleIrSourceName || sourceName,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist chooseThenSacrificeRestBatchResolve event:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}_rest`,
    gameId,
    from: 'system',
    message: sacrificedIds.length > 0
      ? `${sourceName} sacrifices the rest (${sacrificedIds.length}).`
      : `${sourceName} sacrifices nothing else.`,
    ts: Date.now(),
  });

  if (resumeStepsJson) {
    const resumeCtx = (game.ctx || game) as any;
    resumeCtx.gameId = gameId;
    resumeCtx.state = game.state;
    maybeResumeOracleIRStepsAfterResolution(resumeCtx, {
      ...stepAny,
      oracleIrResumeStepsJson: resumeStepsJson,
      oracleIrControllerId: updated?.oracleIrControllerId || updated?.controller,
      oracleIrSourceId: updated?.oracleIrSourceId || sourceId,
      oracleIrSourceName: updated?.oracleIrSourceName || sourceName,
    });
  }

  if (typeof game.bumpSeq === 'function') game.bumpSeq();
  broadcastGame(io, game, gameId);
}
