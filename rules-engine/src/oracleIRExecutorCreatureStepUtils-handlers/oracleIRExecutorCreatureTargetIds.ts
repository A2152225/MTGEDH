/**
 * Origin parent: oracleIRExecutorCreatureStepUtils.ts
 * Cluster moved: resolveCreatureTargetIds plus exclusive controlled-qualifier helpers
 * Public: resolveCreatureTargetIds
 */

import type { BattlefieldPermanent, GameState } from '../../../shared/src';
import type { OracleObjectSelector } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { getCounterCountOnObject } from '../oracleIRExecutorModifyPtWhereUtils';
import { getExecutorTypeLineLower, isExecutorCreature } from '../oracleIRExecutorPermanentUtils';
import { normalizeOracleText } from '../oracleIRExecutorPlayerUtils';
import {
  isAttackingPermanent,
  isUnblockedAttackingPermanent,
  permanentHasKeyword,
  readPowerForComparison,
  readToughnessForComparison,
  resolveBlockersOfPermanent,
  resolveBlockingCreatureIds,
} from './oracleIRExecutorCreatureBattlefieldHelpers';
import {
  getProcessedBattlefield,
  permanentHasSubtype,
} from './oracleIRExecutorCreatureBattlefieldLookup';
import { resolveSingleCreatureTargetId } from './oracleIRExecutorCreatureSingleTarget';

function permanentMatchesControlledQualifier(
  permanent: BattlefieldPermanent | undefined,
  qualifierRaw: string,
): boolean {
  if (!permanent) return false;
  const qualifier = String(qualifierRaw || '').trim().toLowerCase();
  if (qualifier === 'flying') return permanentHasKeyword(permanent, 'flying');
  if (qualifier === 'defender') {
    return (
      /\bdefender\b/i.test(getExecutorTypeLineLower(permanent))
      || permanentHasKeyword(permanent, 'defender')
    );
  }
  if (/^a \+1\/\+1 counter on it$/.test(qualifier)) {
    return (getCounterCountOnObject(permanent, '+1/+1') ?? 0) > 0;
  }
  if (/^a counter on it$/.test(qualifier)) {
    const counters = (permanent as any)?.counters;
    if (!counters) return false;
    if (typeof counters === 'object' && !Array.isArray(counters)) {
      return Object.values(counters as Record<string, number>).some((count) => Number(count) > 0);
    }
    return Array.isArray(counters) && counters.length > 0;
  }
  const powerAtLeast = qualifier.match(/^power (\d+) or greater$/);
  if (powerAtLeast) {
    return (readPowerForComparison(permanent) ?? 0) >= Number(powerAtLeast[1] || 0);
  }
  const powerAtMost = qualifier.match(/^power (\d+) or less$/);
  if (powerAtMost) {
    return (readPowerForComparison(permanent) ?? 0) <= Number(powerAtMost[1] || 0);
  }
  const toughnessAtLeast = qualifier.match(/^toughness (\d+) or greater$/);
  if (toughnessAtLeast) {
    return (readToughnessForComparison(permanent) ?? 0) >= Number(toughnessAtLeast[1] || 0);
  }
  const basePtMatch = qualifier.match(/^base power and toughness (\d+)\/(\d+)$/);
  if (basePtMatch) {
    const wantPower = Number(basePtMatch[1] || 0);
    const wantToughness = Number(basePtMatch[2] || 0);
    const basePower = readBaseStatForQualifier(permanent, 'power');
    const baseToughness = readBaseStatForQualifier(permanent, 'toughness');
    return basePower === wantPower && baseToughness === wantToughness;
  }
  return permanentHasSubtype(permanent, qualifier) || permanentHasKeyword(permanent, qualifier);
}

