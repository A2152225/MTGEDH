// Extracted from oracleIRExecutorBattlefieldStepHandlers.ts.
// Cluster: normalizeWhereQualifiedTarget through tryApplyDistributeCountersAmong
// (add-counter targeting, zone-card counters, and distribute-among).
// Public entries: normalizeWhereQualifiedTarget, isContextualMovedCardReference,
// addCountersToZoneCardsById, tryApplyDistributeCountersAmong.

import type { GameState, PlayerID, BattlefieldPermanent } from '../../shared/src';
import type { OracleEffectStep, OracleObjectSelector } from './oracleIR';
import type { OracleIRExecutionContext } from './oracleIRExecutionTypes';
import type {
  BattlefieldStepHandlerResult,
  RecentBattlefieldRuntime,
} from './oracleIRExecutorBattlefieldStepTypes';
import { collectBoundBattlefieldIds } from './oracleIRExecutorBattlefieldBoundIds';
import { resolveAddCounterAmount } from './oracleIRExecutorBattlefieldAddCounterAmount';
import { DISTRIBUTE_WORD_TO_NUMBER } from './oracleIRExecutorBattlefieldDistributeWordToNumber';
import { parseSimplePermanentTypeFromText } from './oracleIRExecutorBattlefieldParser';
import { typeLineHasSubtype } from './oracleIRExecutorBattlefieldSubtypeUtils';
import { permanentMatchesType } from './oracleIRExecutorBattlefieldOps';
import { resolveCreatureTargetIds } from './oracleIRExecutorCreatureStepUtils';
import { getExecutorTypeLineLower } from './oracleIRExecutorPermanentUtils';

export function normalizeWhereQualifiedTarget(
  target: { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined
): { readonly kind: string; readonly text?: string; readonly raw?: string } | undefined {
  if (!target || target.kind !== 'raw') return target;
  const rawText = String((target as any).text || '').trim();
  if (!rawText) return target;
  const normalizedText = rawText
    .replace(/\s*,\s*where\s+x\s+is\s+.+$/i, '')
    .replace(/\s+equal\s+to\s+the\s+number\s+of\s+.+$/i, '')
    .replace(/\s+for each .+$/i, '')
    .replace(/^another\s+(target\s+.+)$/i, '$1')
    .trim();
  if (!normalizedText || normalizedText === rawText) return target;
  return {
    ...target,
    text: normalizedText,
  };
}

type ContextualBattlefieldReference =
  | { readonly mode: 'self' }
  | {
      readonly mode: 'contextual';
      readonly type: ReturnType<typeof parseSimplePermanentTypeFromText> extends infer T ? Exclude<T, null> : never;
      readonly tokenOnly?: boolean;
      readonly plural?: boolean;
      readonly subtype?: string;
    };

type CardZoneLocation = {
  readonly playerId: PlayerID;
  readonly zone: 'graveyard' | 'hand' | 'exile';
};

export function isContextualMovedCardReference(target: any): boolean {
  return (
    target.kind === 'raw' &&
    /^(?:it|that card|the exiled card|the exiled cards?)$/i.test(String((target as any).text || '').trim())
  );
}

export function addCountersToZoneCardsById(
  state: GameState,
  cardIds: readonly string[],
  counterName: string,
  amountValue: number
): { readonly state: GameState; readonly updatedCards: readonly any[]; readonly updatedCount: number } {
  const wantedIds = new Set(cardIds.map(id => String(id || '').trim()).filter(Boolean));
  if (wantedIds.size === 0) {
    return { state, updatedCards: [], updatedCount: 0 };
  }

  const updatedCards: any[] = [];
  let updatedCount = 0;

  const players = (state.players || []).map((player: any) => {
    let changed = false;

    const updateZone = (zoneName: 'graveyard' | 'hand' | 'exile' | 'library') => {
      const zone = Array.isArray(player?.[zoneName]) ? player[zoneName] : [];
      let zoneChanged = false;
      const nextZone = zone.map((card: any) => {
        const cardId = String(card?.id || '').trim();
        if (!cardId || !wantedIds.has(cardId)) return card;
        zoneChanged = true;
        updatedCount += 1;
        const counters = { ...((card?.counters || {}) as Record<string, number>) };
        const currentCount = Number(counters[counterName] ?? 0);
        counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
        const nextCard = { ...card, counters };
        updatedCards.push(nextCard);
        return nextCard;
      });
      if (!zoneChanged) return;
      changed = true;
      player = { ...player, [zoneName]: nextZone };
    };

    updateZone('graveyard');
    updateZone('hand');
    updateZone('exile');
    updateZone('library');

    return changed ? player : player;
  });

  const battlefield = Array.isArray((state as any).battlefield)
    ? ((state as any).battlefield as any[])
    : [];
  let battlefieldChanged = false;
  const nextBattlefield = battlefield.map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    if (!permanentId || !wantedIds.has(permanentId)) return perm;
    battlefieldChanged = true;
    updatedCount += 1;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters[counterName] ?? 0);
    counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + amountValue;
    const nextPermanent = { ...perm, counters };
    updatedCards.push(nextPermanent);
    return nextPermanent;
  });

  return {
    state: updatedCount > 0
      ? ({
          ...(state as any),
          players: players as any,
          ...(battlefieldChanged ? { battlefield: nextBattlefield as any } : {}),
        } as GameState)
      : state,
    updatedCards,
    updatedCount,
  };
}


