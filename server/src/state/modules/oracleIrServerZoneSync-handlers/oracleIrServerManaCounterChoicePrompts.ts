// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerManaCounterChoicePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueAddManaChoicePromptsFromOracleIRResult,
//   queueAddCounterTargetSelectionPromptsFromOracleIRResult, and
//   queueCounterDistributionPromptsFromOracleIRResult, plus mana-symbol
//   and add-counter helpers they close over (including targetIdsKey).
// Public entry symbols: poolKeyToManaSymbol, buildChosenManaFromDistribution,
//   queueAddManaChoicePromptsFromOracleIRResult,
//   queueAddCounterTargetSelectionPromptsFromOracleIRResult,
//   queueCounterDistributionPromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolveOracleQuantity } from '../../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { parseSimplePermanentTypeFromText } from '../../../../../rules-engine/src/oracleIRExecutorBattlefieldParser.js';
import { hasExecutorClass } from '../../../../../rules-engine/src/oracleIRExecutorPermanentUtils.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

function manaSymbolToColorCode(symbol: string): string | null {
  const match = String(symbol || '').trim().match(/^\{?([WUBRG])\}?$/i);
  return match ? match[1]!.toUpperCase() : null;
}

export function poolKeyToManaSymbol(poolKey: string): string | null {
  const normalized = String(poolKey || '').trim().toLowerCase();
  const codeByPoolKey: Record<string, string> = {
    white: 'W',
    blue: 'U',
    black: 'B',
    red: 'R',
    green: 'G',
    colorless: 'C',
  };
  const code = codeByPoolKey[normalized] || (normalized.match(/^[wubrg]$/) ? normalized.toUpperCase() : '');
  return code ? `{${code}}` : null;
}

export function buildChosenManaFromDistribution(distribution: Record<string, unknown>): string {
  const parts: string[] = [];
  for (const [color, countRaw] of Object.entries(distribution)) {
    const count = Number(countRaw || 0);
    const code = String(color || '').trim().toUpperCase();
    if (!Number.isFinite(count) || count <= 0 || !/^[WUBRG]$/.test(code)) continue;
    for (let index = 0; index < count; index += 1) {
      parts.push(`{${code}}`);
    }
  }
  return parts.join('');
}

function buildAddManaColorSelectionPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'add_mana' }>,
  irCtx: OracleIRExecutionContext,
  params: { controller: PlayerID; sourceName: string; sourceId?: string },
): Record<string, unknown> | null {
  let allowedColors = Array.isArray(step.manaOptions)
    ? step.manaOptions.map(manaSymbolToColorCode).filter(Boolean) as string[]
    : [];
  if (allowedColors.length === 0 && step.requiresChosenMana) {
    allowedColors = ['W', 'U', 'B', 'R', 'G'];
  }
  if (allowedColors.length <= 1) {
    return null;
  }

  const playerIds = [...resolvePlayers(state, step.who, irCtx)];
  const playerId = playerIds[0] || params.controller;
  if (!playerId) return null;

  const rawText = String(step.raw || '').trim();
  const amount = resolveOracleQuantity(state, params.controller, step.amount as OracleQuantity, irCtx)
    ?? (step.amount?.kind === 'number' ? Math.max(0, Math.floor(step.amount.value)) : 1)
    ?? 1;
  const requiresCombinationChoice = /any combination of/i.test(rawText) && amount > 1;
  const requiresRepeatedSingleChoice = /any one color/i.test(rawText) && amount > 1;

  const base = {
    type: ResolutionStepType.MANA_COLOR_SELECTION,
    playerId,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    description: `${params.sourceName}: ${rawText || 'Choose a color'}`,
    mandatory: step.optional !== true,
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
    cardName: params.sourceName,
  };

  if (requiresCombinationChoice || requiresRepeatedSingleChoice) {
    return {
      ...base,
      selectionKind: 'distribution',
      totalAmount: amount,
      availableColors: allowedColors,
      allowedColors,
      amount,
    };
  }

  return {
    ...base,
    selectionKind: 'any_color',
    amount: Math.max(1, amount),
    allowedColors,
  };
}

