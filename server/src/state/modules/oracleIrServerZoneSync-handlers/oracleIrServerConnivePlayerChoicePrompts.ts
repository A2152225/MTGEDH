// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerConnivePlayerChoicePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueConniveChoicePromptsFromOracleIRResult,
//   queuePlayerChoicePromptsFromOracleIRResult, and
//   syncIrPendingDiscardFromOracleIRResult, plus connive/player-choice
//   prompt builders they close over.
// Public entry symbols: queueConniveChoicePromptsFromOracleIRResult,
//   queuePlayerChoicePromptsFromOracleIRResult,
//   syncIrPendingDiscardFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveSingleCreatureTargetId } from '../../../../../rules-engine/src/oracleIRExecutorCreatureStepUtils.js';
import { resolveBoundSelfOrSourceCreatureTargetId } from '../../../../../rules-engine/src/oracleIRExecutorBoundSelfCreatureTarget.js';
import { resolveOracleQuantity } from '../../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import {
  collectDiscardSelectionOptionsForStep,
  buildPlayerChoiceAmongThemSelectionOptions,
} from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
  normalizeTopLibraryPromptCard,
} from '../oracleIrServerPromptResumeUtils.js';
import {
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
} from '../oracleIrTransitionPipeline.js';

function buildConniveDiscardPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'connive' }>,
  irCtx: OracleIRExecutionContext,
): { playerId: PlayerID; discardCount: number; hand: any[] } | null {
  const targetId = resolveBoundSelfOrSourceCreatureTargetId(state, step.target, irCtx);
  if (!targetId) return null;

  const target = (state.battlefield || []).find((perm: any) => String(perm?.id || '').trim() === targetId);
  const playerId = String(target?.controller || irCtx.controllerId || '').trim() as PlayerID;
  if (!playerId) return null;

  const amount = resolveOracleQuantity(
    state,
    irCtx.controllerId,
    step.amount as OracleQuantity,
    irCtx,
    { whereX: (step as any).whereX },
  );
  if (amount === null || amount <= 0) return null;

  const player = (state.players || []).find((entry: any) => String(entry?.id || '').trim() === playerId);
  const hand = Array.isArray(player?.hand) ? player.hand : [];
  if (hand.length <= amount) return null;

  return {
    playerId,
    discardCount: amount,
    hand: hand.map((card: any) => ({
      id: String(card?.id || ''),
      name: String(card?.name || card?.card?.name || card?.id || 'Card'),
      type_line: card?.type_line || card?.card?.type_line,
      oracle_text: card?.oracle_text || card?.card?.oracle_text,
      imageUrl: card?.image_uris?.normal || card?.imageUrl,
      mana_cost: card?.mana_cost || card?.card?.mana_cost,
      cmc: card?.cmc ?? card?.card?.cmc,
    })).filter((card) => card.id),
  };
}

const KEYWORD_COUNTER_FROM_AMONG_PATTERN = /counter from among/i;

function isKeywordCounterFromAmongPlayerChoice(
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
): boolean {
  if (step.choice !== 'generic') return false;
  if (!KEYWORD_COUNTER_FROM_AMONG_PATTERN.test(String(step.raw || ''))) return false;
  const options = Array.isArray(step.options) ? step.options : [];
  return options.length > 0;
}

function resolveKeywordCounterTargetPermanent(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  irCtx: OracleIRExecutionContext,
  triggerItem?: any,
): { id: string; name: string } | null {
  const targetId = String(
    resolveSingleCreatureTargetId(state, step.target, irCtx)
    || triggerItem?.targets?.[0]?.id
    || triggerItem?.targets?.[0]
    || irCtx.targetPermanentId
    || irCtx.targetCreatureId
    || '',
  ).trim();
  if (!targetId) return null;

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const targetPermanent = battlefield.find((perm: any) => String(perm?.id || '') === targetId);
  if (!targetPermanent) return null;

  return {
    id: targetId,
    name: String(targetPermanent?.card?.name || targetPermanent?.name || 'the creature').trim() || 'the creature',
  };
}

function precedingPlusOneCounterAlreadyApplied(result: OracleIRExecutionResult): boolean {
  return (result.appliedSteps || []).some((applied) =>
    applied.kind === 'add_counter'
    && String((applied as any).counter || '') === '+1/+1',
  );
}

function buildKeywordCounterFromAmongModalPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  irCtx: OracleIRExecutionContext,
  params: {
    controller: PlayerID;
    sourceName: string;
    sourceId?: string;
    triggerItem?: any;
    result: OracleIRExecutionResult;
  },
): Record<string, unknown> | null {
  if (!isKeywordCounterFromAmongPlayerChoice(step)) return null;

  const target = resolveKeywordCounterTargetPermanent(state, step, irCtx, params.triggerItem);
  if (!target) return null;

  const counterOptions = (Array.isArray(step.options) ? step.options : [])
    .map((opt) => String(opt || '').trim())
    .filter(Boolean);
  if (counterOptions.length === 0) return null;

  const plusOneAlreadyApplied = precedingPlusOneCounterAlreadyApplied(params.result);
  const sourceImage = params.triggerItem?.card?.image_uris?.small
    || params.triggerItem?.card?.image_uris?.normal
    || undefined;

  return {
    type: ResolutionStepType.MODAL_CHOICE,
    playerId: params.controller,
    description: `${params.sourceName}: Choose a counter type to put on ${target.name}`,
    mandatory: step.optional !== true,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    sourceImage,
    promptTitle: 'Choose Counter Type',
    promptDescription: plusOneAlreadyApplied
      ? `Which keyword counter to put on ${target.name}?`
      : `Put a +1/+1 counter and which keyword counter on ${target.name}?`,
    options: counterOptions.map((opt) => ({
      id: opt.toLowerCase().replace(/\s+/g, '_'),
      label: opt.charAt(0).toUpperCase() + opt.slice(1),
    })),
    minSelections: 1,
    maxSelections: 1,
    keywordCounterChoiceData: {
      targetPermanentId: target.id,
      targetName: target.name,
      allowedKeywords: counterOptions,
      ...(plusOneAlreadyApplied ? {} : { extraCounters: { '+1/+1': 1 } }),
      sourceName: params.sourceName,
    },
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
    oracleIrPlayerChoiceKind: step.choice,
    oracleIrTargetPermanentId: target.id,
  };
}

function buildPlayerChoicePrompt(
  step: Extract<OracleEffectStep, { kind: 'player_choice' }>,
  params: { controller: PlayerID; sourceName: string; sourceId?: string },
): Record<string, unknown> | null {
  const description = `${params.sourceName}: ${String(step.raw || 'Make a choice')}`;
  const base = {
    mandatory: step.optional !== true,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
    oracleIrPlayerChoiceKind: step.choice,
  };

  if (step.choice === 'card_type') {
    return {
      ...base,
      type: ResolutionStepType.CREATURE_TYPE_CHOICE,
      playerId: params.controller,
      description,
    };
  }

  if (step.choice === 'letter') {
    const options = Array.isArray(step.options) && step.options.length > 0
      ? step.options.map((value) => ({ id: String(value), label: String(value) }))
      : 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('').map((letter) => ({ id: letter, label: letter }));
    return {
      ...base,
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description,
      options,
      minSelections: 1,
      maxSelections: 1,
    };
  }

  if (step.choice === 'odd_even') {
    return {
      ...base,
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description,
      options: [
        { id: 'odd', label: 'Odd' },
        { id: 'even', label: 'Even' },
      ],
      minSelections: 1,
      maxSelections: 1,
    };
  }

  const genericOptions = Array.isArray(step.options)
    ? step.options.map((value) => ({ id: String(value), label: String(value) })).filter((option) => option.id)
    : [];
  if (genericOptions.length === 0) return null;

  return {
    ...base,
    type: ResolutionStepType.OPTION_CHOICE,
    playerId: params.controller,
    description,
    options: genericOptions,
    minSelections: 1,
    maxSelections: 1,
  };
}