function readBaseStatForQualifier(permanent: BattlefieldPermanent | undefined, which: 'power' | 'toughness'): number | null {
  if (!permanent) return null;
  const values = which === 'power'
    ? [(permanent as any)?.basePower, (permanent as any)?.card?.power, (permanent as any)?.power]
    : [(permanent as any)?.baseToughness, (permanent as any)?.card?.toughness, (permanent as any)?.toughness];
  for (const value of values) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function resolveCreatureTargetIds(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string[] {
  const singleTargetId = resolveSingleCreatureTargetId(state, target, ctx);
  if (singleTargetId) return [singleTargetId];

  if (target.kind !== 'raw') return [];

  let targetText = normalizeOracleText(target.text)
    .replace(/^until end of (?:turn|combat),\s*/i, '');
  const creatureGetsMatch = targetText.match(/^(that creature|the creature)\s+gets\b/i);
  if (creatureGetsMatch) {
    targetText = creatureGetsMatch[1].toLowerCase();
  }
  const sourceId = String(ctx.sourceId || '').trim();
  const battlefield = getProcessedBattlefield(state).filter(permanent => isExecutorCreature(permanent));
  const controllerId = String(ctx.controllerId || '').trim();

  if (targetText === 'that creature' || targetText === 'the creature') {
    const preferredIds = [
      String(ctx.targetCreatureId || ''),
      String(ctx.targetPermanentId || ''),
      String(ctx.lastReferencedPermanentId || ''),
      ...(Array.isArray(ctx.lastMovedBattlefieldPermanentIds) ? ctx.lastMovedBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds) ? ctx.lastAntecedentBattlefieldPermanentIds : []),
      ...(Array.isArray(ctx.selectorContext?.chosenObjectIds) ? ctx.selectorContext.chosenObjectIds : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    for (const preferredId of preferredIds) {
      if (battlefield.some((permanent) => String((permanent as any)?.id || '').trim() === preferredId)) {
        return [preferredId];
      }
    }
  }

  const controlledBy = (playerId: string): string[] =>
    battlefield
      .filter(permanent => String((permanent as any)?.controller || '').trim() === playerId)
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);

  const chosenCreatureTargetIds = (): string[] => {
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    if (chosenIds.length === 0) return [];
    const chosenSet = new Set(chosenIds);
    return battlefield
      .filter((permanent) => chosenSet.has(String((permanent as any)?.id || '').trim()))
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  };

  if (
    /^one or two target creatures$/i.test(targetText) ||
    /^(?:one|two|three|four|five|\d+) target creatures$/i.test(targetText) ||
    /^up to (?:one|two|three|four|five|\d+) target creatures$/i.test(targetText) ||
    /^any number of target creatures(?: each)?$/i.test(targetText)
  ) {
    return chosenCreatureTargetIds();
  }

  if (
    targetText === 'each other attacking creature'
    || targetText === 'other attacking creatures'
    || targetText === 'other attacking creatures you control'
  ) {
    return battlefield
      .filter(permanent => {
        const permanentId = String((permanent as any)?.id || '').trim();
        if (!permanentId || permanentId === sourceId) return false;
        if (targetText === 'other attacking creatures you control') {
          return String((permanent as any)?.controller || '').trim() === controllerId
            && isAttackingPermanent(permanent);
        }
        return isAttackingPermanent(permanent);
      })
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  const attackingKeywordMatch = targetText.match(/^all attacking creatures with (.+)$/i);
  if (attackingKeywordMatch) {
    const requiredKeyword = String(attackingKeywordMatch[1] || '').trim();
    return battlefield
      .filter(permanent => isAttackingPermanent(permanent) && permanentHasKeyword(permanent, requiredKeyword))
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'unblocked attacking creatures') {
    return battlefield
      .filter(permanent => isUnblockedAttackingPermanent(permanent))
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'creatures you control' || targetText === 'all creatures you control') {
    return controlledBy(controllerId);
  }

  if (targetText === 'each creature you control') {
    return controlledBy(controllerId);
  }

  if (
    targetText === 'creatures you control of the chosen type'
    || targetText === 'each creature you control of the chosen type'
  ) {
    const chosenType = String(
      ctx.selectorContext?.chosenCreatureType || ctx.chosenCreatureType || '',
    ).trim().toLowerCase();
    if (!chosenType) return [];
    return controlledBy(controllerId).filter((permanentId) => {
      const permanent = battlefield.find((entry) => String((entry as any)?.id || '').trim() === permanentId);
      return permanent ? permanentHasSubtype(permanent, chosenType) : false;
    });
  }

  if (
    targetText === 'other creatures you control'
    || targetText === 'all other creatures you control'
  ) {
    return controlledBy(controllerId).filter((permanentId) => permanentId !== sourceId);
  }

  const otherTypedTeamMatch = targetText.match(/^other ([a-z][a-z -]*?) you control$/i);
  if (otherTypedTeamMatch) {
    const subtype = String(otherTypedTeamMatch[1] || '').trim().toLowerCase();
    return controlledBy(controllerId)
      .filter((permanentId) => permanentId !== sourceId)
      .filter((permanentId) => {
        const permanent = battlefield.find((entry) => String((entry as any)?.id || '').trim() === permanentId);
        return permanent ? permanentHasSubtype(permanent, subtype) : false;
      });
  }

  if (targetText === 'all other creatures') {
    return battlefield
      .filter((permanent) => String((permanent as any)?.id || '').trim() !== sourceId)
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (
    targetText === 'each other creature you control'
    || targetText === 'each other creature'
  ) {
    return controlledBy(controllerId).filter((permanentId) => permanentId !== sourceId);
  }

  if (/^(?:each of )?those creatures$/i.test(targetText)) {
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
        ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
        : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (antecedentIds.length === 0) return [];
    const antecedentSet = new Set(antecedentIds);
    return battlefield
      .filter((permanent) => antecedentSet.has(String((permanent as any)?.id || '').trim()))
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'each of them' || targetText === 'they' || targetText === 'them') {
    const antecedentIds = [
      ...(Array.isArray(ctx.lastAntecedentBattlefieldPermanentIds)
        ? ctx.lastAntecedentBattlefieldPermanentIds
        : []),
      ...(Array.isArray(ctx.selectorContext?.lastAntecedentBattlefieldPermanentIds)
        ? ctx.selectorContext.lastAntecedentBattlefieldPermanentIds
        : []),
    ]
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    if (antecedentIds.length === 0) return [];
    const antecedentSet = new Set(antecedentIds);
    return battlefield
      .filter((permanent) => antecedentSet.has(String((permanent as any)?.id || '').trim()))
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'each creature') {
    return battlefield
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (
    targetText === "each opponent's creatures"
    || targetText === 'each opponents creatures'
  ) {
    return battlefield
      .filter((permanent) => String((permanent as any)?.controller || '').trim() !== controllerId)
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (
    targetText === 'each creature blocking it'
    || targetText === 'each creature blocking this creature'
  ) {
    if (!sourceId) return [];
    return resolveBlockersOfPermanent(state, sourceId);
  }

  if (targetText === 'creatures your opponents control' || targetText === 'all creatures your opponents control') {
    return battlefield
      .filter(permanent => String((permanent as any)?.controller || '').trim() !== controllerId)
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (
    targetText === 'each creature an opponent controls'
    || targetText === 'each creature your opponents control'
  ) {
    return battlefield
      .filter((permanent) => String((permanent as any)?.controller || '').trim() !== controllerId)
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (
    targetText === "each creature you don't control"
    || targetText === 'each creature you dont control'
    || targetText === "all creatures you don't control"
    || targetText === 'all creatures you dont control'
  ) {
    return battlefield
      .filter((permanent) => String((permanent as any)?.controller || '').trim() !== controllerId)
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'blocking creatures') {
    return resolveBlockingCreatureIds(state);
  }

  if (targetText === 'nonartifact creatures') {
    return battlefield
      .filter((permanent) =>
        isExecutorCreature(permanent)
        && !/\bartifact\b/i.test(getExecutorTypeLineLower(permanent)),
      )
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'other target creatures you control') {
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    const chosenSet = new Set(chosenIds);
    return controlledBy(controllerId)
      .filter((permanentId) => permanentId !== sourceId && chosenSet.has(permanentId));
  }

  if (targetText === 'all creatures') {
    return battlefield
      .map(permanent => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || ctx.targetPlayerId || '').trim();
  if (
    targetPlayerId
    && (
      targetText === 'creatures target player controls'
      || targetText === 'each creature target player controls'
      || targetText === 'creatures that player controls'
      || targetText === 'each creature that player controls'
    )
  ) {
    return controlledBy(targetPlayerId);
  }

  const controlledCreatureIds = controlledBy(controllerId);
  const findControlledCreature = (permanentId: string) =>
    battlefield.find((entry) => String((entry as any)?.id || '').trim() === permanentId);

  if (
    targetText === 'attacking creatures you control'
    || targetText === 'each attacking creature you control'
  ) {
    return battlefield
      .filter(
        (permanent) =>
          String((permanent as any)?.controller || '').trim() === controllerId
          && isAttackingPermanent(permanent),
      )
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  if (targetText === 'creature tokens you control') {
    return battlefield
      .filter(
        (permanent) =>
          String((permanent as any)?.controller || '').trim() === controllerId
          && (
            Boolean((permanent as any)?.isToken)
            || /\btoken\b/i.test(getExecutorTypeLineLower(permanent))
          ),
      )
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter(Boolean);
  }

  const eachWithQualifierMatch = targetText.match(/^each creature you control with (.+)$/i);
  if (eachWithQualifierMatch) {
    const qualifier = String(eachWithQualifierMatch[1] || '').trim();
    return controlledCreatureIds.filter((permanentId) =>
      permanentMatchesControlledQualifier(findControlledCreature(permanentId), qualifier),
    );
  }

  const eachOtherWithQualifierMatch = targetText.match(/^each other creature you control with (.+)$/i);
  if (eachOtherWithQualifierMatch) {
    const qualifier = String(eachOtherWithQualifierMatch[1] || '').trim();
    return controlledCreatureIds
      .filter((permanentId) => permanentId !== sourceId)
      .filter((permanentId) =>
        permanentMatchesControlledQualifier(findControlledCreature(permanentId), qualifier),
      );
  }

  const eachGlobalWithQualifierMatch = targetText.match(/^each creature with (.+)$/i);
  if (eachGlobalWithQualifierMatch) {
    const qualifier = String(eachGlobalWithQualifierMatch[1] || '').trim();
    return battlefield
      .map((permanent) => String((permanent as any)?.id || '').trim())
      .filter((permanentId) => {
        const permanent = battlefield.find((entry) => String((entry as any)?.id || '').trim() === permanentId);
        return permanentMatchesControlledQualifier(permanent, qualifier);
      });
  }

  if (targetText === 'creatures you control without flying') {
    return controlledCreatureIds.filter((permanentId) => {
      const permanent = findControlledCreature(permanentId);
      return permanent ? !permanentHasKeyword(permanent, 'flying') : false;
    });
  }

  const withQualifierMatch = targetText.match(/^creatures you control with (.+)$/i);
  if (withQualifierMatch) {
    const qualifier = String(withQualifierMatch[1] || '').trim();
    return controlledCreatureIds.filter((permanentId) =>
      permanentMatchesControlledQualifier(findControlledCreature(permanentId), qualifier),
    );
  }

  const nonColorMatch = targetText.match(/^non-(white|blue|black|red|green) creatures you control$/i);
  if (nonColorMatch) {
    const excludedColor = String(nonColorMatch[1] || '').trim().toLowerCase();
    const colorLetter = ({ white: 'W', blue: 'U', black: 'B', red: 'R', green: 'G' } as const)[
      excludedColor as 'white' | 'blue' | 'black' | 'red' | 'green'
    ];
    if (!colorLetter) return [];
    return controlledCreatureIds.filter((permanentId) => {
      const permanent = findControlledCreature(permanentId) as any;
      if (!permanent) return false;
      const colors = Array.isArray(permanent?.colors)
        ? permanent.colors
        : Array.isArray(permanent?.card?.colors)
          ? permanent.card.colors
          : [];
      return !colors
        .map((color: unknown) => String(color || '').trim().toUpperCase())
        .includes(colorLetter);
    });
  }

  const subtypeCreaturesMatch = targetText.match(/^([a-z][a-z -]+) creatures you control$/i);
  if (subtypeCreaturesMatch) {
    const subtype = String(subtypeCreaturesMatch[1] || '').trim();
    return controlledCreatureIds.filter((permanentId) => {
      const permanent = findControlledCreature(permanentId);
      return permanent ? permanentHasSubtype(permanent, subtype) : false;
    });
  }

  const eachSubtypeTeamMatch = targetText.match(/^each ([a-z][a-z -]+?) you control$/i);
  if (eachSubtypeTeamMatch) {
    const subtype = String(eachSubtypeTeamMatch[1] || '').trim().toLowerCase();
    if (subtype !== 'creature' && subtype !== 'permanent' && subtype !== 'other creature') {
      return controlledCreatureIds.filter((permanentId) => {
        const permanent = findControlledCreature(permanentId);
        return permanent ? permanentHasSubtype(permanent, subtype) : false;
      });
    }
  }

  return [];
}

