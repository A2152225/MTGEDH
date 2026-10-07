// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerResumeAndChoiceApply.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: sacrifice choice prompts, unless-discard/unless-pay resume,
//   resumeOracleIRRemainingStepsFromResolution,
//   resumeOracleIRStepWithChoiceFromResolution,
//   maybeApplyOracleIrChoiceStepFromResolution, plus selection-id helpers
//   and mergeOracleIrContinuationResult.
// Public entry symbols: queueSacrificeChoicePromptsFromOracleIRResult,
//   resumeOracleIRUnlessDiscardsFromResolution,
//   resumeOracleIRUnlessPayFromResolution,
//   resumeOracleIRRemainingStepsFromResolution,
//   resumeOracleIRStepWithChoiceFromResolution,
//   maybeApplyOracleIrChoiceStepFromResolution.
// Binds sacrifice into oracleIrServerApplyDeps at module load.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep } from '../../../../../rules-engine/src/oracleIR.js';
import {
  buildOracleIRExecutionContext,
  type OracleIRExecutionContext,
  type OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveBoundSelfOrSourceCreatureTargetId } from '../../../../../rules-engine/src/oracleIRExecutorBoundSelfCreatureTarget.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { buildSacrificeTargetSelectionOptions } from '../../../../../rules-engine/src/oracleIRExecutorBattlefieldStepHandlers.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';
import {
  persistOracleIrCompoundDrawAfterResolution,
  readAppliedStepKindsFromState,
  readStepLedgerFromState,
  resolveOracleIrChoiceStepIndex,
  resolveOracleIrContinuationStepIndex,
} from '../oracleIrTransitionPipeline.js';
import { applyOracleIRStepsOnServer } from './oracleIrServerApplyOnServer.js';
import {
  poolKeyToManaSymbol,
  buildChosenManaFromDistribution,
} from './oracleIrServerManaCounterChoicePrompts.js';
import { bindQueueSacrificeChoicePromptsFromOracleIRResult } from './oracleIrServerApplyDeps.js';
import {
  extractBottomOrderIds,
  extractWarpWorldChoiceId,
} from './oracleIrServerWarpWorldChoicePrompts.js';
import {
  parseJsonArrayRecord,
  parseJsonRecord,
  WARP_WORLD_CHOICE_AURA,
  WARP_WORLD_CHOICE_COMMANDER,
  WARP_WORLD_CHOICE_REMAINDER,
} from '../../../../../rules-engine/src/oracleIRExecutorWarpWorldInteractive.js';

type MutableOracleIRExecutionResult = {
  -readonly [K in keyof OracleIRExecutionResult]: OracleIRExecutionResult[K];
};

function mergeOracleIrContinuationResult(
  target: OracleIRExecutionResult,
  continuation: OracleIRExecutionResult,
): void {
  const mutable = target as MutableOracleIRExecutionResult;
  mutable.appliedSteps = [...mutable.appliedSteps, ...continuation.appliedSteps];
  mutable.skippedSteps = continuation.skippedSteps;
  mutable.pendingOptionalSteps = continuation.pendingOptionalSteps;
  mutable.pendingContinuationSteps = continuation.pendingContinuationSteps;
  mutable.automationGaps = continuation.automationGaps;
}

function queueSacrificeChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
    targetPlayerId?: PlayerID;
    triggerItem?: any;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();
  let hadUnqueueableSacrificeGap = false;
  const fizzledSacrificeSteps: OracleEffectStep[] = [];

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'sacrifice') continue;

    const step = (result.skippedSteps || []).find(
      (candidate) =>
        candidate.kind === 'sacrifice' &&
        String((candidate as any).raw || '') === String(gap.raw || '')
    ) as OracleEffectStep | undefined;
    if (!step || step.kind !== 'sacrifice') continue;

    const built = buildSacrificeTargetSelectionOptions(state, step, params.irCtx);
    if (!built || built.options.length === 0) {
      hadUnqueueableSacrificeGap = true;
      fizzledSacrificeSteps.push(step);
      continue;
    }

    const queueKey = `sacrifice:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const stepRaw = String((step as any).raw || '');
    const sacrificeWhatText = String((step as any)?.what?.text || (step as any)?.what?.raw || '').trim();
    const isAnnihilatorStyleSacrifice =
      /\bdefending player sacrifices\b/i.test(stepRaw)
      || (/\bannihilator\b/i.test(params.sourceName || '') && /\bpermanents?\b/i.test(sacrificeWhatText));
    const annihilatorCountMatch = sacrificeWhatText.match(/^(\d+)\s+permanents?$/i);
    const annihilatorRequiredCount = annihilatorCountMatch
      ? Math.max(1, Number.parseInt(String(annihilatorCountMatch[1] || '1'), 10))
      : built.minTargets;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String((step as any).raw || 'Sacrifice')}`,
      mandatory: true,
      sourceId,
      sourceName,
      validTargets: built.options,
      targetTypes: ['permanent'],
      minTargets: built.minTargets,
      maxTargets: built.maxTargets,
      targetDescription: String((step as any).raw || 'Choose permanents to sacrifice'),
      ...(isAnnihilatorStyleSacrifice
        ? {
          annihilatorChoice: true,
          sacrificeSelection: true,
          sacrificePermanentType: 'permanent',
          sacrificeCount: built.minTargets,
          sacrificeReason: `${sourceName}'s Annihilator ${annihilatorRequiredCount} triggered`,
          sacrificeSourceName: sourceName,
        }
        : {}),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }

  if (!hadUnqueueableSacrificeGap) return;

  const pending = result.pendingContinuationSteps;
  if (!Array.isArray(pending) || pending.length === 0) return;

  const continuationResult = resumeOracleIRRemainingStepsFromResolution(ctx, {
    controller: params.controller,
    sourceId,
    sourceName,
    steps: pending,
    targetPlayerId: params.targetPlayerId,
    triggerItem: params.triggerItem,
  });
  if (!continuationResult) return;

  mergeOracleIrContinuationResult(result, continuationResult);
  if (fizzledSacrificeSteps.length > 0) {
    const mutable = result as MutableOracleIRExecutionResult;
    mutable.appliedSteps = [...mutable.appliedSteps, ...fizzledSacrificeSteps];
  }
}

bindQueueSacrificeChoicePromptsFromOracleIRResult(queueSacrificeChoicePromptsFromOracleIRResult);

function normalizeOracleIrTopLibraryIdList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => {
      if (typeof entry === 'string') return entry.trim();
      if (entry && typeof entry === 'object') {
        return String((entry as { id?: string }).id || '').trim();
      }
      return '';
    })
    .filter(Boolean);
}

function extractOracleIrTopLibraryOrderingFromResponse(
  stepKind: 'scry' | 'surveil',
  selections: unknown,
): Record<string, unknown> | null {
  if (!selections || typeof selections !== 'object' || Array.isArray(selections)) {
    return null;
  }
  const record = selections as Record<string, unknown>;
  const keepTopOrder = normalizeOracleIrTopLibraryIdList(record.keepTopOrder);
  if (stepKind === 'scry') {
    const bottomOrder = normalizeOracleIrTopLibraryIdList(record.bottomOrder);
    if (keepTopOrder.length + bottomOrder.length === 0) return null;
    return {
      keepTopOrder,
      bottomOrder,
      scryResolutionComplete: true,
    };
  }
  const toGraveyard = normalizeOracleIrTopLibraryIdList(record.toGraveyard);
  if (keepTopOrder.length + toGraveyard.length === 0) return null;
  return {
    keepTopOrder,
    toGraveyard,
    surveilResolutionComplete: true,
  };
}

export function extractOracleIrSelectionIds(selections: unknown): string[] {
  if (typeof selections === 'string') {
    const id = selections.trim();
    return id ? [id] : [];
  }
  if (Array.isArray(selections)) {
    return selections
      .map((entry) => {
        if (typeof entry === 'string') return entry.trim();
        if (entry && typeof entry === 'object') {
          return String((entry as any).id || (entry as any).optionId || (entry as any).value || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  }
  if (selections && typeof selections === 'object') {
    const record = selections as Record<string, unknown>;
    for (const key of ['selectedIds', 'selectedCardIds', 'selectedTargetIds', 'targets', 'selections']) {
      if (Array.isArray(record[key])) {
        return extractOracleIrSelectionIds(record[key]);
      }
    }
  }
  return [];
}

export function resumeOracleIRUnlessDiscardsFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    choice: 'discard' | 'decline';
    targetPlayerId?: PlayerID;
  },
): OracleIRExecutionResult {
  const choiceBinding = { unlessDiscardsChoice: params.choice };

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      selectorContext: choiceBinding,
      ...choiceBinding,
    },
    {
      targetPlayerId: params.targetPlayerId,
    },
  );

  return applyOracleIRStepsOnServer(
    ctx,
    (ctx as any).state,
    params.steps,
    irCtx,
    { allowOptional: false },
    {
      controller: params.controller,
      targetPlayerId: params.targetPlayerId,
    },
  );
}

export function resumeOracleIRUnlessPayFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    unlessPayKind: 'mana' | 'life';
    choice: 'pay' | 'decline';
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
    targetPermanentId?: string;
    unlessPaysManaAmount?: string;
  },
): OracleIRExecutionResult {
  const choiceBinding =
    params.unlessPayKind === 'mana'
      ? { unlessPaysManaChoice: params.choice as 'pay' | 'decline' }
      : { unlessPaysLifeChoice: params.choice as 'pay' | 'decline' };
  const amountBinding = params.unlessPaysManaAmount
    ? { unlessPaysManaAmount: params.unlessPaysManaAmount }
    : {};

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      targetPermanentId: params.targetPermanentId,
      selectorContext: {
        ...choiceBinding,
        ...amountBinding,
        ...(params.targetPermanentId ? { targetPermanentId: params.targetPermanentId } : {}),
      },
      ...choiceBinding,
      ...amountBinding,
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
    },
  );

  return applyOracleIRStepsOnServer(
    ctx,
    (ctx as any).state,
    params.steps,
    irCtx,
    { allowOptional: false },
    {
      controller: params.controller,
      targetPlayerId: params.targetPlayerId,
    },
  );
}

function bindChosenIdsToBattlefieldPermanentIds(state: any, chosenIds: readonly string[]): string[] {
  const wanted = new Set(chosenIds.map((id) => String(id || '').trim()).filter(Boolean));
  if (wanted.size === 0) return [];
  const resolved: string[] = [];
  const seen = new Set<string>();
  for (const perm of (state?.battlefield || []) as any[]) {
    const permanentId = String(perm?.id || '').trim();
    const cardId = String(perm?.card?.id || '').trim();
    if (!permanentId || seen.has(permanentId)) continue;
    if (!wanted.has(permanentId) && !wanted.has(cardId)) continue;
    seen.add(permanentId);
    resolved.push(permanentId);
  }
  return resolved;
}

export function resumeOracleIRRemainingStepsFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
    triggerItem?: any;
    chosenObjectIds?: readonly string[];
    selectorContext?: Record<string, unknown>;
    xValue?: number;
    energyPaidThisWay?: number;
    voteChoiceCounts?: Readonly<Record<string, number>>;
    winningVoteChoice?: string | null;
  },
): OracleIRExecutionResult | null {
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return null;
  }

  const state = (ctx as any).state;
  const continuationStepIndex = resolveOracleIrContinuationStepIndex(state);
  const chosenObjectIds = (params.chosenObjectIds || [])
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const boundBattlefieldIds = bindChosenIdsToBattlefieldPermanentIds(state, chosenObjectIds);
  const resumeChosenIds = boundBattlefieldIds.length > 0 ? boundBattlefieldIds : chosenObjectIds;
  const selectorContext = params.selectorContext
    ? {
        ...params.selectorContext,
        ...(resumeChosenIds.length > 0 ? { chosenObjectIds: resumeChosenIds } : {}),
      }
    : (resumeChosenIds.length > 0 ? { chosenObjectIds: resumeChosenIds } : undefined);
  const xValue = Number(params.xValue);
  const chosenNumber = Number((params.selectorContext as { chosenNumber?: number } | undefined)?.chosenNumber);

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      currentStepIndex: continuationStepIndex,
      stepLedger: readStepLedgerFromState(state),
      appliedStepKinds: readAppliedStepKindsFromState(state),
      ...(Number.isFinite(xValue) ? { xValue } : {}),
      ...(Number.isFinite(chosenNumber) ? { chosenNumber: Math.floor(chosenNumber) } : {}),
      ...(Number.isFinite(Number(params.energyPaidThisWay))
        ? { energyPaidThisWay: Math.max(0, Math.floor(Number(params.energyPaidThisWay))) }
        : {}),
      ...(selectorContext ? { selectorContext } : {}),
      ...(boundBattlefieldIds.length > 0 ? { lastMovedBattlefieldPermanentIds: boundBattlefieldIds } : {}),
      ...(params.voteChoiceCounts ? { voteChoiceCounts: params.voteChoiceCounts } : {}),
      ...(typeof params.winningVoteChoice !== 'undefined'
        ? { winningVoteChoice: params.winningVoteChoice }
        : {}),
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
      ...(resumeChosenIds.length > 0 ? { chosenObjectIds: resumeChosenIds } : {}),
      ...(params.voteChoiceCounts ? { voteChoiceCounts: params.voteChoiceCounts } : {}),
      ...(typeof params.winningVoteChoice !== 'undefined'
        ? { winningVoteChoice: params.winningVoteChoice }
        : {}),
    },
  );

  const controller = String(params.controller || '').trim() as PlayerID;
  if (!controller) {
    return null;
  }

  const handIdsBefore = new Set<string>(
    ((ctx as any).state?.zones?.[controller]?.hand || [])
      .map((card: any) => String(card?.id || '').trim())
      .filter(Boolean),
  );

  const optionalTriggerAccepted = params.triggerItem?.optionalTriggeredAbilityDecisionApplied === true;
  const result = applyOracleIRStepsOnServer(
    ctx,
    state,
    params.steps,
    irCtx,
    { allowOptional: optionalTriggerAccepted },
    {
      controller,
      targetPlayerId: params.targetPlayerId,
      triggerItem: params.triggerItem,
      compoundResume: true,
    },
  );

  if (result && !(ctx as any).isReplaying) {
    persistOracleIrCompoundDrawAfterResolution(ctx, {
      controller,
      result,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      handIdsBefore,
    });
  }

  return result;
}

export function resumeOracleIRStepWithChoiceFromResolution(
  ctx: GameContext,
  params: {
    controller: PlayerID;
    sourceId?: string;
    sourceName?: string;
    steps: readonly OracleEffectStep[];
    chosenObjectIds?: readonly string[];
    selectorContext?: Record<string, unknown>;
    targetPlayerId?: PlayerID;
    targetSpellId?: string;
    allowOptional?: boolean;
    xValue?: number;
    lastMovedCards?: readonly unknown[];
    lastMovedCountByPlayer?: Readonly<Record<string, number>>;
  },
): OracleIRExecutionResult | null {
  if (!Array.isArray(params.steps) || params.steps.length === 0) {
    return null;
  }

  const explicitObjectChoice = Array.isArray(params.chosenObjectIds)
    || Array.isArray(params.selectorContext?.chosenObjectIds);
  const chosenObjectIds = (
    params.chosenObjectIds
    ?? (Array.isArray(params.selectorContext?.chosenObjectIds)
      ? (params.selectorContext!.chosenObjectIds as readonly string[])
      : [])
  )
    .map((id) => String(id || '').trim())
    .filter(Boolean);
  const selectorContext = {
    ...(params.selectorContext || {}),
    ...(explicitObjectChoice ? { chosenObjectIds } : {}),
  };

  const state = (ctx as any).state;
  const choiceStepIndex = resolveOracleIrChoiceStepIndex(state);
  const xValue = Number(params.xValue);

  const irCtx = buildOracleIRExecutionContext(
    {
      controllerId: params.controller,
      sourceId: params.sourceId,
      sourceName: params.sourceName,
      targetSpellId: params.targetSpellId,
      currentStepIndex: choiceStepIndex,
      stepLedger: readStepLedgerFromState(state),
      appliedStepKinds: readAppliedStepKindsFromState(state),
      ...(Number.isFinite(xValue) ? { xValue } : {}),
      ...(typeof params.selectorContext?.targetPermanentId === 'string'
        ? { targetPermanentId: String(params.selectorContext.targetPermanentId) }
        : {}),
      ...(Array.isArray(params.lastMovedCards) && params.lastMovedCards.length > 0
        ? { lastMovedCards: params.lastMovedCards }
        : {}),
      ...(params.lastMovedCountByPlayer && Object.keys(params.lastMovedCountByPlayer).length > 0
        ? { lastMovedCountByPlayer: params.lastMovedCountByPlayer }
        : {}),
      selectorContext,
    },
    {
      targetPlayerId: params.targetPlayerId,
      targetSpellId: params.targetSpellId,
      targetPermanentId: typeof params.selectorContext?.targetPermanentId === 'string'
        ? String(params.selectorContext.targetPermanentId)
        : undefined,
      chosenObjectIds: explicitObjectChoice ? chosenObjectIds : (chosenObjectIds.length > 0 ? chosenObjectIds : undefined),
      ...(params.selectorContext || {}),
    },
  );

  return applyOracleIRStepsOnServer(
    ctx,
    state,
    params.steps,
    irCtx,
    { allowOptional: params.allowOptional === true },
    {
      controller: params.controller,
      targetPlayerId: params.targetPlayerId,
    },
  );
}

