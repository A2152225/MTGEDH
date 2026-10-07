// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerOptionalStepChoicePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueOptionalStepChoicePromptsFromOracleIRResult plus
//   applyOracleIrOptionalLifePayment and resolveOptionalPayLifeAmount.
// Public entry symbols: applyOracleIrOptionalLifePayment,
//   resolveOptionalPayLifeAmount,
//   queueOptionalStepChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveOracleQuantity } from '../../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import { tryEvaluateCombatDamageReferenceCount } from '../../../../../rules-engine/src/oracleIRExecutorCombatDamageCounts.js';
import { buildMoveZoneSelectionOptions } from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt } from '../../../../../rules-engine/src/oracleIRPerPlayerOptional.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import { appendQueuedResolutionPromptEvent } from '../resolutionPromptEvents.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
} from '../oracleIrServerPromptResumeUtils.js';
import { queueMoveZoneChoicePromptsFromOracleIRResult } from './oracleIrServerCopyPermanentMoveZonePrompts.js';
import {
  collectGrantGraveyardPermissionModifyMetadata,
  resolveGrantGraveyardCastChoiceCard,
} from './oracleIrServerImpulseDiscoverGyPermissionPrompts.js';

export function applyOracleIrOptionalLifePayment(state: any, playerId: string, amount: number): void {
  if (!state || !playerId || !(amount > 0)) return;
  state.life = state.life || {};
  const player = Array.isArray(state.players)
    ? state.players.find((entry: any) => String(entry?.id || '').trim() === playerId)
    : undefined;
  const current = Number(
    state.life[playerId]
    ?? (typeof player?.life === 'number' ? player.life : undefined)
    ?? state.startingLife
    ?? 40,
  );
  const nextLife = current - amount;
  state.life[playerId] = nextLife;
  if (player) {
    player.life = nextLife;
  }
  state.lifeLostThisTurn = state.lifeLostThisTurn || {};
  state.lifeLostThisTurn[playerId] = Number(state.lifeLostThisTurn[playerId] || 0) + amount;
}

export function resolveOptionalPayLifeAmount(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'lose_life' }>,
  controllerId: PlayerID,
  irCtx?: OracleIRExecutionContext,
): number {
  const amount = step.amount as OracleQuantity | undefined;
  if (amount?.kind === 'number') return Number(amount.value);
  const whereRaw = String(
    (step as { whereX?: { raw?: string } }).whereX?.raw
    || (amount && 'raw' in amount ? amount.raw : '')
    || '',
  ).trim();
  if (whereRaw) {
    const counted = tryEvaluateCombatDamageReferenceCount(state, controllerId, whereRaw, irCtx);
    if (counted != null) return counted;
  }
  if (amount && irCtx) {
    const resolved = resolveOracleQuantity(state, controllerId, amount, irCtx);
    if (resolved != null) return Number(resolved);
  }
  return Number.NaN;
}

