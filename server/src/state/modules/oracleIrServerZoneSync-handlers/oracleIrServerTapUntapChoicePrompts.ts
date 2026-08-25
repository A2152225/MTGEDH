// server/src/state/modules/oracleIrServerZoneSync-handlers/oracleIrServerTapUntapChoicePrompts.ts
// Origin parent: server/src/state/modules/oracleIrServerZoneSync.ts
// Cluster moved: queueTapMatchingPermanentsChoicePromptsFromOracleIRResult and
//   queueTapOrUntapChoicePromptsFromOracleIRResult, plus the tap-filter helpers
//   they close over (inferTapUntapTargetFilter, resolveTapMatchingTargetCount,
//   inferTapMatchingPermanentFilter).
// Public entry symbols: queueTapMatchingPermanentsChoicePromptsFromOracleIRResult,
//   queueTapOrUntapChoicePromptsFromOracleIRResult.
// Called from applyOracleIRStepsOnServer in the parent; not part of the public API.

import type { PlayerID } from '../../../../../shared/src/index.js';
import type { OracleEffectStep, OracleQuantity } from '../../../../../rules-engine/src/oracleIR.js';
import type {
  OracleIRExecutionContext,
  OracleIRExecutionResult,
} from '../../../../../rules-engine/src/oracleIRExecutor.js';
import { resolvePlayers } from '../../../../../rules-engine/src/oracleIRExecutorPlayerUtils.js';
import { resolveOracleQuantity } from '../../../../../rules-engine/src/oracleIRExecutorResolveQuantity.js';
import { parseSimplePermanentTypeFromText } from '../../../../../rules-engine/src/oracleIRExecutorBattlefieldParser.js';
import { hasExecutorClass } from '../../../../../rules-engine/src/oracleIRExecutorPermanentUtils.js';
import type { GameContext } from '../../context.js';
import { ResolutionQueueManager, ResolutionStepType } from '../../resolution/index.js';
import {
  attachOracleIrResumeMetadata,
  findSkippedOracleStep,
  isOracleIrPlayerChoiceGap,
} from '../oracleIrServerPromptResumeUtils.js';

function inferTapUntapTargetFilter(
  targetText: string,
  controller: PlayerID,
): {
  types: string[];
  controller: 'you' | 'opponent' | 'any';
  targetCount: number;
} {
  const lower = String(targetText || '').trim().toLowerCase();
  const upToMatch = lower.match(/^up to (one|two|three|four|five|six|seven|eight|nine|ten|\d+)\s+(.+)$/i);
  const targetCount = upToMatch
    ? Math.max(1, Number.parseInt(String(upToMatch[1] || '1'), 10) || ({
      one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
    } as Record<string, number>)[String(upToMatch[1] || '').toLowerCase()] || 1)
    : 1;
  const typePhrase = upToMatch ? String(upToMatch[2] || '').trim() : lower;
  const requiredType = parseSimplePermanentTypeFromText(typePhrase) || 'creature';
  const types = requiredType === 'nonland_permanent'
    ? ['nonland_permanent']
    : [requiredType];
  let controllerFilter: 'you' | 'opponent' | 'any' = 'any';
  if (/\byou control\b/i.test(typePhrase)) controllerFilter = 'you';
  if (/\b(?:an opponent|opponents?)\s+controls?\b/i.test(typePhrase)) controllerFilter = 'opponent';
  if (/\btarget player controls\b/i.test(typePhrase)) controllerFilter = 'opponent';
  void controller;
  return { types, controller: controllerFilter, targetCount };
}

function resolveTapMatchingTargetCount(
  amount: OracleQuantity,
  irCtx?: OracleIRExecutionContext,
  state?: any,
  controllerId?: PlayerID,
): number {
  if (amount.kind === 'number') {
    return Math.max(1, Number(amount.value) || 1);
  }
  if (amount.kind === 'x') {
    const xValue = Number(irCtx?.xValue);
    return Number.isFinite(xValue) && xValue > 0 ? Math.max(1, Math.floor(xValue)) : 1;
  }
  if (state && controllerId && irCtx) {
    const resolved = resolveOracleQuantity(state, controllerId, amount, irCtx);
    if (resolved !== null && Number.isFinite(resolved)) return Math.max(1, Math.floor(resolved));
  }
  return 1;
}

function inferTapMatchingPermanentFilter(
  filterText: string,
  controller: PlayerID,
): {
  types: string[];
  requireAllTypes: boolean;
  controller: 'you' | 'opponent' | 'any';
  tapStatus: 'tapped' | 'untapped' | 'any';
} {
  const lower = String(filterText || '').trim().toLowerCase();
  let controllerFilter: 'you' | 'opponent' | 'any' = 'any';
  if (/\byou control\b/i.test(lower)) controllerFilter = 'you';
  void controller;

  let types: string[] = [];
  const requireAllTypes = false;
  if (/\bartifacts?\s+and\/or\s+creatures?\b/i.test(lower)) {
    types = ['artifact', 'creature'];
  } else {
    const simpleType = parseSimplePermanentTypeFromText(lower);
    if (simpleType === 'nonland_permanent') {
      types = ['nonland_permanent'];
    } else if (simpleType) {
      types = [simpleType];
    } else {
      types = ['creature'];
    }
  }

  const tapStatus: 'tapped' | 'untapped' | 'any' = /\buntapped\b/i.test(lower) ? 'untapped' : 'any';
  return { types, requireAllTypes, controller: controllerFilter, tapStatus };
}

export function queueTapMatchingPermanentsChoicePromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'tap_matching_permanents') continue;
    if (
      gap.reasonCode !== 'player_choice_required'
      && gap.reasonCode !== 'no_deterministic_target'
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'tap_matching_permanents' }> | undefined;
    if (!step || step.kind !== 'tap_matching_permanents') continue;

    const choosingPlayerId =
      resolvePlayers(state, (step as any).who, params.irCtx)[0] || params.controller;

    const targetCount = resolveTapMatchingTargetCount(step.amount, params.irCtx, state, choosingPlayerId);
    if (targetCount <= 1 && gap.reasonCode !== 'no_deterministic_target') continue;

    const queueKey = `tap_matching:${choosingPlayerId}:${String(step.filter || '')}:${String(step.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const { types, requireAllTypes, controller: controllerFilter, tapStatus } = inferTapMatchingPermanentFilter(
      String(step.filter || ''),
      choosingPlayerId,
    );
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const candidates = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const permController = String(perm?.controller || '').trim();
      if (controllerFilter === 'you' && permController !== String(choosingPlayerId)) return false;
      if (controllerFilter === 'opponent' && permController === String(choosingPlayerId)) return false;
      if (tapStatus === 'untapped' && perm?.tapped) return false;
      if (tapStatus === 'tapped' && !perm?.tapped) return false;
      if (types.length === 0) return true;
      const typeLine = String(perm?.card?.type_line || '').toLowerCase();
      if (types.includes('nonland_permanent')) {
        return hasExecutorClass(perm, 'creature')
          || hasExecutorClass(perm, 'artifact')
          || hasExecutorClass(perm, 'enchantment')
          || hasExecutorClass(perm, 'planeswalker')
          || hasExecutorClass(perm, 'battle');
      }
      return types.some((requiredType) => typeLine.includes(String(requiredType).toLowerCase()));
    });
    if (candidates.length < targetCount) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: choosingPlayerId,
      description: `${sourceName}: ${String(step.raw || 'Tap matching permanents').trim()}`,
      mandatory: true,
      sourceId,
      sourceName,
      action: 'tap',
      targetFilter: {
        types,
        requireAllTypes,
        controller: controllerFilter,
        tapStatus,
        excludeSource: false,
      },
      targetCount,
      title: sourceName,
      oracleIrChoiceStepJson: JSON.stringify([step]),
      oracleIrControllerId: choosingPlayerId,
      oracleIrSourceId: sourceId,
      oracleIrSourceName: sourceName,
    } as any, result, params) as any);
  }
}

export function queueTapOrUntapChoicePromptsFromOracleIRResult(
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
    if (String(gap.stepKind || '') !== 'tap_or_untap') continue;
    if (
      gap.reasonCode !== 'no_deterministic_target'
      && !isOracleIrPlayerChoiceGap(gap)
    ) {
      continue;
    }

    const step = findSkippedOracleStep(result, gap) as Extract<OracleEffectStep, { kind: 'tap_or_untap' }> | undefined;
    if (!step || step.kind !== 'tap_or_untap') continue;

    const targetText = String((step.target as any)?.text || (step.target as any)?.raw || '').trim();
    if (!targetText) continue;

    const queueKey = `tap_or_untap:${targetText}:${String(step.raw || '')}`;
    if (queuedKeys.has(queueKey)) continue;
    queuedKeys.add(queueKey);

    const { types, controller: controllerFilter, targetCount } = inferTapUntapTargetFilter(
      targetText,
      params.controller,
    );
    const action = step.mode === 'untap' ? 'untap' : 'tap';
    const battlefield = Array.isArray(state?.battlefield) ? state.battlefield : [];
    const candidates = battlefield.filter((perm: any) => {
      const permanentId = String(perm?.id || '').trim();
      if (!permanentId) return false;
      const permController = String(perm?.controller || '').trim();
      if (controllerFilter === 'you' && permController !== String(params.controller)) return false;
      if (controllerFilter === 'opponent' && permController === String(params.controller)) return false;
      const requiredType = types[0] || 'creature';
      if (requiredType === 'nonland_permanent') {
        return hasExecutorClass(perm, 'creature') || hasExecutorClass(perm, 'artifact') || hasExecutorClass(perm, 'enchantment') || hasExecutorClass(perm, 'planeswalker') || hasExecutorClass(perm, 'battle');
      }
      return hasExecutorClass(perm, requiredType as any);
    });
    if (candidates.length === 0) continue;

    ResolutionQueueManager.addStep(gameId, attachOracleIrResumeMetadata({
      type: ResolutionStepType.TAP_UNTAP_TARGET,
      playerId: params.controller,
      description: `${sourceName}: ${String(step.raw || targetText).trim()}`,
      mandatory: true,
      sourceId,
      sourceName,
      action,
      targetFilter: {
        types,
        controller: controllerFilter,
        tapStatus: 'any',
        excludeSource: false,
      },
      targetCount,
      title: sourceName,
    } as any, result, params) as any);
  }
}

