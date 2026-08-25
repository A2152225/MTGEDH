/**
 * socket/resolution-handlers/targetSelectionOracleIrPromptHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleTargetSelectionResponse).
 * Cluster moved: the two Oracle IR prompts answered through a TARGET_SELECTION step, both of which
 * sit ahead of the generic target validation - `oracleIrAnyPlayerMayPaymentSelection` (an
 * "any player may <pay>" prompt, where cancelling is a real answer) and
 * `oracleIrLibraryChaosTargetSelection` (one target per controller in turn; each answer either
 * queues the next controller's prompt or runs the exchange and queues its cast offers).
 * Public entry symbols: handleOracleIrAnyPlayerMayPaymentSelection,
 * handleOracleIrLibraryChaosTargetSelection.
 *
 * Both branches always returned, so each call site is `handler(...); return;`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import {
  executeLibraryChaosExchange,
  permanentMatchesLibraryChaosTarget,
  queueLibraryChaosCastOffers,
  type LibraryChaosExchangeStep,
} from "../../state/modules/oracleIrLibraryChaosExchange.js";
import { resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution } from "../../state/modules/oracleIrServerZoneSync.js";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { appendQueuedResolutionPromptEvent } from "../resolutionCloneQueuedPromptUtils.js";
import { broadcastGame } from "../util.js";

/** Oracle IR "any player may pay" prompt answered through a TARGET_SELECTION step. */
export function handleOracleIrAnyPlayerMayPaymentSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const selections = response.selections as string[];

  if (response.cancelled) {
    const ctx = ((game as any).ctx || game) as any;
    ctx.gameId = gameId;
    ctx.state = game.state;
    resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(ctx, step, {
      cancelled: true,
      selections: [],
    });
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }
  if (!Array.isArray(selections) || selections.length === 0) {
    debugWarn(1, `[Resolution] Invalid any-player-may sacrifice selections`);
    return;
  }
  const ctx = ((game as any).ctx || game) as any;
  ctx.gameId = gameId;
  ctx.state = game.state;
  const handled = resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(ctx, step, response);
  if (handled) {
    if (typeof game.bumpSeq === 'function') game.bumpSeq();
    broadcastGame(io, game, gameId);
  }
}

/** Oracle IR library-chaos exchange: one target per controller, in order. */
export function handleOracleIrLibraryChaosTargetSelection(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse,
): void {
  const pid = response.playerId;
  const selections = response.selections as string[];

  const stepData = step as any;
  const selectedId = String(selections[0] || '').trim();
  const targetControllers = (Array.isArray(stepData.oracleIrLibraryChaosTargetControllers)
    ? stepData.oracleIrLibraryChaosTargetControllers
    : [])
    .map((id: any) => String(id || '').trim())
    .filter(Boolean);
  const currentIndex = Math.max(0, Number(stepData.oracleIrLibraryChaosTargetIndex) || 0);
  const expectedController = String(targetControllers[currentIndex] || '').trim();
  const parsedStep = JSON.parse(String(stepData.oracleIrLibraryChaosStepJson || '{}')) as LibraryChaosExchangeStep;
  const targetText = String((parsedStep.target as any)?.text || (parsedStep.target as any)?.raw || '');
  const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
  const selectedPermanent = battlefield.find((permanent: any) =>
    String(permanent?.id || '') === selectedId
    && String(permanent?.controller || '') === expectedController
    && permanentMatchesLibraryChaosTarget(permanent, targetText),
  );
  if (!selectedPermanent) {
    debugWarn(1, '[Resolution] Library chaos exchange target is no longer legal');
    return;
  }

  const selectedIds = [
    ...(Array.isArray(stepData.oracleIrLibraryChaosSelectedIds)
      ? stepData.oracleIrLibraryChaosSelectedIds
      : []),
    selectedId,
  ];
  const nextIndex = currentIndex + 1;
  if (nextIndex < targetControllers.length) {
    const nextController = targetControllers[nextIndex];
    const nextValidTargets = battlefield
      .filter((permanent: any) =>
        String(permanent?.controller || '') === nextController
        && permanentMatchesLibraryChaosTarget(permanent, targetText),
      )
      .map((permanent: any) => ({
        id: String(permanent?.id || ''),
        label: String(permanent?.card?.name || permanent?.id || 'Permanent'),
        description: String(permanent?.card?.type_line || 'permanent'),
        imageUrl: permanent?.card?.image_uris?.normal || permanent?.card?.image_uris?.small,
        controller: nextController,
      }));
    const nextStep = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: pid,
      description: `${String(stepData.sourceName || 'Ability')}: Choose a ${targetText} controlled by ${nextController}`,
      mandatory: true,
      sourceId: stepData.sourceId,
      sourceName: stepData.sourceName,
      validTargets: nextValidTargets,
      targetTypes: ['permanent'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: targetText,
      oracleIrLibraryChaosTargetSelection: true,
      oracleIrLibraryChaosStepJson: stepData.oracleIrLibraryChaosStepJson,
      oracleIrLibraryChaosTargetControllers: targetControllers,
      oracleIrLibraryChaosTargetIndex: nextIndex,
      oracleIrLibraryChaosSelectedIds: selectedIds,
      oracleIrControllerId: stepData.oracleIrControllerId,
      oracleIrSourceId: stepData.oracleIrSourceId,
      oracleIrSourceName: stepData.oracleIrSourceName,
    } as any);
    appendQueuedResolutionPromptEvent(game, gameId, {
      playerId: String(pid),
      sourceId: String(stepData.sourceId || '').trim(),
      queuedResolutionStep: nextStep,
    });
    broadcastGame(io, game, gameId);
    return;
  }

  const ctx = ((game as any).ctx || game) as any;
  ctx.gameId = gameId;
  ctx.state = game.state;
  const execution = executeLibraryChaosExchange(ctx, parsedStep, selectedIds, {
    sourceId: String(stepData.sourceId || '').trim() || undefined,
    sourceName: String(stepData.sourceName || 'Ability'),
    resolvedStepId: String(stepData.id || ''),
  });
  queueLibraryChaosCastOffers(ctx, execution.castOffers, {
    sourceId: String(stepData.sourceId || '').trim() || undefined,
    sourceName: String(stepData.sourceName || 'Ability'),
  });
  game.state = ctx.state;
  broadcastGame(io, game, gameId);
}
