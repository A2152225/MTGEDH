// Origin: oracleIRExecutorConditionalStepSupport.ts
// Cluster: evaluateConditionalWrapperCondition “you control N or more [type]
//   with different names” (Maze's End activated win family). Generic — no
//   card-name routing. Reuses battlefield type matching already used by
//   intervening-if / you-control-N counts; uniqueness is the extra constraint.
// Public: tryEvaluateWinIfControlDifferentNames

import type { EvaluateConditionalWrapperConditionParams } from './oracleIRExecutorConditionalStepSupportHelpers.js';
import {
  battlefieldObjectHasType,
  parseSmallNumberWord,
} from './oracleIRExecutorConditionalStepSupportHelpers.js';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureStepUtils';

const CONTROL_N_DIFFERENT_NAMES =
  /^you control ([a-z0-9]+) or more ([a-z0-9' -]+?) with different names$/i;

function singularizeTypeName(typeName: string): string {
  const normalized = String(typeName || '').trim().toLowerCase();
  if (normalized.length > 1 && /s$/i.test(normalized) && !/ss$/i.test(normalized)) {
    return normalized.replace(/s$/i, '');
  }
  return normalized;
}

function permanentDisplayName(perm: any): string {
  return String(perm?.name || perm?.card?.name || '').trim().toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function permanentMatchesTypeName(perm: any, typeName: string): boolean {
  const needle = String(typeName || '').trim().toLowerCase();
  if (!needle) return false;
  if (battlefieldObjectHasType(perm, needle)) return true;
  const typeLine = [
    perm?.cardType,
    perm?.type_line,
    perm?.card?.type_line,
  ]
    .map((value) => String(value || '').toLowerCase())
    .filter(Boolean)
    .join(' ');
  if (typeLine && new RegExp(`\\b${escapeRegExp(needle)}\\b`, 'i').test(typeLine)) {
    return true;
  }
  const subtypeLists = [perm?.subtypes, perm?.card?.subtypes, perm?.types, perm?.card?.types];
  return subtypeLists.some((list) =>
    Array.isArray(list)
    && list.some((entry) => String(entry || '').trim().toLowerCase() === needle),
  );
}

function countControlledUniqueNamesMatchingType(
  battlefield: readonly any[],
  controllerId: string,
  typeName: string,
): number {
  const rawType = String(typeName || '').trim().toLowerCase();
  const singular = singularizeTypeName(rawType);
  const types = rawType === singular ? [rawType] : [rawType, singular];
  const names = new Set<string>();
  const controller = String(controllerId || '').trim();

  for (const perm of battlefield) {
    if (String(perm?.controller || '').trim() !== controller) continue;
    if (!types.some((type) => permanentMatchesTypeName(perm, type))) continue;
    const name = permanentDisplayName(perm);
    if (name) names.add(name);
  }
  return names.size;
}

export function tryEvaluateWinIfControlDifferentNames(
  params: EvaluateConditionalWrapperConditionParams,
): boolean | null | undefined {
  if (params.condition.kind !== 'if' && params.condition.kind !== 'as_long_as') {
    return undefined;
  }

  const raw = String(params.condition.raw || '').trim().toLowerCase();
  let normalizedRaw = raw.replace(/\u2019/g, "'").replace(/\s+/g, ' ').trim();
  if (normalizedRaw.startsWith('then ')) {
    normalizedRaw = normalizedRaw.replace(/^then\s+(?:if\s+)?/i, '').trim();
  }
  if (normalizedRaw.startsWith('if ')) {
    normalizedRaw = normalizedRaw.replace(/^if\s+/i, '').trim();
  }

  const match = normalizedRaw.match(CONTROL_N_DIFFERENT_NAMES);
  if (!match) return undefined;

  const threshold = parseSmallNumberWord(String(match[1] || ''));
  const typeName = String(match[2] || '').trim();
  if (threshold === null || !typeName) return undefined;

  const processed = getProcessedBattlefield(params.nextState) as any[];
  const rawBattlefield = Array.isArray((params.nextState as any)?.battlefield)
    ? (params.nextState as any).battlefield as any[]
    : [];
  const battlefield = rawBattlefield.length > 0 ? rawBattlefield : processed;
  const unique = countControlledUniqueNamesMatchingType(
    battlefield,
    String(params.controllerId || params.ctx.controllerId || '').trim(),
    typeName,
  );
  return unique >= threshold;
}