function parseDistributeMaxTargets(targetText: string): number | undefined {
  const normalized = String(targetText || '').trim().toLowerCase();
  if (!normalized) return undefined;
  if (/any number of/i.test(normalized)) return undefined;

  const upToMatch = normalized.match(/\bup to (one|two|three|four|five|\d+)\b/i);
  if (upToMatch) {
    const token = String(upToMatch[1] || '').toLowerCase();
    return DISTRIBUTE_WORD_TO_NUMBER[token] ?? Number.parseInt(token, 10);
  }

  const orListMatch = normalized.match(/\b(one|two|three|four|five|\d+)(?:,\s*(?:one|two|three|four|five|\d+))+\b/i);
  if (orListMatch) {
    const tokens = normalized.match(/\b(one|two|three|four|five|\d+)\b/gi) || [];
    const values = tokens
      .map((token) => DISTRIBUTE_WORD_TO_NUMBER[String(token || '').toLowerCase()] ?? Number.parseInt(String(token || ''), 10))
      .filter((value) => Number.isFinite(value) && value > 0);
    if (values.length > 0) return Math.max(...values);
  }

  return undefined;
}

function splitCountersAcrossTargets(totalCounters: number, targetCount: number): number[] {
  if (targetCount <= 0 || totalCounters <= 0) return [];
  const counts = new Array(targetCount).fill(0);
  let remaining = totalCounters;
  let index = 0;
  while (remaining > 0) {
    counts[index % targetCount] += 1;
    remaining -= 1;
    index += 1;
  }
  return counts;
}

function distributeCountersNeedsPlayerChoice(totalCounters: number, targetCount: number): boolean {
  return targetCount > 1 && totalCounters > targetCount;
}

function applyCounterDistributionToBattlefield(
  state: GameState,
  targetIds: readonly string[],
  perTargetCounts: readonly number[],
  counterName: string,
): { state: GameState; log: readonly string[] } {
  const nextBattlefield = ((state.battlefield || []) as any[]).map((perm: any) => {
    const permanentId = String(perm?.id || '').trim();
    const targetIndex = targetIds.indexOf(permanentId);
    if (targetIndex < 0) return perm;
    const addAmount = perTargetCounts[targetIndex] ?? 0;
    if (addAmount <= 0) return perm;
    const counters = { ...((perm?.counters || {}) as Record<string, number>) };
    const currentCount = Number(counters[counterName] ?? 0);
    counters[counterName] = (Number.isFinite(currentCount) ? currentCount : 0) + addAmount;
    return { ...perm, counters };
  });

  const totalApplied = perTargetCounts.reduce((sum, value) => sum + value, 0);
  return {
    state: { ...(state as any), battlefield: nextBattlefield } as GameState,
    log: [`Distributed ${totalApplied} ${counterName} counter(s) among ${targetIds.length} permanent(s)`],
  };
}

