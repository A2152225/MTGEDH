// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerAnyPlayerMayPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: any-player-may payment parse/queue/resume helpers and
//   resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution.
// Public entry symbols: parseAnyPlayerMayPaymentJson,
//   resumeAnyPlayerMayAfterChoice, maybeQueueAnyPlayerMayPaymentSelection,
//   resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution.
// Called from optional-payment resume still in the parent.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import { buildOracleIRExecutionContext } from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { buildSacrificeTargetSelectionOptions } from '../../../../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import { collectDiscardSelectionOptionsForStep } from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { type AnyPlayerMayPayment } from '../../../../../rules-engine/src/oracleIRAnyPlayerMay.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import { resumeOracleIRRemainingStepsFromResolution } from './oracleIrServerResumeAndChoiceApply.js';
import { hydrateOracleIRPlayerZonesFromContext } from './oracleIrServerZoneHydrateDelayedBridges.js';

export function parseAnyPlayerMayPaymentJson(raw: unknown): AnyPlayerMayPayment | null {
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (!parsed || typeof parsed !== 'object') return null;
    const kind = String((parsed as any).kind || '').trim();
    if (kind === 'life') {
      const amount = Number((parsed as any).amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return { kind: 'life', amount };
    }
    if (kind === 'half_life_rounded_up') return { kind: 'half_life_rounded_up' };
    if (kind === 'discard') {
      const amount = Number((parsed as any).amount);
      if (!Number.isFinite(amount) || amount <= 0) return null;
      return { kind: 'discard', amount };
    }
    if (kind === 'sacrifice') {
      const what = String((parsed as any).what || 'a creature').trim() || 'a creature';
      return { kind: 'sacrifice', what };
    }
  } catch {
    return null;
  }
  return null;
}

function buildAnyPlayerMayPaymentSelectionBase(
  stepData: any,
  playerId: PlayerID,
): {
  controller: PlayerID;
  sourceId?: string;
  sourceName?: string;
  targetSpellId?: string;
  anySteps: OracleEffectStep[];
  declined: string[];
  candidates: string[];
  payment: AnyPlayerMayPayment | null;
} {
  let anySteps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(String(stepData.oracleIrAnyPlayerMayStepsJson || '[]'));
    anySteps = Array.isArray(parsed) ? parsed as OracleEffectStep[] : [];
  } catch {
    anySteps = [];
  }
  const declined = Array.isArray(stepData.oracleIrAnyPlayerMayDeclinedIds)
    ? [...(stepData.oracleIrAnyPlayerMayDeclinedIds as string[])].map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const candidates = Array.isArray(stepData.oracleIrAnyPlayerMayCandidateIds)
    ? [...(stepData.oracleIrAnyPlayerMayCandidateIds as string[])].map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  return {
    controller: String(stepData.oracleIrControllerId || playerId).trim() as PlayerID,
    sourceId: String(stepData.oracleIrSourceId || stepData.sourceId || '').trim() || undefined,
    sourceName: String(stepData.oracleIrSourceName || stepData.sourceName || '').trim() || undefined,
    targetSpellId: String(stepData.oracleIrTargetSpellId || '').trim() || undefined,
    anySteps,
    declined,
    candidates,
    payment: parseAnyPlayerMayPaymentJson(stepData.oracleIrAnyPlayerMayPaymentJson),
  };
}

export function resumeAnyPlayerMayAfterChoice(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    targetSpellId?: string;
    steps: readonly OracleEffectStep[];
    playerId: PlayerID;
    paid: boolean;
    declined: string[];
    discardCardIds?: readonly string[];
    sacrificePermanentId?: string;
  },
): void {
  if (params.paid) {
    resumeOracleIRRemainingStepsFromResolution(ctx, {
      controller: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      steps: params.steps,
      ...(params.sacrificePermanentId
        ? { chosenObjectIds: [params.sacrificePermanentId] }
        : {}),
      selectorContext: {
        anyPlayerMayChoice: 'pay',
        anyPlayerMayPayerId: params.playerId,
        ...(params.discardCardIds && params.discardCardIds.length > 0
          ? { anyPlayerMayDiscardCardIds: [...params.discardCardIds] }
          : {}),
        ...(params.sacrificePermanentId
          ? {
              anyPlayerMaySacrificePermanentId: params.sacrificePermanentId,
              chosenObjectIds: [params.sacrificePermanentId],
            }
          : {}),
      },
    });
    return;
  }

  const declined = [...params.declined, String(params.playerId)].map((id) => String(id || '').trim()).filter(Boolean);
  resumeOracleIRRemainingStepsFromResolution(ctx, {
    controller: params.controller,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    targetSpellId: params.targetSpellId,
    steps: params.steps,
    selectorContext: {
      anyPlayerMayChoice: 'decline',
      anyPlayerMayPayerId: params.playerId,
      anyPlayerMayDeclinedPlayerIds: declined,
    },
  });
}