export function queueAddManaChoicePromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'add_mana') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'add_mana') continue;

    const prompt = buildAddManaColorSelectionPrompt(
      state,
      step as Extract<OracleEffectStep, { kind: 'add_mana' }>,
      params.irCtx,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    const queueKey = `add_mana:${String((step as any).raw || '')}:${String(prompt.playerId || params.controller)}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
  }
}

const DISTRIBUTE_TARGET_WORD_TO_NUMBER: Record<string, number> = {
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
};

function parseAddCounterDistributeTargetBounds(targetText: string): { minTargets: number; maxTargets: number } {
  const normalized = String(targetText || '').trim().toLowerCase();
  const upToMatch = normalized.match(/\bup to (one|two|three|four|five|\d+)\b/i);
  if (upToMatch) {
    const token = String(upToMatch[1] || '').toLowerCase();
    const maxTargets = DISTRIBUTE_TARGET_WORD_TO_NUMBER[token] ?? Number.parseInt(token, 10);
    return {
      minTargets: 0,
      maxTargets: Number.isFinite(maxTargets) && maxTargets > 0 ? maxTargets : 1,
    };
  }

  const orListMatch = normalized.match(/\b(one|two|three|four|five|\d+)(?:,\s*(?:one|two|three|four|five|\d+))+\b/i);
  if (orListMatch) {
    const tokens = normalized.match(/\b(one|two|three|four|five|\d+)\b/gi) || [];
    const values = tokens
      .map((token) => DISTRIBUTE_TARGET_WORD_TO_NUMBER[String(token || '').toLowerCase()] ?? Number.parseInt(String(token || ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length > 0) {
      const maxTargets = Math.max(...values);
      return { minTargets: 0, maxTargets };
    }
  }

  return { minTargets: 1, maxTargets: 1 };
}

function buildAddCounterDistributeTargetSelectionOptions(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  controller: PlayerID,
): {
  options: Array<{ id: string; label: string; type: string }>;
  minTargets: number;
  maxTargets: number;
} | null {
  const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
  if (!targetText) return null;

  const { minTargets, maxTargets } = parseAddCounterDistributeTargetBounds(targetText);
  const requiredType = parseSimplePermanentTypeFromText(targetText) || 'creature';
  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];

  let controllerFilter: 'you' | 'opponent' | 'any' = 'any';
  if (/\byou control\b/i.test(targetText)) controllerFilter = 'you';
  if (/\b(?:an opponent|opponents?)\s+controls?\b/i.test(targetText)) controllerFilter = 'opponent';

  const options = battlefield
    .filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const permController = String(perm?.controller || '').trim();
      if (controllerFilter === 'you' && permController !== String(controller)) return false;
      if (controllerFilter === 'opponent' && permController === String(controller)) return false;
      if (requiredType === 'nonland_permanent') {
        return hasExecutorClass(perm, 'creature')
          || hasExecutorClass(perm, 'artifact')
          || hasExecutorClass(perm, 'enchantment')
          || hasExecutorClass(perm, 'planeswalker')
          || hasExecutorClass(perm, 'battle');
      }
      return hasExecutorClass(perm, requiredType as any);
    })
    .map((perm: any) => ({
      id: String(perm.id || ''),
      label: String(perm?.card?.name || perm?.name || 'Permanent').trim() || String(perm.id || ''),
      type: 'permanent',
    }))
    .filter((option) => option.id);

  if (options.length === 0) return null;

  return {
    options,
    minTargets: Math.min(minTargets, options.length),
    maxTargets: Math.min(maxTargets, options.length),
  };
}

export function queueAddCounterTargetSelectionPromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'add_counter') continue;
    if (gap.reasonCode !== 'no_deterministic_target') continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'add_counter') continue;

    const isDistributeAmong =
      (step as any).distribution === 'among'
      || /^distribute\b/i.test(String((step as any).raw || ''));
    if (!isDistributeAmong) continue;

    const built = buildAddCounterDistributeTargetSelectionOptions(
      state,
      step as Extract<OracleEffectStep, { kind: 'add_counter' }>,
      params.controller,
    );
    if (!built || built.options.length === 0) continue;

    const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
    const queueKey = `add_counter_target:${String((step as any).raw || '')}:${targetText}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TARGET_SELECTION,
      playerId: params.controller,
      description: `${sourceName}: ${String((step as any).raw || 'Choose targets')}`,
      mandatory: (step as any).optional !== true,
      sourceId,
      sourceName,
      validTargets: built.options,
      targetTypes: ['creature'],
      minTargets: built.minTargets,
      maxTargets: built.maxTargets,
      targetDescription: String((step.target as any)?.text || (step.target as any)?.raw || 'target creatures'),
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: params.controller,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

function buildCounterDistributionPrompt(
  state: any,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  gap: { readonly metadata?: Record<string, string | number | boolean | null | readonly string[]> },
  params: { controller: PlayerID; sourceName: string; sourceId?: string },
): Record<string, unknown> | null {
  const metadata = gap.metadata || {};
  const targetIds = Array.isArray(metadata.distributionTargetIds)
    ? metadata.distributionTargetIds.map((id) => String(id || '').trim()).filter(Boolean)
    : [];
  const totalAmount = Number(metadata.distributionTotalAmount ?? 0);
  const counterType = String(metadata.distributionCounterName || step.counter || '+1/+1').trim();
  if (targetIds.length <= 1 || totalAmount <= targetIds.length || !counterType) {
    return null;
  }

  const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
  const validTargets = targetIds.map((targetId) => {
    const permanent = battlefield.find((entry: any) => String(entry?.id || '').trim() === targetId);
    const name = String(permanent?.card?.name || permanent?.name || targetId).trim() || targetId;
    return {
      id: targetId,
      label: name,
      type: 'permanent',
    };
  });

  return {
    type: ResolutionStepType.COUNTER_DISTRIBUTION,
    playerId: params.controller,
    sourceId: params.sourceId,
    sourceName: params.sourceName,
    description: `${params.sourceName}: ${String(step.raw || 'Distribute counters among targets')}`,
    mandatory: step.optional !== true,
    counterType,
    totalAmount,
    minPerTarget: Math.max(1, Number(metadata.distributionMinPerTarget ?? 1)),
    validTargets,
    message: `Distribute ${totalAmount} ${counterType} counter(s). Each target must receive at least 1.`,
    oracleIrChoiceStepJson: JSON.stringify([step]),
    oracleIrControllerId: params.controller,
    oracleIrSourceId: params.sourceId,
    oracleIrSourceName: params.sourceName,
  };
}

export function queueCounterDistributionPromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'add_counter') continue;
    if (!Array.isArray(gap.metadata?.distributionTargetIds)) continue;

    const step = findSkippedOracleStep(result, gap);
    if (!step || step.kind !== 'add_counter') continue;

    const prompt = buildCounterDistributionPrompt(
      state,
      step as Extract<OracleEffectStep, { kind: 'add_counter' }>,
      gap,
      { controller: params.controller, sourceName, sourceId },
    );
    if (!prompt) continue;

    const queueKey = `counter_distribution:${String((step as any).raw || '')}:${targetIdsKey(gap.metadata?.distributionTargetIds)}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata(prompt, result, params) as any);
  }
}

function targetIdsKey(value: string | number | boolean | null | readonly string[] | undefined): string {
  if (!Array.isArray(value)) return '';
  return value.map((entry) => String(entry || '').trim()).filter(Boolean).join(',');
}