export function queueConniveChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'connive') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'connive') continue;

    const built = buildConniveDiscardPrompt(state, step as Extract<OracleEffectStep, { kind: 'connive' }>, params.irCtx);
    if (!built || built.hand.length <= built.discardCount) continue;

    const targetId = resolveBoundSelfOrSourceCreatureTargetId(state, (step as any).target, params.irCtx) || undefined;
    const queueKey = `connive:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.DISCARD_SELECTION,
      playerId: built.playerId,
      description: `${sourceName}: ${String((step as any).raw || 'Connive')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      hand: built.hand,
      discardCount: built.discardCount,
      minDiscardCount: built.discardCount,
      maxDiscardCount: built.discardCount,
      currentHandSize: built.hand.length,
      reason: 'connive',
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrTargetPermanentId: targetId,
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

export function queuePlayerChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'player_choice') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'player_choice' }> | undefined;
    if (!step || step.kind !== 'player_choice') continue;

    const queueKey = `player_choice:${String((step as any).choice || '')}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const irCtxForChoice = {
      ...params.irCtx,
      stepLedger: params.irCtx.stepLedger?.size
        ? params.irCtx.stepLedger
        : readStepLedgerFromState(state),
      appliedStepKinds: params.irCtx.appliedStepKinds?.size
        ? params.irCtx.appliedStepKinds
        : readAppliedStepKindsFromState(state),
    };
    const amongBuilt = buildPlayerChoiceAmongThemSelectionOptions(state, step, irCtxForChoice);
    if (amongBuilt) {
      const availableCards = amongBuilt.availableCards.map(normalizeTopLibraryPromptCard);
      const selectableIds = new Set(amongBuilt.selectableCardIds);
      const nonSelectableCards = availableCards.filter(
        (card) => !selectableIds.has(String(card.id || '')),
      );
      const remainderRandomOrder = /\brandom order\b/i.test(String((step as any).raw || ''))
        || (result.pendingContinuationSteps || []).some((pending) =>
          /\brandom order\b/i.test(String((pending as any).raw || '')),
        );
      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.LIBRARY_SEARCH,
        playerId: amongBuilt.playerId,
        description: `${sourceName}: ${String((step as any).raw || 'Choose cards')}`,
        mandatory: step.optional !== true,
        sourceId,
        sourceName,
        searchCriteria: String((step as any).raw || 'Choose cards from among them'),
        minSelections: amongBuilt.minSelections,
        maxSelections: amongBuilt.maxSelections,
        destination: 'hand',
        reveal: false,
        shuffleAfter: false,
        remainderDestination: 'bottom',
        remainderRandomOrder,
        availableCards,
        nonSelectableCards,
        filter: amongBuilt.filter,
        persistLibrarySearchResolve: true,
        persistLibrarySearchResolveReason: 'stack_resolution',
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, { ...params, controller: params.controller }) as any);
      continue;
    }

    const keywordCounterPrompt = buildKeywordCounterFromAmongModalPrompt(
      state,
      step,
      irCtxForChoice,
      {
        controller: params.controller,
        sourceName,
        sourceId,
        triggerItem: params.triggerItem,
        result,
      },
    );
    if (keywordCounterPrompt) {
      ResolutionQueueManager.addStep(
        gameId,
        attachOracleIrResumeMetadata(keywordCounterPrompt, result, params) as any,
      );
      continue;
    }

    const prompt = buildPlayerChoicePrompt(
      step,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
  }
}

export function syncIrPendingDiscardFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    irCtx: OracleIRExecutionContext;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  const sourceName = String(params.sourceName || 'Spell').trim() || 'Spell';

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'discard') continue;

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'discard' }> | undefined;
    if (!step) continue;

    const builtPrompts = collectDiscardSelectionOptionsForStep(state, step, params.irCtx);
    for (const built of builtPrompts) {
      if (!built) continue;
      if (!built.anyNumberDiscard && built.discardCount <= 0) continue;

      if (gameId && gameId !== 'unknown') {
        try {
          const alreadyQueued = ResolutionQueueManager
            .getStepsForPlayer(gameId, built.playerId)
            .some((candidate) => candidate.type === ResolutionStepType.DISCARD_SELECTION);
          if (alreadyQueued) continue;
        } catch {
          // ignore
        }
      }

      state.pendingDiscard = state.pendingDiscard || {};
      state.pendingDiscard[built.playerId] = {
        count: built.discardCount,
        source: sourceName,
        reason: 'spell_effect',
      };
    }
  }
}

