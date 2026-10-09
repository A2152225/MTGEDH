/**
 * socket/resolutionSecretEachPlayerNumberResponseHandlers.ts
 *
 * Origin parent: resolutionCascadeDanceDevourSuspendMorphResponseHandlers.ts
 * Cluster: secret each-player number X_VALUE_SELECTION responses.
 * Public: handleSecretEachPlayerNumberChoiceResponse
 * Must not import resolution.ts.
 */

import type { Server } from 'socket.io';
import { appendEvent } from '../db/index.js';
import type { GameContext } from '../state/context.js';
import {
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from '../state/resolution/index.js';
import { debugWarn } from '../utils/debug.js';
import { getPlayerName } from './util.js';
import {
  applySecretEachPlayerNumberBatchResult,
  clearSecretEachPlayerNumberBatch,
  recordSecretEachPlayerNumberChoice,
} from '../state/modules/secretEachPlayerNumberBatch.js';

function readChosenNumber(response: ResolutionStepResponse): number | null {
  const rawSelection: any = response.selections as any;
  let selected: number | null = null;
  if (typeof rawSelection === 'number') selected = rawSelection;
  else if (typeof rawSelection === 'string') selected = Number(rawSelection);
  else if (rawSelection && typeof rawSelection === 'object') {
    if (rawSelection.xValue != null) selected = Number(rawSelection.xValue);
    else if (rawSelection.value != null) selected = Number(rawSelection.value);
    else if (rawSelection.number != null) selected = Number(rawSelection.number);
  }
  if (!Number.isFinite(selected)) return null;
  return Math.max(0, Math.floor(selected as number));
}

export async function handleSecretEachPlayerNumberChoiceResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): Promise<void> {
  const pid = String(response.playerId || '').trim();
  const stepAny = step as any;
  const minNumber = Math.max(0, Math.floor(Number(stepAny?.secretEachPlayerNumberMin ?? stepAny?.minValue ?? 0)));
  const maxNumber = Math.max(minNumber, Math.floor(Number(stepAny?.maxValue ?? 999)));
  const chosenRaw = readChosenNumber(response);
  const chosen = chosenRaw == null ? null : Math.max(minNumber, Math.min(maxNumber, chosenRaw));
  if (!pid || chosen == null) {
    debugWarn(1, `[Resolution] Invalid secret number choice: player=${pid} selection=${JSON.stringify(response.selections)}`);
    return;
  }

  const batchId = String(stepAny?.secretEachPlayerNumberBatchId || `${String(stepAny?.secretEachPlayerNumberSourceId || step.sourceId || '').trim()}:secret_each_player_number`).trim();
  const sourceId = String(stepAny?.secretEachPlayerNumberSourceId || step.sourceId || '').trim() || undefined;
  const sourceName = String(stepAny?.secretEachPlayerNumberSourceName || step.sourceName || 'Spell').trim() || 'Spell';
  const controllerId = String(stepAny?.secretEachPlayerNumberController || '').trim() || undefined;
  const drawCount = Math.max(0, Math.floor(Number(stepAny?.secretEachPlayerNumberDrawCount || 0)));
  const expectedPlayerIds = Array.isArray(stepAny?.secretEachPlayerNumberExpectedPlayerIds)
    ? stepAny.secretEachPlayerNumberExpectedPlayerIds.map((value: any) => String(value || '').trim()).filter(Boolean)
    : [];

  const batch = recordSecretEachPlayerNumberChoice(game.state, batchId, {
    playerId: pid,
    number: chosen,
    controller: controllerId,
    sourceId,
    sourceName,
    expectedPlayerIds,
    drawCount,
    minNumber,
  });

  try {
    await appendEvent(gameId, Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0), 'secretEachPlayerNumberChoiceResolve', {
      playerId: pid,
      batchId,
      resolvedStepId: String(step.id || '').trim(),
      sourceId,
      sourceName,
      number: chosen,
      expectedPlayerIds,
      drawCount,
      minNumber,
    });
  } catch (err) {
    debugWarn(1, '[Resolution] Failed to persist secretEachPlayerNumberChoiceResolve event:', err);
  }

  io.to(gameId).emit('chat', {
    id: `m_${Date.now()}`,
    gameId,
    from: 'system',
    message: `${getPlayerName(game, pid)} makes a secret choice for ${sourceName}.`,
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
  const batchComplete = finalExpectedPlayerIds.length > 0
    && finalExpectedPlayerIds.every((playerId: string) => Number.isFinite(Number(batchChoices[playerId])));

  if (batchComplete) {
    const finalChoices = Object.fromEntries(
      finalExpectedPlayerIds.map((playerId: string) => [playerId, Math.floor(Number(batchChoices[playerId]))]),
    ) as Record<string, number>;
    const ctx = {
      state: game.state,
      libraries: (game as any).libraries,
      bumpSeq: typeof (game as any).bumpSeq === 'function' ? (game as any).bumpSeq.bind(game) : (() => {}),
      rng: (game as any).rng,
      gameId,
    } as unknown as GameContext;
    const result = applySecretEachPlayerNumberBatchResult(ctx, {
      expectedPlayerIds: finalExpectedPlayerIds,
      choices: finalChoices,
      drawCount,
    });
    clearSecretEachPlayerNumberBatch(game.state, batchId);

    try {
      await appendEvent(gameId, Number((game as any)?.seq?.value ?? (game as any)?.seq ?? 0), 'secretEachPlayerNumberBatchResolve', {
        batchId,
        sourceId,
        sourceName,
        expectedPlayerIds: finalExpectedPlayerIds,
        choices: finalChoices,
        drawCount,
        damageByPlayerId: result.damageByPlayerId,
        wheeledPlayerIds: result.wheeledPlayerIds,
      });
    } catch (err) {
      debugWarn(1, '[Resolution] Failed to persist secretEachPlayerNumberBatchResolve event:', err);
    }

    const choiceSummary = finalExpectedPlayerIds
      .map((playerId: string) => `${getPlayerName(game, playerId)}: ${finalChoices[playerId]}`)
      .join(', ');
    const damageSummary = Object.entries(result.damageByPlayerId)
      .map(([playerId, damageAmount]) => `${damageAmount} to ${getPlayerName(game, playerId)}`)
      .join(', ');
    const wheelSummary = result.wheeledPlayerIds.length > 0
      ? `${result.wheeledPlayerIds.map((playerId) => getPlayerName(game, playerId)).join(', ')} discard and draw ${drawCount}`
      : 'nobody discards';
    io.to(gameId).emit('chat', {
      id: `m_${Date.now()}_reveal`,
      gameId,
      from: 'system',
      message: `${sourceName} numbers are revealed (${choiceSummary}). ${damageSummary ? `Deals ${damageSummary}. ` : 'Deals no damage. '}${wheelSummary}.`,
      ts: Date.now(),
    });
  }

  if (typeof (game as any).bumpSeq === 'function') {
    (game as any).bumpSeq();
  }
}

export function isSecretEachPlayerNumberStep(step: ResolutionStep): boolean {
  return (step.type === ResolutionStepType.X_VALUE_SELECTION || step.type === ResolutionStepType.NUMBER_CHOICE)
    && (step as any)?.secretEachPlayerNumberChoice === true;
}