export function maybeApplyOracleIrChoiceStepFromResolution(
  ctx: GameContext,
  step: any,
  response: {
    readonly selections?: unknown;
    readonly cancelled?: boolean;
    readonly splitAssignments?: { toBattlefield?: string[]; toHand?: string[] };
  },
): OracleIRExecutionResult | null {
  if (response.cancelled) {
    return null;
  }
  // Optional pay-life / pay-mana prompts carry oracleIrChoiceStepJson for resume,
  // but the selection is pay/decline ? not an object choice.
  if (step?.optionalPaymentPrompt === true) {
    return null;
  }

  const warpWorldChoice = String(step?.oracleIrWarpWorldChoice || '').trim();
  if (
    warpWorldChoice === WARP_WORLD_CHOICE_COMMANDER
    || warpWorldChoice === WARP_WORLD_CHOICE_AURA
    || warpWorldChoice === WARP_WORLD_CHOICE_REMAINDER
  ) {
    const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
    if (!choiceJson) return null;
    let choiceSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(choiceJson);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      choiceSteps = parsed as OracleEffectStep[];
    } catch {
      return null;
    }
    const controller = String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID;
    if (!controller) return null;

    let selectorContext: Record<string, unknown> = {};
    if (warpWorldChoice === WARP_WORLD_CHOICE_COMMANDER) {
      const permanentId = String(step?.pendingCommanderPermanentId || '').trim();
      const choiceId = extractWarpWorldChoiceId(response.selections).toLowerCase();
      if (!permanentId || !choiceId) return null;
      const prior = parseJsonRecord(step?.oracleIrCommanderLibraryChoicesJson);
      prior[permanentId] = choiceId === 'library' || choiceId === 'stay' ? 'library' : 'command';
      selectorContext = { commanderLibraryChoices: prior };
    } else if (warpWorldChoice === WARP_WORLD_CHOICE_AURA) {
      const cardId = String(step?.pendingAuraCardId || '').trim();
      const attachId = extractWarpWorldChoiceId(response.selections);
      if (!cardId || !attachId) return null;
      const prior = parseJsonRecord(step?.oracleIrAuraAttachByCardIdJson);
      prior[cardId] = attachId;
      selectorContext = { auraAttachByCardId: prior };
    } else {
      const playerId = String(step?.pendingRemainderPlayerId || step?.playerId || '').trim();
      const bottomIds = extractBottomOrderIds(response.selections);
      if (!playerId || bottomIds.length === 0) return null;
      const prior = parseJsonArrayRecord(step?.oracleIrLibraryBottomOrderByPlayerJson);
      prior[playerId] = bottomIds;
      selectorContext = { libraryBottomOrderByPlayer: prior };
    }

    let lastMovedCards: unknown[] | undefined;
    try {
      const parsed = JSON.parse(String(step?.oracleIrLastMovedCardsJson || '[]'));
      if (Array.isArray(parsed) && parsed.length > 0) lastMovedCards = parsed;
    } catch {
      lastMovedCards = undefined;
    }
    let lastMovedCountByPlayer: Record<string, number> | undefined;
    try {
      const parsed = JSON.parse(String(step?.oracleIrLastMovedCountByPlayerJson || '{}'));
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const mapped: Record<string, number> = {};
        for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
          const amount = Number(value);
          if (!key.trim() || !Number.isFinite(amount)) continue;
          mapped[key] = amount;
        }
        if (Object.keys(mapped).length > 0) lastMovedCountByPlayer = mapped;
      }
    } catch {
      lastMovedCountByPlayer = undefined;
    }

    return resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller,
      sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
      sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
      steps: choiceSteps,
      selectorContext,
      ...(lastMovedCards ? { lastMovedCards } : {}),
      ...(lastMovedCountByPlayer ? { lastMovedCountByPlayer } : {}),
      ...(Number.isFinite(Number(step?.oracleIrXValue)) ? { xValue: Number(step.oracleIrXValue) } : {}),
    });
  }

  if (step?.coinIgnoreOneChoice === true) {
    const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
    if (!choiceJson) return null;
    let choiceSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(choiceJson);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      choiceSteps = parsed as OracleEffectStep[];
    } catch {
      return null;
    }
    const controller = String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID;
    if (!controller) return null;
    const keep = extractWarpWorldChoiceId(response.selections).toLowerCase();
    if (keep !== 'first' && keep !== 'second') return null;
    let priorKeeps: string[] = [];
    try {
      const parsed = JSON.parse(String(step?.coinIgnoreOneKeepChoicesJson || '[]'));
      if (Array.isArray(parsed)) priorKeeps = parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
    } catch {
      priorKeeps = [];
    }
    priorKeeps.push(keep);
    let rawFlips: string[] = [];
    try {
      const parsed = JSON.parse(String(step?.coinIgnoreOneRawFlipsJson || '[]'));
      if (Array.isArray(parsed)) rawFlips = parsed.map((entry) => String(entry || '').trim()).filter(Boolean);
    } catch {
      rawFlips = [];
    }
    return resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller,
      sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
      sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
      steps: choiceSteps,
      selectorContext: {
        coinIgnoreOneKeepChoices: priorKeeps,
        coinIgnoreOneRawFlips: rawFlips,
      },
    });
  }

  if (step?.oracleIrMoveZoneDestinationChoice === true) {
    const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
    if (!choiceJson) return null;

    let choiceSteps: OracleEffectStep[] = [];
    try {
      const parsed = JSON.parse(choiceJson);
      if (!Array.isArray(parsed) || parsed.length === 0) return null;
      choiceSteps = parsed as OracleEffectStep[];
    } catch {
      return null;
    }

    const destination = extractOracleIrSelectionIds(response.selections)[0] || '';
    if (!destination) return null;

    let priorChosenObjectIds: string[] = [];
    try {
      const parsedPrior = JSON.parse(String(step?.oracleIrPriorChosenObjectIdsJson || '[]'));
      if (Array.isArray(parsedPrior)) {
        priorChosenObjectIds = parsedPrior.map((id) => String(id || '').trim()).filter(Boolean);
      }
    } catch {
      priorChosenObjectIds = [];
    }

    const controller = String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID;
    const xValue = Number(step?.oracleIrXValue);

    return resumeOracleIRStepWithChoiceFromResolution(ctx, {
      controller,
      sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
      sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
      steps: choiceSteps,
      ...(priorChosenObjectIds.length > 0 ? { chosenObjectIds: priorChosenObjectIds } : {}),
      selectorContext: {
        moveZoneDestination: destination,
        ...(priorChosenObjectIds.length > 0 ? { chosenObjectIds: priorChosenObjectIds } : {}),
        ...(String(step?.oracleIrTargetPermanentId || '').trim()
          ? { targetPermanentId: String(step.oracleIrTargetPermanentId).trim() }
          : {}),
      },
      allowOptional: true,
      ...(Number.isFinite(xValue) ? { xValue } : {}),
    });
  }

  const choiceJson = String(step?.oracleIrChoiceStepJson || '').trim();
  if (!choiceJson) {
    return null;
  }

  let choiceSteps: OracleEffectStep[] = [];
  try {
    const parsed = JSON.parse(choiceJson);
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return null;
    }
    choiceSteps = parsed as OracleEffectStep[];
  } catch {
    return null;
  }

  const firstStep = choiceSteps[0];
  const playerChoiceKind = String(step?.oracleIrPlayerChoiceKind || (firstStep as any)?.choice || '').trim();
  const selectionIds = extractOracleIrSelectionIds(response.selections);
  const controller = String(step?.oracleIrControllerId || step?.playerId || '').trim() as PlayerID;
  const probeCtx = buildOracleIRExecutionContext({
    controllerId: controller,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    targetPermanentId: String(step?.oracleIrTargetPermanentId || '').trim() || undefined,
  });

  let chosenObjectIds: string[] | undefined;
  let selectorContext: Record<string, unknown> | undefined;
  let targetPermanentId: string | undefined = String(step?.oracleIrTargetPermanentId || '').trim() || undefined;

  if (firstStep?.kind === 'connive') {
    targetPermanentId = targetPermanentId
      || resolveBoundSelfOrSourceCreatureTargetId((ctx as any).state, (firstStep as any).target, probeCtx)
      || undefined;
  }

  if (firstStep?.kind === 'add_mana') {
    const selectionKind = String(step?.selectionKind || 'any_color');
    if (selectionKind === 'distribution') {
      const distribution = response.selections;
      if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
        return null;
      }
      const chosenMana = buildChosenManaFromDistribution(distribution as Record<string, unknown>);
      if (!chosenMana) {
        return null;
      }
      selectorContext = { chosenMana };
    } else {
      const poolKey = typeof response.selections === 'string'
        ? response.selections
        : selectionIds[0];
      const chosenMana = poolKeyToManaSymbol(String(poolKey || ''));
      if (!chosenMana) {
        return null;
      }
      selectorContext = { chosenMana };
    }
  } else if (
    firstStep?.kind === 'add_counter'
    && (
      (firstStep as any).distribution === 'among'
      || /^distribute\b/i.test(String((firstStep as any).raw || ''))
    )
    && response.selections
    && typeof response.selections === 'object'
    && !Array.isArray(response.selections)
  ) {
    const distribution = response.selections;
    if (!distribution || typeof distribution !== 'object' || Array.isArray(distribution)) {
      return null;
    }
    const counterDistributionByTargetId: Record<string, number> = {};
    for (const [targetId, amountRaw] of Object.entries(distribution as Record<string, unknown>)) {
      const amount = Number(amountRaw ?? 0);
      if (!Number.isFinite(amount) || amount <= 0) continue;
      counterDistributionByTargetId[String(targetId || '').trim()] = Math.floor(amount);
    }
    if (Object.keys(counterDistributionByTargetId).length === 0) {
      return null;
    }
    chosenObjectIds = Object.keys(counterDistributionByTargetId);
    selectorContext = { counterDistributionByTargetId, chosenObjectIds };
  } else if (firstStep?.kind === 'choose_pile' || playerChoiceKind === 'choose_pile') {
    const pileId = selectionIds[0] || '';
    if (!pileId) {
      return null;
    }
    selectorContext = { chosenPile: pileId, pileChoice: pileId };
  } else if (firstStep?.kind === 'change_target') {
    const phase = String(step?.oracleIrChangeTargetPhase || 'choose_spell').trim();
    if (phase === 'choose_new_target') {
      const chosenSpellId = String(step?.oracleIrTargetSpellId || '').trim();
      if (!chosenSpellId || selectionIds.length === 0) {
        return null;
      }
      chosenObjectIds = [chosenSpellId, ...selectionIds];
      selectorContext = { chosenSpellId, chosenObjectIds };
    } else if (selectionIds.length === 0) {
      return null;
    } else {
      chosenObjectIds = selectionIds;
      selectorContext = { chosenSpellId: selectionIds[0], chosenObjectIds: selectionIds };
    }
  } else if (firstStep?.kind === 'scry' || firstStep?.kind === 'surveil') {
    const orderingContext = extractOracleIrTopLibraryOrderingFromResponse(
      firstStep.kind,
      response.selections,
    );
    if (!orderingContext) {
      return null;
    }
    selectorContext = orderingContext;
  } else if (
    firstStep?.kind === 'connive'
    || firstStep?.kind === 'discard'
    || firstStep?.kind === 'sacrifice'
    || firstStep?.kind === 'search_library'
  ) {
    if (selectionIds.length === 0) {
      return null;
    }
    chosenObjectIds = selectionIds;
    const splitAssignments = (response as { splitAssignments?: { toBattlefield?: string[]; toHand?: string[] } }).splitAssignments;
    if (splitAssignments && typeof splitAssignments === 'object' && !Array.isArray(splitAssignments)) {
      selectorContext = { chosenObjectIds: selectionIds, splitAssignments };
    }
  } else if (firstStep?.kind === 'move_zone') {
    const minSelections = Number(step?.minSelections);
    const allowsEmpty = Number.isFinite(minSelections) && minSelections <= 0;
    if (selectionIds.length === 0 && !allowsEmpty) {
      return null;
    }
    chosenObjectIds = selectionIds;
    const splitAssignments = (response as { splitAssignments?: { toBattlefield?: string[]; toHand?: string[] } }).splitAssignments;
    selectorContext = {
      chosenObjectIds: selectionIds,
      ...(splitAssignments && typeof splitAssignments === 'object' && !Array.isArray(splitAssignments)
        ? { splitAssignments }
        : {}),
    };
  } else if (
    firstStep?.kind === 'redistribute_life_totals'
    && response.selections
    && typeof response.selections === 'object'
    && !Array.isArray(response.selections)
  ) {
    const payload = response.selections as Record<string, unknown>;
    const lifeByPlayerIdRaw = payload.lifeByPlayerId ?? payload;
    if (!lifeByPlayerIdRaw || typeof lifeByPlayerIdRaw !== 'object' || Array.isArray(lifeByPlayerIdRaw)) {
      return null;
    }
    const lifeRedistributionByPlayerId: Record<string, number> = {};
    for (const [playerId, amountRaw] of Object.entries(lifeByPlayerIdRaw as Record<string, unknown>)) {
      const normalizedId = String(playerId || '').trim();
      if (!normalizedId) continue;
      const amount = Number(amountRaw ?? NaN);
      if (!Number.isFinite(amount)) continue;
      lifeRedistributionByPlayerId[normalizedId] = Math.max(0, Math.floor(amount));
    }
    selectorContext = { lifeRedistributionByPlayerId };
  } else if (firstStep?.kind === 'player_choice' || playerChoiceKind) {
    const choiceId = selectionIds[0] || '';
    if (!choiceId) {
      return null;
    }
    if (playerChoiceKind === 'letter' || (firstStep as any)?.choice === 'letter') {
      selectorContext = { chosenLetter: choiceId.slice(0, 1) };
    } else if (playerChoiceKind === 'odd_even' || (firstStep as any)?.choice === 'odd_even') {
      const normalized = choiceId.toLowerCase();
      if (normalized !== 'odd' && normalized !== 'even') {
        return null;
      }
      selectorContext = { chosenOddEven: normalized };
    } else if (playerChoiceKind === 'card_type' || (firstStep as any)?.choice === 'card_type') {
      selectorContext = { chosenCreatureType: choiceId };
    } else if (selectionIds.length > 0) {
      chosenObjectIds = selectionIds;
      selectorContext = { chosenObjectIds: selectionIds };
    } else {
      chosenObjectIds = [choiceId];
      selectorContext = { chosenObjectIds: [choiceId] };
    }
  } else if (selectionIds.length > 0) {
    chosenObjectIds = selectionIds;
  } else {
    return null;
  }

  const mergedSelectorContext = {
    ...(selectorContext || {}),
    ...(targetPermanentId ? { targetPermanentId } : {}),
  };

  return resumeOracleIRStepWithChoiceFromResolution(ctx, {
    controller,
    sourceId: String(step?.oracleIrSourceId || step?.sourceId || '').trim() || undefined,
    sourceName: String(step?.oracleIrSourceName || step?.sourceName || '').trim() || undefined,
    steps: choiceSteps,
    ...(chosenObjectIds ? { chosenObjectIds } : {}),
    ...(Object.keys(mergedSelectorContext).length > 0 ? { selectorContext: mergedSelectorContext } : {}),
    ...(Number.isFinite(Number(step?.oracleIrXValue)) ? { xValue: Number(step.oracleIrXValue) } : {}),
    allowOptional:
      (firstStep as { optional?: boolean })?.optional === true
      || /^you may\b/i.test(String((firstStep as any)?.raw || '')),
  });
}