function resolveCounterDistributionCounts(
  totalCounters: number,
  targetIds: readonly string[],
  ctx: OracleIRExecutionContext,
): number[] | null {
  const rawDistribution = (ctx.selectorContext as any)?.counterDistributionByTargetId;
  if (!rawDistribution || typeof rawDistribution !== 'object' || Array.isArray(rawDistribution)) {
    return null;
  }

  const counts = targetIds.map((targetId) => {
    const amount = Number((rawDistribution as Record<string, unknown>)[targetId] ?? 0);
    return Number.isFinite(amount) ? Math.max(0, Math.floor(amount)) : 0;
  });
  const totalDistributed = counts.reduce((sum, value) => sum + value, 0);
  if (totalDistributed !== totalCounters) {
    return null;
  }
  if (counts.some((value) => value <= 0)) {
    return null;
  }
  return counts;
}

function resolveDistributeAmongTargetIds(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext,
  normalizedTarget: OracleObjectSelector | undefined,
): string[] {
  const stepTargetText = step.target?.kind === 'raw' ? step.target.text : '';
  const targetText = String(
    normalizedTarget?.kind === 'raw' ? normalizedTarget.text : stepTargetText
  )
    .replace(/,\s*where x is\b.*$/i, '')
    .trim()
    .toLowerCase();
  const maxTargets = parseDistributeMaxTargets(targetText);
  const battlefield = ((state.battlefield || []) as BattlefieldPermanent[]);
  const controllerId = String(ctx.controllerId || '').trim();
  const sourceId = String(ctx.sourceId || '').trim();

  const boundIds = collectBoundBattlefieldIds(ctx).filter((id) =>
    battlefield.some((perm: any) => String(perm?.id || '').trim() === id),
  );

  if (/other target creatures you control/i.test(targetText)) {
    return resolveCreatureTargetIds(state, normalizedTarget as any, ctx);
  }

  if (/it and any number of commanders/i.test(targetText)) {
    const compoundIds: string[] = [];
    if (sourceId && battlefield.some((perm: any) => String(perm?.id || '').trim() === sourceId)) {
      compoundIds.push(sourceId);
    }
    for (const perm of battlefield) {
      const permanentId = String((perm as any)?.id || '').trim();
      if (!permanentId || permanentId === sourceId) continue;
      if (String((perm as any)?.controller || '').trim() !== controllerId) continue;
      const isCommander =
        Boolean((perm as any)?.isCommander) ||
        /\bcommander\b/i.test(getExecutorTypeLineLower(perm));
      if (isCommander) compoundIds.push(permanentId);
    }
    for (const boundId of boundIds) {
      if (!compoundIds.includes(boundId)) {
        const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === boundId);
        if (
          perm &&
          (Boolean((perm as any)?.isCommander) ||
            /\bcommander\b/i.test(getExecutorTypeLineLower(perm)))
        ) {
          compoundIds.push(boundId);
        }
      }
    }
    return Array.from(new Set(compoundIds));
  }

  if (/target elves/i.test(targetText)) {
    const controlledElfIds = battlefield
      .filter((perm: any) => String(perm?.controller || '').trim() === controllerId)
      .filter((perm: any) => typeLineHasSubtype(perm, 'elf'))
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
    const elfPool = boundIds.length > 0 ? boundIds : controlledElfIds;
    let elfIds = elfPool.filter((id) => {
      const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
      return perm ? typeLineHasSubtype(perm, 'elf') : false;
    });
    if (elfIds.length === 0 && boundIds.length > 0) {
      elfIds = controlledElfIds;
    }
    if (Number.isFinite(maxTargets) && (maxTargets as number) > 0) {
      return Array.from(new Set(elfIds.slice(0, maxTargets as number)));
    }
    return Array.from(new Set(elfIds));
  }

  let candidateIds = boundIds.filter((id) => {
    const perm = battlefield.find((entry: any) => String(entry?.id || '').trim() === id);
    return perm ? permanentMatchesType(perm, 'creature') : false;
  });

  if (candidateIds.length === 0 && /creatures you control/i.test(targetText)) {
    candidateIds = battlefield
      .filter((perm: any) => String(perm?.controller || '').trim() === controllerId)
      .filter((perm: any) => permanentMatchesType(perm, 'creature'))
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
  }

  if (
    candidateIds.length === 0 &&
    /tapped creatures(?: your)? opponents control/i.test(targetText)
  ) {
    candidateIds = battlefield
      .filter((perm: any) => String(perm?.controller || '').trim() !== controllerId)
      .filter((perm: any) => permanentMatchesType(perm, 'creature'))
      .filter((perm: any) => Boolean((perm as any)?.tapped))
      .map((perm: any) => String(perm?.id || '').trim())
      .filter(Boolean);
  }

  if (candidateIds.length === 0 && boundIds.length > 0) {
    candidateIds = boundIds;
  }

  if (Number.isFinite(maxTargets) && (maxTargets as number) > 0) {
    candidateIds = candidateIds.slice(0, maxTargets as number);
  }

  return Array.from(new Set(candidateIds));
}

