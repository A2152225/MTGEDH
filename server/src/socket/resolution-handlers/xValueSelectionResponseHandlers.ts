/**
 * socket/resolution-handlers/xValueSelectionResponseHandlers.ts
 *
 * Origin parent: server/src/socket/resolution.ts (handleStepResponse switch).
 * Cluster moved: handleXValueSelectionResponse (spell-cast X, delayed
 * up-to-N draw, and Blight X activation-cost choose-X, then resume the
 * gated cast or enqueue blight TARGET_SELECTION).
 * Public entry symbols: handleXValueSelectionResponse.
 *
 * Terminal for the case: the original `break` becomes `return`.
 *
 * Wired through resolutionHandlerDeps. Must not import resolution.ts.
 */

import type { Server } from "socket.io";
import {
  ResolutionQueueManager,
  ResolutionStepType,
  type ResolutionStep,
  type ResolutionStepResponse,
} from "../../state/resolution/index.js";
import { debugWarn } from "../../utils/debug.js";
import { requestCastSpellForSocket } from "../game-actions.js";
import { broadcastGame, emitToPlayer, getPlayerName } from "../util.js";
import {
  applyDelayedDrawUpToChoice,
  isDelayedDrawUpToSelectionStep,
} from "../../state/modules/triggerDelayedDrawUpToUtils.js";
import { resumeOracleIRRemainingStepsFromResolution } from "../../state/modules/oracleIrServerZoneSync-handlers/oracleIrServerResumeAndChoiceApply.js";

