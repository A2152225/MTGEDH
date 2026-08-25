/**
 * Origin parent: oracleIRExecutorCreatureStepUtils.ts
 * Cluster moved: resolveSingleCreatureTargetId plus exclusive mentor / extrema /
 *   bolster / trepanation helpers
 * Public: resolveMentorTargetCreatureIdFromBattlefield,
 *   resolveCreatureExtremaQualifiedTargetIdFromBattlefield,
 *   resolveBolsterTargetCreatureIdFromBattlefield,
 *   resolveTrepanationBoostTargetCreatureId, resolveSingleCreatureTargetId
 */

import type { BattlefieldPermanent, GameState } from '../../../shared/src';
import type { OracleObjectSelector } from '../oracleIR';
import type { OracleIRExecutionContext } from '../oracleIRExecutionTypes';
import { normalizeOracleText } from '../oracleIRExecutorPlayerUtils';
import { isExecutorCreature } from '../oracleIRExecutorPermanentUtils';
import { applyStaticAbilitiesToBattlefield } from '../staticAbilities';
import {
  isAttackingPermanent,
  readCreatureStatForComparison,
  readPowerForComparison,
} from './oracleIRExecutorCreatureBattlefieldHelpers';
import { getProcessedBattlefield } from './oracleIRExecutorCreatureBattlefieldLookup';

export function resolveMentorTargetCreatureIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = normalizeOracleText(target.text);
  if (targetText !== "target attacking creature with power less than this creature's power") {
    return undefined;
  }

  const sourceId = String(ctx.sourceId || '').trim();
  if (!sourceId) return undefined;

  const processedBattlefield = applyStaticAbilitiesToBattlefield([...battlefield]) as BattlefieldPermanent[];
  const sourcePermanent = processedBattlefield.find(permanent => String((permanent as any)?.id || '').trim() === sourceId);
  const sourcePower = readPowerForComparison(sourcePermanent);
  if (!sourcePermanent || sourcePower === null || !isAttackingPermanent(sourcePermanent)) {
    return undefined;
  }

  const legalTargets = processedBattlefield.filter(permanent => {
    const permanentId = String((permanent as any)?.id || '').trim();
    if (!permanentId || permanentId === sourceId) return false;
    if (!isExecutorCreature(permanent)) return false;
    if (!isAttackingPermanent(permanent)) return false;

    const targetPower = readPowerForComparison(permanent);
    return targetPower !== null && targetPower < sourcePower;
  });

  const chosenIds = [
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    ...(
      Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : []
    ),
  ].filter(Boolean);

  if (chosenIds.length > 0) {
    const legalIdSet = new Set(legalTargets.map(permanent => String((permanent as any)?.id || '').trim()));
    const matchedChosenIds = Array.from(new Set(chosenIds)).filter(id => legalIdSet.has(id));
    return matchedChosenIds.length === 1 ? matchedChosenIds[0] : undefined;
  }

  return legalTargets.length === 1 ? String((legalTargets[0] as any)?.id || '').trim() || undefined : undefined;
}

function normalizeCreatureControllerScope(rawScope: string): 'you-control' | 'opponents-control' | undefined {
  const normalized = normalizeOracleText(rawScope);
  if (normalized === 'you control') return 'you-control';
  if (
    normalized === 'your opponents control' ||
    normalized === 'an opponent controls' ||
    normalized === "you don't control" ||
    normalized === 'you do not control'
  ) {
    return 'opponents-control';
  }
  return undefined;
}

function normalizeCreatureLegendQualifier(rawQualifier: string): 'legendary' | 'nonlegendary' | undefined {
  const normalized = normalizeOracleText(rawQualifier);
  if (normalized === 'legendary') return 'legendary';
  if (normalized === 'nonlegendary') return 'nonlegendary';
  return undefined;
}

function creatureMatchesLegendQualifier(
  permanent: BattlefieldPermanent | any,
  qualifier?: 'legendary' | 'nonlegendary'
): boolean {
  if (!qualifier) return true;
  const typeLine = String((permanent as any)?.card?.type_line || (permanent as any)?.type_line || '').toLowerCase();
  const isLegendary = typeLine.includes('legendary');
  return qualifier === 'legendary' ? isLegendary : !isLegendary;
}