/**
 * After Pay on an any_player_may discard/sacrifice window, queue a real picker
 * for that player (or auto-finish when there is no meaningful choice).
 * Returns true when the payment flow was handled (picker queued or pay resumed).
 */
export function maybeQueueAnyPlayerMayPaymentSelection(
  ctx: GameContext,
  state: any,
  stepData: any,
  playerId: PlayerID,
  base: ReturnType<typeof buildAnyPlayerMayPaymentSelectionBase>,
): boolean {
  const payment = base.payment;
  if (!payment || (payment.kind !== 'discard' && payment.kind !== 'sacrifice')) {
    return false;
  }

  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown') {
    return false;
  }
  // During replay, discard/sac payment pickers are restored via queued prompt events.
  // Do not auto-apply pay without selected object IDs.
  if ((ctx as any).isReplaying) {
    return true;
  }

  hydrateOracleIRPlayerZonesFromContext(ctx, state);

  const sourceName = base.sourceName || 'Ability';
  const sourceId = base.sourceId;
  const payerCtx = buildOracleIRExecutionContext({
    controllerId: playerId,
    sourceId,
    sourceName,
  });

  if (payment.kind === 'discard') {
    const synthetic = {
      kind: 'discard',
      who: { kind: 'you' },
      amount: { kind: 'number', value: payment.amount },
      raw: `discard ${payment.amount} card${payment.amount === 1 ? '' : 's'}`,
    } as Extract<OracleEffectStep, { kind: 'discard' }>;

    const builtList = collectDiscardSelectionOptionsForStep(state, synthetic, payerCtx);
    const built = builtList.find((entry) => String(entry.playerId) === String(playerId)) || builtList[0];

    // No meaningful choice (hand size == amount): pay with every eligible card.
    if (!built || built.options.length === 0) {
      const player = ((state as any).players || []).find(
        (p: any) => String(p?.id || '').trim() === String(playerId),
      );
      const handIds = (Array.isArray(player?.hand) ? player.hand : [])
        .map((card: any) => String(card?.id || card?.card?.id || '').trim())
        .filter(Boolean);
      if (handIds.length < payment.amount) {
        resumeAnyPlayerMayAfterChoice(ctx, {
          controller: base.controller,
          sourceId: base.sourceId,
          sourceName: base.sourceName,
          targetSpellId: base.targetSpellId,
          steps: base.anySteps,
          playerId,
          paid: false,
          declined: base.declined,
        });
        return true;
      }
      resumeAnyPlayerMayAfterChoice(ctx, {
        controller: base.controller,
        sourceId: base.sourceId,
        sourceName: base.sourceName,
        targetSpellId: base.targetSpellId,
        steps: base.anySteps,
        playerId,
        paid: true,
        declined: base.declined,
        discardCardIds: handIds.slice(0, payment.amount),
      });
      return true;
    }

    if (built.options.length <= built.discardCount) {
      resumeAnyPlayerMayAfterChoice(ctx, {
        controller: base.controller,
        sourceId: base.sourceId,
        sourceName: base.sourceName,
        targetSpellId: base.targetSpellId,
        steps: base.anySteps,
        playerId,
        paid: true,
        declined: base.declined,
        discardCardIds: built.options.slice(0, built.discardCount).map((opt) => String(opt.id)),
      });
      return true;
    }

    const queuedDiscard = ResolutionQueueManager.addStep(gameId, {
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId,
      description: `${sourceName}: Choose ${built.discardCount} card${built.discardCount === 1 ? '' : 's'} to discard`,
      mandatory: false,
      sourceId,
      sourceName,
      hand: built.options,
      discardCount: built.discardCount,
      currentHandSize: built.currentHandSize,
      maxHandSize: built.maxHandSize,
      reason: 'any_player_may_payment',
      oracleIrAnyPlayerMayPaymentSelection: true,
      oracleIrAnyPlayerMayChoice: true,
      oracleIrAnyPlayerMayPaymentJson: String(stepData.oracleIrAnyPlayerMayPaymentJson || ''),
      oracleIrAnyPlayerMayStepsJson: String(stepData.oracleIrAnyPlayerMayStepsJson || '[]'),
      oracleIrAnyPlayerMayCandidateIds: base.candidates,
      oracleIrAnyPlayerMayDeclinedIds: base.declined,
      oracleIrControllerId: base.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      ...(base.targetSpellId ? { oracleIrTargetSpellId: base.targetSpellId } : {}),
    } as any);
    appendQueuedResolutionPromptEvent(ctx, {
      playerId,
      sourceId,
      queuedResolutionStep: queuedDiscard,
    });
    return true;
  }

  // sacrifice
  const what = payment.what || 'a creature';
  const syntheticSac = {
    kind: 'sacrifice',
    who: { kind: 'you' },
    what: { kind: 'raw', text: what },
    raw: `sacrifice ${what}`,
  } as Extract<OracleEffectStep, { kind: 'sacrifice' }>;
  const builtSac = buildSacrificeTargetSelectionOptions(state, syntheticSac, payerCtx);
  if (!builtSac || builtSac.options.length === 0) {
    resumeAnyPlayerMayAfterChoice(ctx, {
      controller: base.controller,
      sourceId: base.sourceId,
      sourceName: base.sourceName,
      targetSpellId: base.targetSpellId,
      steps: base.anySteps,
      playerId,
      paid: false,
      declined: base.declined,
    });
    return true;
  }

  const queuedSac = ResolutionQueueManager.addStep(gameId, {
    type: ResolutionStepType.TARGET_SELECTION,
    playerId,
    description: `${sourceName}: Choose a creature to sacrifice`,
    mandatory: false,
    sourceId,
    sourceName,
    validTargets: builtSac.options,
    targetTypes: ['permanent'],
    minTargets: Math.max(1, builtSac.minTargets || 1),
    maxTargets: Math.max(1, builtSac.maxTargets || 1),
    targetDescription: `Sacrifice ${what}`,
    sacrificeSelection: true,
    sacrificePermanentType: 'creature',
    sacrificeCount: Math.max(1, builtSac.minTargets || 1),
    sacrificeReason: `${sourceName}: any player may payment`,
    sacrificeSourceName: sourceName,
    oracleIrAnyPlayerMayPaymentSelection: true,
    oracleIrAnyPlayerMayChoice: true,
    oracleIrAnyPlayerMayPaymentJson: String(stepData.oracleIrAnyPlayerMayPaymentJson || ''),
    oracleIrAnyPlayerMayStepsJson: String(stepData.oracleIrAnyPlayerMayStepsJson || '[]'),
    oracleIrAnyPlayerMayCandidateIds: base.candidates,
    oracleIrAnyPlayerMayDeclinedIds: base.declined,
    oracleIrControllerId: base.controller,
    oracleIrSourceId: sourceId,
    oracleIrSourceName: sourceName,
    ...(base.targetSpellId ? { oracleIrTargetSpellId: base.targetSpellId } : {}),
  } as any);
  appendQueuedResolutionPromptEvent(ctx, {
    playerId,
    sourceId,
    queuedResolutionStep: queuedSac,
  });
  return true;
}