export function tryApplyDistributeCountersAmong(
  state: GameState,
  step: Extract<OracleEffectStep, { kind: 'add_counter' }>,
  ctx: OracleIRExecutionContext,
  runtime?: RecentBattlefieldRuntime,
): BattlefieldStepHandlerResult | null {
  const raw = String(step.raw || '').trim();
  const isDistributeAmong =
    step.distribution === 'among' || /^distribute\b/i.test(raw);
  if (!isDistributeAmong) return null;

  const amountValue = resolveAddCounterAmount(state, step, ctx, runtime);
  if (amountValue === null || amountValue <= 0) {
    return {
      applied: false,
      message: `Skipped distribute counters (unsupported amount): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const counterName = String(step.counter || '').trim() || (/\+1\/\+1/i.test(raw) ? '+1/+1' : '');
  if (!counterName) {
    return {
      applied: false,
      message: `Skipped distribute counters (unsupported counter): ${step.raw}`,
      reason: 'unsupported_target',
    };
  }

  const normalizedTarget = normalizeWhereQualifiedTarget(step.target as any);
  const targetIds = resolveDistributeAmongTargetIds(state, step, ctx, normalizedTarget as any);
  if (targetIds.length === 0) {
    return {
      applied: false,
      message: `Skipped distribute counters (no deterministic target): ${step.raw}`,
      reason: 'no_deterministic_target',
    };
  }

  const preselectedCounts = resolveCounterDistributionCounts(amountValue, targetIds, ctx);
  if (preselectedCounts) {
    const applied = applyCounterDistributionToBattlefield(state, targetIds, preselectedCounts, counterName);
    return {
      applied: true,
      state: applied.state,
      log: applied.log,
      lastMovedBattlefieldPermanentIds: targetIds,
    };
  }

  if (
    distributeCountersNeedsPlayerChoice(amountValue, targetIds.length)
    && ctx.interactivePlayerChoices !== false
  ) {
    return {
      applied: false,
      message: `Counter distribution choice required: ${step.raw}`,
      reason: 'player_choice_required',
      options: {
        classification: 'player_choice',
        metadata: {
          distributionTargetIds: targetIds,
          distributionTotalAmount: amountValue,
          distributionCounterName: counterName,
          distributionMinPerTarget: 1,
        },
      },
    };
  }

  const perTargetCounts = splitCountersAcrossTargets(amountValue, targetIds.length);
  const applied = applyCounterDistributionToBattlefield(state, targetIds, perTargetCounts, counterName);
  return {
    applied: true,
    state: applied.state,
    log: applied.log,
    lastMovedBattlefieldPermanentIds: targetIds,
  };
}

