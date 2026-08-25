// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerUnlessPayChoicePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueUnlessPayChoicePromptsFromOracleIRResult.
// Public entry symbols: queueUnlessPayChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { normalizeOracleManaCostString } from '../../../../../rules-engine/src/oracleIRExecutorManaUtils.js';
import { resolveOracleIrBoundTargetSpellId } from '../../../../../rules-engine/src/oracleIrTargetBinding.js';
import { describeAnyPlayerMayPayment } from '../../../../../rules-engine/src/oracleIRAnyPlayerMay.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';
import { resolveOptionalPayLifeAmount } from './oracleIrServerOptionalStepChoicePrompts.js';

export function queueUnlessPayChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const triggerItem = params.triggerItem;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) {
      continue;
    }

    const stepKind = String(gap.stepKind || '');
    const gapRaw = String(gap.raw || '');
    const queueKey = `${stepKind}:${gapRaw}`;
    if (queuedKeys.has(queueKey)) continue;

    const metadata = (gap.metadata || {}) as Record<string, unknown>;
    const unlessPayManaCost = normalizeOracleManaCostString(String(metadata.unlessPayManaCost || '').trim());
    const unlessPayLifeAmount = Number(metadata.unlessPayLifeAmount);

    if (stepKind === 'sacrifice' && unlessPayManaCost && sourceId) {
      queuedKeys.add(queueKey);
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.MANA_PAYMENT_CHOICE,
        playerId: params.controller,
        sourceId,
        sourceName,
        description: `${sourceName}: Pay ${unlessPayManaCost} or sacrifice it.`,
        mandatory: false,
        activationPaymentChoice: true,
        confirmLabel: `Pay ${unlessPayManaCost}`,
        permanentId: sourceId,
        cardName: sourceName,
        manaCost: unlessPayManaCost,
        sacrificeUnlessPayChoice: true,
      } as any, result, params) as any);
      continue;
    }

    const skippedStep = findSkippedOracleStep(result, gap);

    if (stepKind === 'lose_life' && skippedStep?.kind === 'lose_life') {
      const lifeAmount = resolveOptionalPayLifeAmount(state, skippedStep, params.controller, params.irCtx);
      if (!Number.isFinite(lifeAmount) || lifeAmount <= 0) continue;
      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);
      const cardWord = lifeAmount === 1 ? 'card' : 'cards';
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
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
        oracleIrChoiceStepJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        oracleIrXValue: lifeAmount,
      } as any, result, params) as any);
      continue;
    }

    if (stepKind === 'pay_mana' && skippedStep?.kind === 'pay_mana') {
      const manaCost = normalizeOracleManaCostString(String((skippedStep as any).mana || metadata.manaCost || '').trim());
      if (!manaCost) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: You may pay ${manaCost}. If you do, copy that ability.`,
        mandatory: false,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: `Pay ${manaCost}`, description: `Pay ${manaCost}` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'mana',
        optionalPaymentManaCost: manaCost,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrOptionalPayManaChoice: true,
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        copyTriggeredAbilityDeclineEvent: true,
        copyTriggeredAbilitySourceId: String(triggerItem?.source || triggerItem?.permanentId || sourceId || '').trim() || undefined,
        copyTriggeredAbilityTriggerStackItemId: String(triggerItem?.id || '').trim() || undefined,
        copyTriggeredAbilityTriggeringStackItemId: String(
          triggerItem?.triggeringStackItemId
          || triggerItem?.effectData?.triggeringStackItemId
          || params.irCtx.targetSpellId
          || '',
        ).trim() || undefined,
      } as any, result, params) as any);
      continue;
    }

    if (stepKind === 'any_player_may' && skippedStep?.kind === 'any_player_may') {
      const payment = (skippedStep as any).payment;
      const paymentLabel = describeAnyPlayerMayPayment(payment);
      const nextPlayerId = String(metadata.nextPlayerId || metadata.payerId || '').trim() as PlayerID;
      const candidatePlayerIds = Array.isArray(metadata.candidatePlayerIds)
        ? (metadata.candidatePlayerIds as string[]).map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      const payerId = (nextPlayerId || candidatePlayerIds[0] || params.controller) as PlayerID;
      if (!payerId) continue;

      queuedKeys.add(queueKey);
      const declinedPlayerIds = Array.isArray(metadata.declinedPlayerIds)
        ? (metadata.declinedPlayerIds as string[])
        : [];

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: Any player may ${paymentLabel}. If a player does, counter this spell.`,
        mandatory: false,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: paymentLabel[0].toUpperCase() + paymentLabel.slice(1), description: paymentLabel },
          { id: 'decline', label: 'Decline', description: 'Decline' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        // Payment is applied by evaluateAnyPlayerMayStep on resume (avoid double-charge).
        optionalPaymentValidationKind: 'none',
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrAnyPlayerMayChoice: true,
        oracleIrAnyPlayerMayPaymentJson: JSON.stringify(payment || {}),
        oracleIrAnyPlayerMayStepsJson: JSON.stringify([(skippedStep as any)]),
        oracleIrAnyPlayerMayCandidateIds: candidatePlayerIds,
        oracleIrAnyPlayerMayDeclinedIds: declinedPlayerIds,
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        ...(params.irCtx?.targetSpellId || triggerItem?.triggeringStackItemId
          ? {
              oracleIrTargetSpellId: String(
                params.irCtx?.targetSpellId || triggerItem?.triggeringStackItemId || '',
              ).trim(),
            }
          : {}),
      } as any, result, params) as any);
      continue;
    }

    if (stepKind === 'unless_pays_mana' && skippedStep?.kind === 'unless_pays_mana') {
      const manaCost = normalizeOracleManaCostString(String((skippedStep as any).mana || metadata.manaCost || '').trim());
      if (!manaCost) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      const boundTargetSpellId = resolveOracleIrBoundTargetSpellId(params.irCtx);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: ${gapRaw || `Pay ${manaCost} or decline`}`,
        mandatory: true,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: `Pay ${manaCost}`, description: `Pay ${manaCost}` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'mana',
        optionalPaymentManaCost: manaCost,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrUnlessPayChoice: true,
        oracleIrUnlessPayKind: 'mana',
        oracleIrUnlessPayStepsJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        ...(boundTargetSpellId ? { oracleIrTargetSpellId: boundTargetSpellId } : {}),
      } as any, result, params) as any);
      continue;
    }

    if (stepKind === 'unless_pays_life' && skippedStep?.kind === 'unless_pays_life') {
      const lifeAmount = Number(
        (skippedStep as any).amount ??
          metadata.lifeAmount ??
          unlessPayLifeAmount
      );
      if (!Number.isFinite(lifeAmount) || lifeAmount <= 0) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const payerId = String(metadata.payerId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      const boundTargetSpellId = resolveOracleIrBoundTargetSpellId(params.irCtx);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: payerId,
        description: `${sourceName}: ${gapRaw || `Pay ${lifeAmount} life or decline`}`,
        mandatory: true,
        sourceId,
        sourceName,
        options: [
          { id: 'pay', label: `Pay ${lifeAmount} life`, description: `Pay ${lifeAmount} life` },
          { id: 'decline', label: 'Decline', description: 'Decline to pay life' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentValidationKind: 'life',
        optionalPaymentLifeAmount: lifeAmount,
        optionalPaymentPayChoiceId: 'pay',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrUnlessPayChoice: true,
        oracleIrUnlessPayKind: 'life',
        oracleIrUnlessPayStepsJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        ...(boundTargetSpellId ? { oracleIrTargetSpellId: boundTargetSpellId } : {}),
      } as any, result, params) as any);
    }

    if (stepKind === 'unless_discards' && skippedStep?.kind === 'unless_discards') {
      const discardAmount = Math.max(0, Number((skippedStep as any).amount ?? metadata.discardAmount ?? 0) | 0);
      if (discardAmount <= 0) continue;

      const players = resolvePlayers(state, (skippedStep as any).who, params.irCtx);
      const discarderId = String(metadata.discarderId || players[0] || params.controller).trim() as PlayerID;
      queuedKeys.add(queueKey);

      const cardWord = discardAmount === 1 ? 'card' : 'cards';
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.OPTION_CHOICE,
        playerId: discarderId,
        description: `${sourceName}: ${gapRaw || `Discard ${discardAmount} ${cardWord} or decline`}`,
        mandatory: true,
        sourceId,
        sourceName,
        options: [
          { id: 'discard', label: `Discard ${discardAmount} ${cardWord}`, description: `Discard ${discardAmount} ${cardWord}` },
          { id: 'decline', label: 'Decline', description: 'Decline to discard' },
        ],
        minSelections: 1,
        maxSelections: 1,
        optionalPaymentPrompt: true,
        optionalPaymentPayChoiceId: 'discard',
        optionalPaymentDeclineChoiceId: 'decline',
        oracleIrUnlessDiscardsChoice: true,
        oracleIrUnlessDiscardsStepsJson: JSON.stringify([skippedStep]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}

