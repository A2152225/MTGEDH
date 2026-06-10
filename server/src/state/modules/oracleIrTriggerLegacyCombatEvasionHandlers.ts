import type { PlayerID } from '../../../../shared/src/index.js';
import { debug } from '../../utils/debug.js';

export interface TriggerLegacyCombatEvasionParams {
  readonly controller: PlayerID;
  readonly sourceName: string;
  readonly desc: string;
  readonly triggerItem: any;
  readonly state: any;
}

function pushTemporaryAbility(
  permanent: any,
  ability: string,
  sourceName: string,
  state: any,
): void {
  permanent.temporaryAbilities = Array.isArray(permanent.temporaryAbilities) ? permanent.temporaryAbilities : [];
  permanent.temporaryAbilities.push({
    ability,
    source: sourceName,
    expiresAt: 'end_of_turn',
    turnApplied: state.turnNumber || 0,
  });
}

export function applyRetiredTriggerLegacyTargetCreatureCantBeBlocked(
  params: TriggerLegacyCombatEvasionParams,
): boolean {
  const targetCreatureCantBeBlockedMatch = params.desc.match(/(?:up to (?:one|two|three|four|five|\d+) )?target creatures? can't be blocked this turn\.?$/i);
  if (!targetCreatureCantBeBlockedMatch) {
    return false;
  }

  const targets = Array.isArray(params.triggerItem?.targets) ? params.triggerItem.targets : [];
  const battlefield = params.state.battlefield || [];

  for (const targetRef of targets) {
    const targetId = typeof targetRef === 'string' ? targetRef : targetRef?.id;
    const targetCreature = battlefield.find((permanent: any) => permanent?.id === targetId);
    if (!targetCreature) continue;

    const typeLine = String(targetCreature?.card?.type_line || '').toLowerCase();
    if (!typeLine.includes('creature')) continue;

    pushTemporaryAbility(targetCreature, "can't be blocked", params.sourceName, params.state);
    debug(2, `[executeTriggerEffect] ${targetCreature.card?.name || targetId} can't be blocked this turn`);
  }

  return true;
}

export function applyRetiredTriggerLegacySelfCantBeBlocked(
  params: TriggerLegacyCombatEvasionParams,
): boolean {
  const selfCantBeBlockedMatch = params.desc.match(/(?:it|this creature) can't be blocked this turn(?: and you scry (\d+))?\.?$/i);
  if (!selfCantBeBlockedMatch) {
    return false;
  }

  const unblockableSourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const sourcePermanent = unblockableSourceId
    ? (params.state.battlefield || []).find((permanent: any) => permanent?.id === unblockableSourceId)
    : null;

  if (sourcePermanent) {
    pushTemporaryAbility(sourcePermanent, "can't be blocked", params.sourceName, params.state);
    debug(2, `[executeTriggerEffect] ${sourcePermanent.card?.name || unblockableSourceId} can't be blocked this turn`);
  }

  const scryCount = selfCantBeBlockedMatch[1] ? parseInt(selfCantBeBlockedMatch[1], 10) : 0;
  if (scryCount > 0) {
    params.state.pendingScry = params.state.pendingScry || {};
    params.state.pendingScry[params.controller] = scryCount;
    debug(2, `[executeTriggerEffect] ${params.controller} scries ${scryCount}`);
  }

  return true;
}

export function applyRetiredTriggerLegacySelfPreventCombatDamage(
  params: TriggerLegacyCombatEvasionParams,
): boolean {
  const selfPreventCombatDamageMatch = params.desc.match(/prevent all combat damage that would be dealt to (?:it|this creature) this turn\.?$/i);
  if (!selfPreventCombatDamageMatch) {
    return false;
  }

  const preventionSourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const sourcePermanent = preventionSourceId
    ? (params.state.battlefield || []).find((permanent: any) => permanent?.id === preventionSourceId)
    : null;

  if (sourcePermanent) {
    pushTemporaryAbility(
      sourcePermanent,
      'prevent all combat damage that would be dealt to this creature this turn',
      params.sourceName,
      params.state,
    );
    debug(2, `[executeTriggerEffect] Preventing all combat damage to ${sourcePermanent.card?.name || preventionSourceId} this turn`);
  }

  return true;
}

export function applyRetiredTriggerLegacySelfCantBeBlockedByLowPower(
  params: TriggerLegacyCombatEvasionParams,
): boolean {
  const selfCantBeBlockedByLowPowerMatch = params.desc.match(/(?:it|this creature) can't be blocked by creatures with power 2 or less this turn\.?$/i);
  if (!selfCantBeBlockedByLowPowerMatch) {
    return false;
  }

  const evasionSourceId = params.triggerItem.source || params.triggerItem.permanentId;
  const sourcePermanent = evasionSourceId
    ? (params.state.battlefield || []).find((permanent: any) => permanent?.id === evasionSourceId)
    : null;

  if (sourcePermanent) {
    pushTemporaryAbility(
      sourcePermanent,
      "can't be blocked by creatures with power 2 or less this turn",
      params.sourceName,
      params.state,
    );
    debug(2, `[executeTriggerEffect] ${sourcePermanent.card?.name || evasionSourceId} can't be blocked by creatures with power 2 or less this turn`);
  }

  return true;
}