export function queueOptionalStepChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx?: OracleIRExecutionContext;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (gap.reasonCode !== 'optional_step_requires_player_choice') continue;
    const destinationChoice = (gap.metadata as { moveZoneDestinationChoice?: unknown } | undefined)?.moveZoneDestinationChoice;
    if (Array.isArray(destinationChoice) && destinationChoice.length > 0) continue;
    const stepKind = String(gap.stepKind || '');
    if (stepKind === 'lose_life') {
      const step = findSkippedOracleStep(result, gap);
      if (!step || step.kind !== 'lose_life') continue;
      const lifeAmount = resolveOptionalPayLifeAmount(state, step, params.controller, params.irCtx);
      if (!Number.isFinite(lifeAmount) || lifeAmount <= 0) continue;
      const queueKey = `${stepKind}:${String((step as any).raw || '')}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);
      const cardWord = lifeAmount === 1 ? 'card' : 'cards';
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: params.controller,
        description: `${sourceName}: You may pay ${lifeAmount} life. If you do, draw ${lifeAmount} ${cardWord}.`,
        mandatory: false,
        sourceId,
        sourceName,
        options: [
          { id: 'pay_life', label: `Pay ${lifeAmount} life`, description: `Pay ${lifeAmount} life` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay life' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'life',
        optionalPaymentLifeAmount: lifeAmount,
        optionalPaymentPayChoiceId: 'pay_life',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrOptionalMayChoice: true,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        oracleIrXValue: lifeAmount,
      } as any, result, params) as any);
      continue;
    }
    if (
      stepKind !== 'move_zone'
      && stepKind !== 'grant_graveyard_permission'
      && stepKind !== 'attach'
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap);
    if (!step) continue;

    if (isOracleIrOptionalStepBridgedToDedicatedResolutionPrompt(step)) {
      continue;
    }

    if (
      stepKind === 'move_zone'
      && step.kind === 'move_zone'
      && params.irCtx
      && buildMoveZoneSelectionOptions(state, step, params.irCtx)
    ) {
      // queueMoveZoneChoicePromptsFromOracleIRResult queues LIBRARY_SEARCH (or graveyard UX).
      continue;
    }

    const queueKey = `${stepKind}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;

    if (
      stepKind === 'grant_graveyard_permission'
      && step.kind === 'grant_graveyard_permission'
      && params.irCtx
    ) {
      const graveyardCard = resolveGrantGraveyardCastChoiceCard(
        state,
        params.controller,
        params.irCtx,
        params.triggerItem,
      );
      if (graveyardCard) {
        queuedKeys.add(queueKey);
        const cardId = String(graveyardCard?.id || '').trim();
        const cardName = String(graveyardCard?.name || 'that card').trim() || 'that card';
        const permission = String((step as any).permission || 'cast').toLowerCase();
        const modify = collectGrantGraveyardPermissionModifyMetadata(result);
        const isLandCard = /\bland\b/i.test(String(graveyardCard?.type_line || ''));
        const actionLabel = permission === 'play' || isLandCard ? 'Play' : 'Cast';
        const promptDescription = isLandCard
          ? `${sourceName}: You may play ${cardName} from your graveyard.`
          : modify.withoutPayingManaCost
            ? `${sourceName}: You may cast ${cardName} from your graveyard without paying its mana cost.`
            : `${sourceName}: You may cast ${cardName} from your graveyard.`;

        if (permission === 'play' || isLandCard) {
          const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: params.controller,
            sourceId,
            sourceName,
            description: promptDescription,
            mandatory: false,
            options: [
              { id: 'play', label: `${actionLabel} ${cardName}` },
              { id: 'decline', label: 'Decline' },
            ],
            minSelections: 1,
            maxSelections: 1,
            playFromGraveyardCardId: cardId,
            playFromGraveyardCard: {
              ...(graveyardCard as any),
              ...(modify.exileAfterResolution ? { exileAfterResolution: true } : null),
            },
            playFromGraveyardWithoutPayingManaCost: modify.withoutPayingManaCost,
            ...(modify.exileAfterResolution ? { playFromGraveyardExileAfterResolution: true } : null),
            oracleIrControllerId: params.controller,
            oracleIrSourceId: sourceId,
            oracleIrSourceName: sourceName,
          } as any, result, params) as any);
          appendQueuedResolutionPromptEvent(ctx, {
            playerId: params.controller,
            sourceId,
            queuedResolutionStep: queuedStep,
          });
        } else {
          const queuedStep = ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
            type: ResolutionStepType.OPTION_CHOICE,
            playerId: params.controller,
            sourceId,
            sourceName,
            description: promptDescription,
            mandatory: false,
            options: [
              { id: 'cast', label: `${actionLabel} ${cardName}` },
              { id: 'decline', label: 'Decline' },
            ],
            minSelections: 1,
            maxSelections: 1,
            castFromGraveyardCardId: cardId,
            castFromGraveyardCard: {
              ...(graveyardCard as any),
              ...(modify.exileAfterResolution ? { exileAfterResolution: true } : null),
            },
            castFromGraveyardWithoutPayingManaCost: modify.withoutPayingManaCost,
            ...(modify.exileAfterResolution ? { castFromGraveyardExileAfterResolution: true } : null),
            oracleIrControllerId: params.controller,
            oracleIrSourceId: sourceId,
            oracleIrSourceName: sourceName,
          } as any, result, params) as any);
          appendQueuedResolutionPromptEvent(ctx, {
            playerId: params.controller,
            sourceId,
            queuedResolutionStep: queuedStep,
          });
        }
        continue;
      }
    }

    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description: `${sourceName}: ${String((step as any).raw || 'You may')}`,
      mandatory: false,
      sourceId,
      sourceName,
      options: [
        { id: 'accept', label: 'Yes', description: 'Accept' },
        { id: 'decline', label: 'No', description: 'Decline' },
      ],
      minSelections: 1,
      maxSelections: 1,
      optionalPaymentPrompt: true,
      optionalPaymentPayChoiceId: 'accept',
      optionalPaymentDeclineChoiceId: 'decline',
      oracleIrOptionalMayChoice: true,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

