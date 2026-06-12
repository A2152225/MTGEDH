import type { PlayerID } from '../../../../shared/src/index.js';

import { debug } from '../../utils/debug.js';

import {
  isTriggerEffectOwnedByOracleIrPrimary,
  skipRetiredTriggerLegacyHandler,
} from './oracleIrTriggerLegacyRouting.js';



export interface TriggerLegacyCombatEvasionParams {

  readonly controller: PlayerID;

  readonly sourceName: string;

  readonly desc: string;

  readonly triggerItem: any;

  readonly state: any;

}



function normalizeTemporaryAbilityKey(ability: string): string {

  return String(ability || '')

    .toLowerCase()

    .replace(/\s+this turn/g, '')

    .trim();

}



function pushTemporaryAbility(

  permanent: any,

  ability: string,

  sourceName: string,

  state: any,

): void {

  permanent.temporaryAbilities = Array.isArray(permanent.temporaryAbilities) ? permanent.temporaryAbilities : [];

  const key = normalizeTemporaryAbilityKey(ability);

  const existingIndex = permanent.temporaryAbilities.findIndex((entry: any) =>

    normalizeTemporaryAbilityKey(String(entry?.ability || '')) === key

    && String(entry?.source || '') === String(sourceName)

    && entry?.expiresAt === 'end_of_turn'

  );

  if (existingIndex >= 0) {

    const existing = permanent.temporaryAbilities[existingIndex];

    if (/\bthis turn\b/i.test(ability) && !/\bthis turn\b/i.test(String(existing?.ability || ''))) {

      permanent.temporaryAbilities[existingIndex] = {

        ability,

        source: sourceName,

        expiresAt: 'end_of_turn',

        turnApplied: state.turnNumber || 0,

      };

    }

    return;

  }

  permanent.temporaryAbilities.push({

    ability,

    source: sourceName,

    expiresAt: 'end_of_turn',

    turnApplied: state.turnNumber || 0,

  });

}



/** Retired when IR owns grant_temporary_ability / scry for this text. */

export function applyRetiredTriggerLegacyTargetCreatureCantBeBlocked(

  params: TriggerLegacyCombatEvasionParams,

): boolean {

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {

    return false;

  }

  if (isTriggerEffectOwnedByOracleIrPrimary(params.desc, params.sourceName)) {

    return false;

  }



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



/** Retired when IR owns grant_temporary_ability / scry for exert unblockable rewards. */

export function applyRetiredTriggerLegacySelfCantBeBlocked(

  params: TriggerLegacyCombatEvasionParams,

): boolean {

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {

    return false;

  }

  if (isTriggerEffectOwnedByOracleIrPrimary(params.desc, params.sourceName)) {

    return false;

  }



  const selfCantBeBlockedMatch = params.desc.match(/(?:it|this creature) can't be blocked this turn(?: and you scry (\d+))?\.?$/i)

    || params.desc.match(/you scry (\d+) and (?:it|this creature) can't be blocked this turn\.?$/i);

  const hasSelfUnblockable = /(?:it|this creature) can't be blocked this turn/i.test(params.desc);

  if (!selfCantBeBlockedMatch && !hasSelfUnblockable) {

    return false;

  }



  const unblockableSourceId = String(

    params.triggerItem.source

      || params.triggerItem.permanentId

      || params.triggerItem.sourceId

      || params.triggerItem.effectData?.exertedPermanentId

      || '',

  ).trim();

  const sourcePermanent = unblockableSourceId

    ? (params.state.battlefield || []).find((permanent: any) => permanent?.id === unblockableSourceId)

    : null;



  if (sourcePermanent) {

    pushTemporaryAbility(sourcePermanent, "can't be blocked", params.sourceName, params.state);

    debug(2, `[executeTriggerEffect] ${sourcePermanent.card?.name || unblockableSourceId} can't be blocked this turn`);

  }



  const scryCount = selfCantBeBlockedMatch?.[1]

    ? parseInt(selfCantBeBlockedMatch[1], 10)

    : selfCantBeBlockedMatch?.[2]

      ? parseInt(selfCantBeBlockedMatch[2], 10)

      : (() => {

          const inlineScry = params.desc.match(/(?:and )?you scry (\d+)/i);

          return inlineScry?.[1] ? parseInt(inlineScry[1], 10) : 0;

        })();

  if (scryCount > 0) {

    params.state.pendingScry = params.state.pendingScry || {};

    if (typeof params.state.pendingScry[params.controller] !== 'number') {

      params.state.pendingScry[params.controller] = scryCount;

      debug(2, `[executeTriggerEffect] ${params.controller} scries ${scryCount}`);

    }

  }



  return true;

}



/** Retired when IR owns grant_temporary_ability for combat damage prevention text. */

export function applyRetiredTriggerLegacySelfPreventCombatDamage(

  params: TriggerLegacyCombatEvasionParams,

): boolean {

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {

    return false;

  }

  if (isTriggerEffectOwnedByOracleIrPrimary(params.desc, params.sourceName)) {

    return false;

  }



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



/** Retired when IR owns grant_temporary_ability for low-power unblockable text. */

export function applyRetiredTriggerLegacySelfCantBeBlockedByLowPower(

  params: TriggerLegacyCombatEvasionParams,

): boolean {

  if (skipRetiredTriggerLegacyHandler(params.desc, params.sourceName)) {

    return false;

  }

  if (isTriggerEffectOwnedByOracleIrPrimary(params.desc, params.sourceName)) {

    return false;

  }



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