/**
 * Resume any_player_may APNAP after a discard/sac payment picker resolves or is cancelled.
 */
export function resolveOracleIrAnyPlayerMayPaymentSelectionFromResolution(
  ctx: GameContext,
  step: any,
  response: {
    readonly selections?: unknown;
    readonly cancelled?: boolean;
  },
): boolean {
  if (step?.oracleIrAnyPlayerMayPaymentSelection !== true) {
    return false;
  }

  const playerId = String(step?.playerId || '').trim() as PlayerID;
  if (!playerId) return false;

  const base = buildAnyPlayerMayPaymentSelectionBase(step, playerId);
  if (!base.anySteps.length) return false;

  if (response.cancelled) {
    resumeAnyPlayerMayAfterChoice(ctx, {
      controller: base.controller,
      sourceId: base.sourceId,
      sourceName: base.sourceName,
      targetSpellId: base.targetSpellId,
      steps: base.anySteps,
      playerId,
      paid: false,
      declined: base.declined,
    });
    return true;
  }

  const selectionIds = (Array.isArray(response.selections) ? response.selections : [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);

  const payment = base.payment;
  if (payment?.kind === 'discard') {
    if (selectionIds.length < payment.amount) {
      resumeAnyPlayerMayAfterChoice(ctx, {
        controller: base.controller,
        sourceId: base.sourceId,
        sourceName: base.sourceName,
        targetSpellId: base.targetSpellId,
        steps: base.anySteps,
        playerId,
        paid: false,
        declined: base.declined,
      });
      return true;
    }
    resumeAnyPlayerMayAfterChoice(ctx, {
      controller: base.controller,
      sourceId: base.sourceId,
      sourceName: base.sourceName,
      targetSpellId: base.targetSpellId,
      steps: base.anySteps,
      playerId,
      paid: true,
      declined: base.declined,
      discardCardIds: selectionIds.slice(0, payment.amount),
    });
    return true;
  }

  if (payment?.kind === 'sacrifice') {
    const permanentId = selectionIds[0] || '';
    if (!permanentId) {
      resumeAnyPlayerMayAfterChoice(ctx, {
        controller: base.controller,
        sourceId: base.sourceId,
        sourceName: base.sourceName,
        targetSpellId: base.targetSpellId,
        steps: base.anySteps,
        playerId,
        paid: false,
        declined: base.declined,
      });
      return true;
    }
    resumeAnyPlayerMayAfterChoice(ctx, {
      controller: base.controller,
      sourceId: base.sourceId,
      sourceName: base.sourceName,
      targetSpellId: base.targetSpellId,
      steps: base.anySteps,
      playerId,
      paid: true,
      declined: base.declined,
      sacrificePermanentId: permanentId,
    });
    return true;
  }

  return false;
}