export function resolveCreatureExtremaQualifiedTargetIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind !== 'raw') return undefined;

  const targetText = normalizeOracleText(target.text);
  const match = targetText.match(
    /^target (other )?(legendary |nonlegendary )?creature (you control|your opponents control|an opponent controls|you don['’]?t control|you do not control) with the (least|lowest|smallest|greatest|highest) (power|toughness) among (other )?(legendary |nonlegendary )?creatures (you control|your opponents control|an opponent controls|you don['’]?t control|you do not control)$/i
  );
  if (!match) {
    return undefined;
  }

  const controllerId = String(ctx.controllerId || '').trim();
  if (!controllerId) return undefined;

  const targetQualifier = normalizeCreatureLegendQualifier(String(match[2] || '').trim());
  const targetScope = normalizeCreatureControllerScope(String(match[3] || ''));
  const amongQualifier = normalizeCreatureLegendQualifier(String(match[7] || '').trim());
  const amongScope = normalizeCreatureControllerScope(String(match[8] || ''));
  if (!targetScope || !amongScope || targetScope !== amongScope) {
    return undefined;
  }

  const isLeast = /^(least|lowest|smallest)$/i.test(String(match[4] || ''));
  const which = String(match[5] || '').toLowerCase() as 'power' | 'toughness';
  const excludeSourceId = Boolean(String(match[1] || '').trim()) || Boolean(String(match[6] || '').trim());
  const sourceId = String(ctx.sourceId || '').trim();

  const processedBattlefield = applyStaticAbilitiesToBattlefield([...battlefield]) as BattlefieldPermanent[];
  const candidateCreatures = processedBattlefield.filter(permanent => {
    if (!isExecutorCreature(permanent)) return false;
    const permanentId = String((permanent as any)?.id || '').trim();
    if (excludeSourceId && sourceId && permanentId === sourceId) return false;

    const isControlledByYou = String((permanent as any)?.controller || '').trim() === controllerId;
    const matchesControllerScope = targetScope === 'you-control' ? isControlledByYou : !isControlledByYou;
    if (!matchesControllerScope) return false;

    if (!creatureMatchesLegendQualifier(permanent, amongQualifier)) return false;
    if (!creatureMatchesLegendQualifier(permanent, targetQualifier)) return false;

    return true;
  });
  if (candidateCreatures.length === 0) return undefined;

  const statValues = candidateCreatures
    .map(permanent => readCreatureStatForComparison(permanent, which))
    .filter((value): value is number => value !== null);
  if (statValues.length === 0) return undefined;

  const extremum = isLeast ? Math.min(...statValues) : Math.max(...statValues);
  const legalTargets = candidateCreatures.filter(permanent => readCreatureStatForComparison(permanent, which) === extremum);

  const chosenIds = [
    String(ctx.targetCreatureId || '').trim(),
    String(ctx.targetPermanentId || '').trim(),
    ...(
      Array.isArray(ctx.selectorContext?.chosenObjectIds)
        ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
        : []
    ),
  ].filter(Boolean);

  if (chosenIds.length > 0) {
    const legalIdSet = new Set(legalTargets.map(permanent => String((permanent as any)?.id || '').trim()));
    const matchedChosenIds = Array.from(new Set(chosenIds)).filter(id => legalIdSet.has(id));
    return matchedChosenIds.length === 1 ? matchedChosenIds[0] : undefined;
  }

  return legalTargets.length === 1 ? String((legalTargets[0] as any)?.id || '').trim() || undefined : undefined;
}

export function resolveBolsterTargetCreatureIdFromBattlefield(
  battlefield: readonly BattlefieldPermanent[],
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  return resolveCreatureExtremaQualifiedTargetIdFromBattlefield(battlefield, target, ctx);
}