/** X_VALUE_SELECTION: record chosen X for a spell cast, delayed up-to draw, or Blight X activation cost. */
export async function handleXValueSelectionResponse(
  io: Server,
  game: any,
  gameId: string,
  step: ResolutionStep,
  response: ResolutionStepResponse
): Promise<void> {
  const pid = response.playerId;
  const stepAny = step as any;

  let selectedXValue: number | null = null;
  const rawSelection: any = response.selections as any;
  if (typeof rawSelection === 'number') selectedXValue = rawSelection;
  else if (typeof rawSelection === 'string') selectedXValue = Number(rawSelection);
  else if (rawSelection && typeof rawSelection === 'object' && rawSelection.xValue != null) selectedXValue = Number(rawSelection.xValue);

  selectedXValue = Number.isFinite(selectedXValue) ? Math.max(0, Math.floor(selectedXValue as number)) : null;

  if (isDelayedDrawUpToSelectionStep(stepAny)) {
    applyDelayedDrawUpToChoice(game, stepAny, response.cancelled ? 0 : selectedXValue);
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (stepAny?.oracleIrChooseNumberChoice === true) {
    let choiceSteps: any[] = [];
    try {
      const parsed = JSON.parse(String(stepAny.oracleIrChoiceStepJson || '[]'));
      choiceSteps = Array.isArray(parsed) ? parsed : [];
    } catch {
      choiceSteps = [];
    }
    let remainingSteps: any[] = [];
    try {
      const parsed = JSON.parse(String(stepAny.oracleIrResumeStepsJson || '[]'));
      remainingSteps = Array.isArray(parsed) ? parsed : [];
    } catch {
      remainingSteps = [];
    }
    if (response.cancelled) return;
    const minValue = Math.max(0, Math.floor(Number(stepAny.minValue ?? 0)));
    const maxValue = Math.max(minValue, Math.floor(Number(stepAny.maxValue ?? minValue)));
    const chosen = selectedXValue == null
      ? null
      : Math.max(minValue, Math.min(maxValue, selectedXValue));
    if (chosen == null) {
      debugWarn(1, `[Resolution] Choose number: invalid selection: ${JSON.stringify(response.selections)}`);
      return;
    }
    resumeOracleIRRemainingStepsFromResolution(game, {
      controller: String(stepAny.oracleIrControllerId || pid).trim(),
      sourceId: String(stepAny.oracleIrSourceId || stepAny.sourceId || '').trim() || undefined,
      sourceName: String(stepAny.oracleIrSourceName || stepAny.sourceName || '').trim() || undefined,
      steps: [...choiceSteps, ...remainingSteps],
      selectorContext: { chosenNumber: chosen },
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (stepAny?.oracleIrPayEnergyChoice === true) {
    let paySteps: any[] = [];
    try {
      const parsed = JSON.parse(String(stepAny.oracleIrChoiceStepJson || '[]'));
      paySteps = Array.isArray(parsed) ? parsed : [];
    } catch {
      paySteps = [];
    }
    let remainingSteps: any[] = [];
    try {
      const parsed = JSON.parse(String(stepAny.oracleIrResumeStepsJson || '[]'));
      remainingSteps = Array.isArray(parsed) ? parsed : [];
    } catch {
      remainingSteps = [];
    }
    const paid = response.cancelled ? 0 : (selectedXValue ?? 0);
    resumeOracleIRRemainingStepsFromResolution(game, {
      controller: String(stepAny.oracleIrControllerId || pid).trim(),
      sourceId: String(stepAny.oracleIrSourceId || stepAny.sourceId || '').trim() || undefined,
      sourceName: String(stepAny.oracleIrSourceName || stepAny.sourceName || '').trim() || undefined,
      steps: [...paySteps, ...remainingSteps],
      energyPaidThisWay: paid,
    });
    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  if (stepAny?.spellCastXSelection === true) {
    if (response.cancelled) {
      return;
    }

    if (selectedXValue == null) {
      debugWarn(1, `[Resolution] Spell cast X selection: invalid xValue selection: ${JSON.stringify(response.selections)}`);
      return;
    }

    await requestCastSpellForSocket(
      io,
      {
        data: { playerId: pid },
        emit: (_event: string, _payload: any) => {},
      } as any,
      {
        gameId,
        cardId: stepAny?.spellCardId,
        faceIndex: stepAny?.spellFaceIndex,
        fromZone: stepAny?.spellFromZone,
      },
      {
        skipPriorityCheck: true,
        forcedAlternateCostId: typeof stepAny?.spellForcedAlternateCostId === 'string' ? stepAny.spellForcedAlternateCostId : undefined,
        castWithoutPayingManaCost: stepAny?.spellCastWithoutPayingManaCost === true,
        bypassExilePermissionCheck: stepAny?.spellBypassExilePermissionCheck === true,
        ignoreTimingRestrictions: stepAny?.spellIgnoreTimingRestrictions === true,
        xValue: selectedXValue,
      },
    );

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }

  // Currently only used for deterministic Blight X activation costs.
  if (stepAny?.keywordBlight === true && String(stepAny?.keywordBlightStage || '') === 'ability_activation_cost_choose_x') {
    const controllerId = String(stepAny?.keywordBlightController || pid);
    const activationId = String(stepAny?.keywordBlightActivationId || '').trim();
    const sourceName = String(stepAny?.keywordBlightSourceName || step.sourceName || 'Blight X');

    if (!activationId) {
      debugWarn(1, `[Resolution] Blight X: missing activation id`);
      return;
    }

    if (response.cancelled) {
      try {
        if ((game.state as any)?.pendingBlightAbilityActivations?.[activationId]) {
          delete (game.state as any).pendingBlightAbilityActivations[activationId];
        }
      } catch {
        // best-effort only
      }

      io.to(gameId).emit('chat', {
        id: `m_${Date.now()}`,
        gameId,
        from: 'system',
        message: `${sourceName}: ${getPlayerName(game, controllerId)} cancelled the activation.`,
        ts: Date.now(),
      });
      return;
    }

    const xValue = selectedXValue;
    if (xValue == null) {
      debugWarn(1, `[Resolution] Blight X: invalid xValue selection: ${JSON.stringify(response.selections)}`);
      return;
    }

    const pending = (game.state as any)?.pendingBlightAbilityActivations?.[activationId];
    if (!pending) {
      debugWarn(1, `[Resolution] Blight X: pending activation not found (${activationId})`);
      return;
    }

    const battlefield = Array.isArray(game.state?.battlefield) ? game.state.battlefield : [];
    const validTargets = battlefield
      .filter((p: any) => p && String(p.controller || '') === controllerId)
      .filter((p: any) => String(p.card?.type_line || '').toLowerCase().includes('creature'))
      .map((p: any) => ({
        id: p.id,
        label: p.card?.name || 'Creature',
        description: p.card?.type_line || 'creature',
        imageUrl: p.card?.image_uris?.small || p.card?.image_uris?.normal,
      }));

    if (validTargets.length === 0) {
      emitToPlayer(io, controllerId, 'error', {
        code: 'NO_VALID_TARGETS',
        message: `Cannot pay Blight ${xValue} (you control no creatures).`,
      });
      return;
    }

    // Enqueue the actual blight target selection step (handled by handleTargetSelectionResponse).
    ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: controllerId as any,
      description: `${String(pending.cardName || step.sourceName || 'Ability')}: Blight ${xValue} — Choose a creature you control to put ${xValue} -1/-1 counter${xValue === 1 ? '' : 's'} on it (cancel to abort activation).`,
      mandatory: false,
      sourceId: String(pending.permanentId || step.sourceId || ''),
      sourceName: String(pending.cardName || step.sourceName || 'Ability'),
      sourceImage: stepAny?.sourceImage,
      validTargets,
      targetTypes: ['creature'],
      minTargets: 1,
      maxTargets: 1,
      targetDescription: 'creature you control',

      keywordBlight: true,
      keywordBlightStage: 'ability_activation_cost',
      keywordBlightController: controllerId,
      keywordBlightN: xValue,
      keywordBlightSourceName: `${String(pending.cardName || step.sourceName || 'Ability')} — Blight ${xValue}`,
      keywordBlightActivationId: activationId,
    } as any);

    if (typeof (game as any).bumpSeq === 'function') (game as any).bumpSeq();
    broadcastGame(io, game, gameId);
    return;
  }
}
