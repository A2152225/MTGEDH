// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerExplorePopulateChangeTargetPrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueExploreChoicePromptsFromOracleIRResult,
//   queuePopulateChoicePromptsFromOracleIRResult, and
//   queueChangeTargetChoicePromptsFromOracleIRResult.
// Public entry symbols: queueExploreChoicePromptsFromOracleIRResult,
//   queuePopulateChoicePromptsFromOracleIRResult,
//   queueChangeTargetChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { buildExploreDecisionFromStep } from '../../../../../rules-engine/src/oracleIRExecutorPlayerStepHandlers.js';
import { buildPopulateTargetSelectionOptions } from '../../../../../rules-engine/src/oracleIRExecutorKeywordStepHandlers.js';
import { getExploreActionCount } from '../keywordActionRepetition.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

export function queueExploreChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'explore') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'explore') continue;

    const built = buildExploreDecisionFromStep(state, step, params.irCtx);
    if (!built) continue;

    const gapMetadata = (gap.metadata || {}) as Record<string, unknown>;
    const remainingPermanentIds = Array.isArray(gapMetadata.remainingPermanentIds)
      ? gapMetadata.remainingPermanentIds
          .map((id: unknown) => String(id || '').trim())
          .filter((id: string) => id.length > 0)
      : [];

    const skipReplacement = (step as any).skipExploreReplacement === true
      || (gap.metadata as any)?.skipExploreReplacement === true;
    const exploreController = String(built.playerId || params.controller || '');
    const actionCount = getExploreActionCount(state?.battlefield, exploreController, { skipReplacement });

    for (let actionIndex = 0; actionIndex < actionCount; actionIndex += 1) {
      const queueKey = `explore:${String((step as any).raw || '')}:${built.permanentId}:${actionIndex}`;
      if (queuedKeys.has(queueKey)) continue;
      queuedKeys.add(queueKey);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.EXPLORE_DECISION,
        playerId: built.playerId,
        description: actionCount > 1
          ? `${sourceName}: ${built.permanentName} explores (${actionIndex + 1}/${actionCount})`
          : `${sourceName}: ${built.permanentName} explores`,
        mandatory: (step as any).optional !== true,
        sourceId: built.permanentId,
        sourceName: built.permanentName,
        permanentId: built.permanentId,
        permanentName: built.permanentName,
        revealedCard: built.revealedCard,
        isLand: built.isLand,
        skipExploreReplacement: true,
        ...(remainingPermanentIds.length > 0 ? { remainingPermanentIds } : {}),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
      } as any, result, params) as any);
    }
  }
}

export function queuePopulateChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
    irCtx: OracleIRExecutionContext;
  }
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'populate') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'populate') continue;

    const built = buildPopulateTargetSelectionOptions(state, step, params.irCtx);
    if (!built || built.options.length <= 1) continue;

    const queueKey = `populate:${String((step as any).raw || '')}:${built.playerId}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: built.playerId,
      description: `${sourceName}: ${String((step as any).raw || 'Populate')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      validTargets: built.options,
      targetTypes: ['creature token'],
      minTargets: built.minTargets,
      maxTargets: built.maxTargets,
      targetDescription: String((step as any).raw || 'Choose a creature token to populate'),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

export function queueChangeTargetChoicePromptsFromOracleIRResult(
  ctx: GameContext,
  state: any,
  result: OracleIRExecutionResult,
  params: {
    controller: PlayerID;
    sourceName?: string;
    sourceId?: string;
  },
): void {
  const gameId = String((ctx as any).gameId || '').trim();
  if (!gameId || gameId === 'unknown' || (ctx as any).isReplaying) return;

  const sourceName = String(params.sourceName || 'Ability').trim() || 'Ability';
  const sourceId = String(params.sourceId || '').trim() || undefined;
  const queuedKeys = new Set<string>();

  for (const gap of result.automationGaps || []) {
    if (!isOracleIrPlayerChoiceGap(gap)) continue;
    if (String(gap.stepKind || '') !== 'change_target') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'change_target') continue;

    const metadata = (gap.metadata || {}) as Record<string, unknown>;
    const phase = String(metadata.changeTargetPhase || 'choose_spell').trim();
    const queueKey = `change_target:${phase}:${String((step as any).raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    if (phase === 'choose_new_target') {
      const chosenSpellId = String(metadata.chosenSpellId || '').trim();
      const candidateTargetIds = Array.isArray(metadata.candidateTargetIds)
        ? metadata.candidateTargetIds.map((id) => String(id || '').trim()).filter(Boolean)
        : [];
      const validTargets = (state.battlefield || [])
        .filter((perm: any) => candidateTargetIds.length === 0 || candidateTargetIds.includes(String(perm?.id || '')))
        .map((perm: any) => ({
          id: String(perm.id || ''),
          name: String(perm?.card?.name || perm?.name || 'Permanent'),
          type: 'permanent',
        }))
        .filter((target: any) => target.id);

      ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
        type: ResolutionStepType.TARGET_SELECTION,
        playerId: params.controller,
        description: `${sourceName}: ${String((step as any).raw || 'Choose a new target')}`,
        mandatory: (step as any).optional !== true,
        sourceId,
        sourceName,
        minTargets: 1,
        maxTargets: 1,
        validTargets,
        oracleIrChoiceStepJson: JSON.stringify([step]),
        oracleIrControllerId: params.controller,
        oracleIrSourceId: sourceId,
        oracleIrSourceName: sourceName,
        oracleIrChangeTargetPhase: 'choose_new_target',
        oracleIrTargetSpellId: chosenSpellId,
      } as any, result, params) as any);
      continue;
    }

    const candidateSpellIds = Array.isArray(metadata.candidateSpellIds)
      ? metadata.candidateSpellIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const stack = Array.isArray(state.stack) ? state.stack : [];
    const options = candidateSpellIds.map((spellId) => {
      const item = stack.find((entry: any) => String(entry?.id || '') === spellId);
      const name = String(item?.card?.name || item?.name || item?.sourceName || spellId);
      return { id: spellId, label: name };
    }).filter((option) => option.id);

    if (options.length === 0) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.OPTION_CHOICE,
      playerId: params.controller,
      description: `${sourceName}: ${String((step as any).raw || 'Choose a spell')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      options,
      minSelections: 1,
      maxSelections: 1,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
      oracleIrChangeTargetPhase: 'choose_spell',
    } as any, result, params) as any);
  }
}