export function resolveTrepanationBoostTargetCreatureId(
  state: GameState,
  ctx: OracleIRExecutionContext
): string | undefined {
  const battlefield = getProcessedBattlefield(state);
  const sourceId = String(ctx.sourceId || '').trim();

  if (sourceId) {
    const sourcePerm = battlefield.find(permanent => permanent.id === sourceId) as any;
    const attachedTo = String(sourcePerm?.attachedTo || '').trim();
    if (attachedTo && battlefield.some(permanent => permanent.id === attachedTo)) return attachedTo;
  }

  const attackers = battlefield.filter(permanent => String((permanent as any)?.attacking || '').trim().length > 0);
  if (attackers.length === 1) return attackers[0].id;
  return undefined;
}

export function resolveSingleCreatureTargetId(
  state: GameState,
  target: OracleObjectSelector,
  ctx: OracleIRExecutionContext
): string | undefined {
  if (target.kind === 'equipped_creature') {
    const equipped = resolveTrepanationBoostTargetCreatureId(state, ctx);
    if (equipped) return equipped;
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
    const battlefield = getProcessedBattlefield(state).filter((permanent) => isExecutorCreature(permanent));
    for (const preferredId of preferredIds) {
      if (battlefield.some((permanent) => String((permanent as any)?.id || '').trim() === preferredId)) {
        return preferredId;
      }
    }
    return undefined;
  }

  const mentorTargetCreatureId = resolveMentorTargetCreatureIdFromBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[],
    target,
    ctx
  );
  if (mentorTargetCreatureId) {
    return mentorTargetCreatureId;
  }

  const bolsterTargetCreatureId = resolveCreatureExtremaQualifiedTargetIdFromBattlefield(
    (state.battlefield || []) as BattlefieldPermanent[],
    target,
    ctx
  );
  if (bolsterTargetCreatureId) {
    return bolsterTargetCreatureId;
  }

  if (target.kind !== 'raw') return undefined;
  const battlefield = getProcessedBattlefield(state);
  let targetText = normalizeOracleText(target.text);
  const creatureGetsMatch = targetText.match(/^(that creature|the creature)\s+gets\b/i);
  if (creatureGetsMatch) {
    targetText = creatureGetsMatch[1].toLowerCase();
  }
  const creatures = battlefield.filter(permanent => isExecutorCreature(permanent));

  if (
    /^one or two target creatures$/i.test(targetText) ||
    /^(?:one|two|three|four|five|\d+) target creatures$/i.test(targetText) ||
    /^up to (?:one|two|three|four|five|\d+) target creatures$/i.test(targetText) ||
    /^any number of target creatures(?: each)?$/i.test(targetText)
  ) {
    return undefined;
  }

  const targetPlayerId = String(ctx.selectorContext?.targetPlayerId || (ctx as any).targetPlayerId || '').trim();
  const targetOpponentId = String(ctx.selectorContext?.targetOpponentId || (ctx as any).targetOpponentId || '').trim();

  const pickFromControllerPool = (pool: BattlefieldPermanent[]): string | undefined => {
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map(id => String(id || '').trim()).filter(Boolean)
      : [];
    const preferredIds = (chosenIds.length > 1
      ? [
          String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
          ...chosenIds,
          String(ctx.selectorContext?.targetCreatureId || '').trim(),
          String(ctx.selectorContext?.targetPermanentId || '').trim(),
          String(ctx.targetCreatureId || '').trim(),
          String(ctx.targetPermanentId || '').trim(),
        ]
      : [
          String(ctx.selectorContext?.combatOpponentCreatureId || '').trim(),
          String(ctx.selectorContext?.targetCreatureId || '').trim(),
          String(ctx.selectorContext?.targetPermanentId || '').trim(),
          String(ctx.targetCreatureId || '').trim(),
          String(ctx.targetPermanentId || '').trim(),
          ...chosenIds,
        ])
      .map((id) => String(id || '').trim())
      .filter(Boolean);
    const seenPreferredIds = new Set<string>();
    for (const preferredId of preferredIds) {
      if (!preferredId || seenPreferredIds.has(preferredId)) continue;
      seenPreferredIds.add(preferredId);
      if (pool.some(permanent => String((permanent as any)?.id || '').trim() === preferredId)) {
        return preferredId;
      }
    }
    return pool.length === 1 ? String((pool[0] as any)?.id || '').trim() || undefined : undefined;
  };

  if (targetText === 'target creature that player controls' && targetPlayerId) {
    const pool = creatures.filter(
      permanent => String((permanent as any)?.controller || '').trim() === targetPlayerId
    );
    return pickFromControllerPool(pool);
  }

  if (
    (targetText === 'target creature that opponent controls' ||
      targetText === 'target creature an opponent controls' ||
      targetText === 'target creature defending player controls') &&
    targetOpponentId
  ) {
    const pool = creatures.filter(
      permanent => String((permanent as any)?.controller || '').trim() === targetOpponentId
    );
    return pickFromControllerPool(pool);
  }

  const controllerId = String(ctx.controllerId || '').trim();
  const controlledCreatures = creatures.filter(
    permanent => String((permanent as any)?.controller || '').trim() === controllerId
  );
  const opponentsControlledCreatures = creatures.filter(
    permanent => String((permanent as any)?.controller || '').trim() !== controllerId
  );

  if (targetText.includes('target creature you control')) {
    return pickFromControllerPool(controlledCreatures);
  }

  if (
    targetText.includes('target creature your opponents control') ||
    targetText.includes('target creature an opponent controls') ||
    targetText.includes("target creature you don't control") ||
    targetText.includes('target creature you dont control') ||
    (targetText.includes('target') && targetText.includes('creature') && targetText.includes('opponent') && targetText.includes('controls'))
  ) {
    return pickFromControllerPool(opponentsControlledCreatures);
  }

  const directTargetCreatureId = String(ctx.targetCreatureId || '').trim();
  const normalizedSelfTargetText = targetText.trim().toLowerCase();
  const isSelfReferencedCreatureTarget =
    normalizedSelfTargetText === 'this creature' ||
    normalizedSelfTargetText === 'this permanent' ||
    normalizedSelfTargetText === 'it';
  if (directTargetCreatureId && !isSelfReferencedCreatureTarget) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === directTargetCreatureId);
    if (matched && isExecutorCreature(matched)) return directTargetCreatureId;
  }

  const directTargetPermanentId = String(
    ctx.targetPermanentId || ctx.selectorContext?.targetPermanentId || '',
  ).trim();
  if (
    directTargetPermanentId &&
    /^(?:that|the) creature$|^that permanent$/.test(targetText)
  ) {
    const matched = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === directTargetPermanentId);
    if (matched && isExecutorCreature(matched)) {
      return directTargetPermanentId;
    }
  }

  const sourceId = String(ctx.sourceId || '').trim();

  // "target attacking creature" / "target blocking creature" (and optional subtype words)
  // do not contain the contiguous substring "target creature". Prefer chosen/bound ids
  // within the legal combat-role pool (same gap as inferTriggeredAbilityTargetMetadata).
  const combatRoleTargetMatch = targetText.match(
    /^target (attacking(?: or blocking)?|blocking)(?: [a-z0-9'-]+)* creature(?: you control)?$/i,
  );
  if (combatRoleTargetMatch) {
    const role = String(combatRoleTargetMatch[1] || '').toLowerCase();
    const youControlOnly = /\byou control\b/i.test(targetText);
    const isBlockingPermanent = (permanent: BattlefieldPermanent | any): boolean => {
      const blocking = (permanent as any)?.blocking;
      if (Array.isArray(blocking) && blocking.length > 0) return true;
      if (typeof blocking === 'string' && blocking.trim().length > 0) return true;
      return Boolean((permanent as any)?.isBlocking);
    };
    const pool = creatures.filter((permanent) => {
      if (youControlOnly && String((permanent as any)?.controller || '').trim() !== controllerId) {
        return false;
      }
      const attacking = isAttackingPermanent(permanent);
      const blocking = isBlockingPermanent(permanent);
      if (role === 'attacking or blocking') return attacking || blocking;
      if (role === 'blocking') return blocking;
      return attacking;
    });
    const chosenIds = [
      String(ctx.targetCreatureId || '').trim(),
      String(ctx.targetPermanentId || '').trim(),
      String(ctx.selectorContext?.targetCreatureId || '').trim(),
      String(ctx.selectorContext?.targetPermanentId || '').trim(),
      ...(
        Array.isArray(ctx.selectorContext?.chosenObjectIds)
          ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
          : []
      ),
    ].filter(Boolean);
    if (chosenIds.length > 0) {
      const legalIdSet = new Set(
        pool.map((permanent) => String((permanent as any)?.id || '').trim()).filter(Boolean),
      );
      const matchedChosenIds = Array.from(new Set(chosenIds)).filter((id) => legalIdSet.has(id));
      return matchedChosenIds.length === 1 ? matchedChosenIds[0] : undefined;
    }
    return pickFromControllerPool(pool);
  }

  if (
    targetText === 'target creature'
    || targetText === 'creature'
    || targetText.includes('target creature')
    || /\btarget\b(?:\s+(?:attacking(?:\s+or\s+blocking)?|blocking|[a-z0-9'-]+))+\s+creature\b/i.test(targetText)
  ) {
    const preferredTarget = pickFromControllerPool(creatures);
    if (preferredTarget) return preferredTarget;
    return creatures.length === 1 ? creatures[0].id : undefined;
  }

  if (
    (targetText === 'this creature' || targetText === 'this permanent' || targetText === 'it') &&
    sourceId
  ) {
    if (creatures.some(permanent => String((permanent as any)?.id || '').trim() === sourceId)) {
      return sourceId;
    }
    const sourcePermanent = battlefield.find(
      (permanent) => String((permanent as any)?.id || '').trim() === sourceId,
    ) as any;
    const attachedToId = String(
      sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '',
    ).trim();
    if (
      attachedToId &&
      creatures.some((permanent) => String((permanent as any)?.id || '').trim() === attachedToId)
    ) {
      return attachedToId;
    }
  }

  if (targetText === 'enchanted creature' && sourceId) {
    const sourcePermanent = battlefield.find(permanent => String((permanent as any)?.id || '').trim() === sourceId) as any;
    const attachedToId = String(
      sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '',
    ).trim();
    if (
      attachedToId &&
      creatures.some(permanent => String((permanent as any)?.id || '').trim() === attachedToId)
    ) {
      return attachedToId;
    }
  }

  if (targetText === 'equipped creature' && sourceId) {
    return resolveTrepanationBoostTargetCreatureId(state, ctx);
  }

  if (
    (targetText === 'that creature' || targetText === 'the creature')
    && String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim()
  ) {
    const triggerTargetId = String(ctx.targetPermanentId || ctx.targetCreatureId || '').trim();
    if (creatures.some((permanent) => String((permanent as any)?.id || '').trim() === triggerTargetId)) {
      return triggerTargetId;
    }
  }

  if ((targetText === 'that creature' || targetText === 'the creature') && sourceId) {
    const sourcePermanent = battlefield.find(
      (permanent) => String((permanent as any)?.id || '').trim() === sourceId,
    ) as any;
    const attachedToId = String(sourcePermanent?.attachedTo || sourcePermanent?.enchanting || '').trim();
    if (
      attachedToId &&
      creatures.some((permanent) => String((permanent as any)?.id || '').trim() === attachedToId)
    ) {
      return attachedToId;
    }
  }

  if (targetText === 'the creature that attacked') {
    if (
      sourceId &&
      creatures.some(
        (permanent) =>
          String((permanent as any)?.id || '').trim() === sourceId
          && isAttackingPermanent(permanent),
      )
    ) {
      return sourceId;
    }
    const attackingControlled = creatures.filter(
      (permanent) =>
        String((permanent as any)?.controller || '').trim() === controllerId
        && isAttackingPermanent(permanent),
    );
    if (attackingControlled.length === 1) {
      return String((attackingControlled[0] as any)?.id || '').trim() || undefined;
    }
  }

  if (targetText === 'the chosen creature') {
    const chosenIds = Array.isArray(ctx.selectorContext?.chosenObjectIds)
      ? ctx.selectorContext.chosenObjectIds.map((id) => String(id || '').trim()).filter(Boolean)
      : [];
    for (const chosenId of chosenIds) {
      if (creatures.some((permanent) => String((permanent as any)?.id || '').trim() === chosenId)) {
        return chosenId;
      }
    }
    return pickFromControllerPool(creatures);
  }

  return undefined;
}

